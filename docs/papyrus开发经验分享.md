# Papyrus 秘书 Agent 工程参考实现

## 0. 架构目标与不可突破的边界

Papyrus 的定位是“写作与办公优先的秘书”，不是一个可以随意执行命令的自动化程序。它把模型擅长的理解、规划和生成，与本机程序擅长的校验、权限判断和执行分开：

```text
用户目标
  -> 模型提出结构化意图
  -> 原生层生成预览并做安全校验
  -> 用户确认高风险操作
  -> 一次性批准凭据
  -> 原生层执行
  -> 脱敏回执回到对话时间线
```

对已有 Agent Loop 的项目而言，这意味着要把“策略层”和“执行层”部署到不同信任边界：策略层只生成受限 JSON；原生执行层才持有工作区、应用目录、浏览器会话和一次性批准状态。模型不可通过提示词、工具参数或历史回放绕过这一链路。

本文对应的可复用模块与参考位置如下：

| 主题 | Papyrus 参考位置 |
| --- | --- |
| 秘书账本与长期记忆 | `src-tauri/src/secretary_ledger.rs` |
| 动态采样 | `src/services/agentSamplingService.ts` |
| 工具协议与事件 | `src/services/workAssistantProtocol.ts` |
| 审批策略 | `src/services/workAssistantPolicy.ts` |
| 受控终端 | `src-tauri/src/work_assistant/terminal.rs` |
| 桌面应用与原生动作 | `src-tauri/src/work_assistant/desktop.rs`、`native_actions.rs` |
| 浏览器桥接说明 | `docs/BROWSER_BRIDGE.md` |
| 多平台发布 | `.github/workflows/desktop-release.yml` |

### 0.1 推荐的模块契约

```text
UI / Timeline
  -> Agent Runtime (classification, plan, streaming, retry budget)
  -> Policy (risk classification, scope grant)
  -> Native Preview (immutable preview revision)
  -> Native Executor (revalidation + action + sanitized receipt)
  -> Ledger (project-scoped memory, task event, checkpoint)
```

每层只接受自己需要的数据。尤其是：账本不保存原始浏览器表单或批准令牌；模型不接触真实路径；执行器不解析模型自由文本；UI 不把“模型声称完成”当作真实执行结果。

### 0.2 先记住几个容易踩的坑

这些问题在设计文档里不显眼，却很容易在第一次上线时出现：

- **API 地址不能混用。** 模型、套餐和额度接口走 API 网关；OTA 清单走下载站。Papyrus 目前分别使用 `https://api.sca-hub.cn/api/papyrus/...` 和 `https://sca-hub.cn/api/papyrus/update`。把 OTA 地址填进模型客户端，通常会得到 HTML、405 或 410；把 API 子域名填进更新器，可能绕过正确的迁移规则。
- **模型退役不是网络错误。** 供应商返回 404/410 时，可以刷新目录并换下一个服务端候选；超时、连接重置和未知 5xx 不应自动重试，否则一次请求可能变成两次扣费。
- **流式请求不能用普通重试逻辑。** 首 token 前失败，可以有限降级到非流式；已经收到部分内容后断开，不能自动重发。用户应该看到“结果不完整，可手动重试”，而不是两个答案拼在一起。
- **“构建失败”有时只是 Windows 文件锁。** `LNK1105`、错误代码 1224 往往来自旧的 `cargo`、`rustc`、杀毒软件或另一个构建目录占用文件。先确认进程和 `CARGO_TARGET_DIR`，再判断是否真是代码错误；不要因为一次锁冲突去改业务逻辑。
- **macOS 的应用测试夹具必须像应用。** 普通临时文件在 Windows/Linux 可以代表可执行文件，在 macOS 上却必须是 `.app/Contents/MacOS/...` 目录结构。跨平台测试不能只在开发机上“看起来能跑”。
- **PowerShell、SSH 和 Bash 的变量转义很容易让部署脚本空跑。** 上传成功不代表安装成功。每次远程部署都要先备份，再做远程 `node --check`，安装后重新计算远端哈希，并检查 PM2 的两个实例是否都重新启动。
- **发布标签和发布资产不是一回事。** 标签更新成功、CI 通过、Release 创建成功、OTA 清单上线，是四个独立状态。任何一个环节没核对，都可能出现“页面显示新版本，下载还是旧包”。
- **不要把私钥排障。** OTA 公钥可以提交并用于客户端校验，签名私钥只能留在受保护的 CI Secret 中。遇到“签名失败”，先核对公钥、资产名、`.sig` 文件和清单内容，不要把私钥复制到本机或聊天里。
- **错误提示可能被渲染两次。** Papyrus 同时有时间线消息和底部重试提示。同一个失败事件如果没有稳定的 `runId` 去重，就会出现截图中“上面一张错误卡、下面又一张错误条”的现象。这是 UI 事件合并问题，不等于请求执行了两次。

---

## 1. 项目长期记忆：可迁移的项目级账本

### 1.1 设计决策：账本不是聊天回放

把所有历史消息都交给模型，看起来简单，实际会出现四个问题：

1. 对话越久越慢、越贵，且容易超过上下文长度。
2. 不同项目的内容会互相污染。
3. 用户改过的偏好无法区分“最新结论”和“旧说法”。
4. 敏感信息可能被反复带入后续请求。

因此，长期记忆应是一个**可查询、可修订、可删除、按项目隔离**的小型账本，而不是聊天记录的备份。

### 1.2 数据归属模型

Papyrus 将资料分成三类：

| 范围 | 例子 | 默认能否注入当前任务 |
| --- | --- | --- |
| 全局个人偏好 | “回复使用简洁中文” | 可以 |
| 当前项目事实 | “这份报告的截止日期是周五” | 可以 |
| 其他项目记录 | “小说 A 的人物设定” | 不可以，需用户明确开启跨项目检索 |

不要自动保存身份凭证、一次性验证码、支付信息、精确住址、私人联系方式或文件的原始敏感内容。遇到这类内容，最安全的做法是只保存“已拒绝保存敏感信息”这一事件，或完全不落库。

### 1.3 最小 SQLite 与 FTS 模型

下面的 SQL 是可迁移的最小模型。接入生产系统时必须补充迁移编号、输入长度限制、失败恢复和审计策略。

```sql
CREATE TABLE projects (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE memories (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL CHECK (scope IN ('personal', 'project')),
  project_id TEXT REFERENCES projects(id),
  kind TEXT NOT NULL,
  content TEXT NOT NULL,
  source TEXT NOT NULL,
  confidence REAL NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at INTEGER NOT NULL,
  CHECK ((scope = 'personal' AND project_id IS NULL)
      OR (scope = 'project' AND project_id IS NOT NULL))
);

CREATE VIRTUAL TABLE memory_fts USING fts5(
  record_id UNINDEXED,
  project_id UNINDEXED,
  title,
  content,
  normalized_cjk
);
```

`normalized_cjk` 可以存放适合中文检索的规范化文本，例如去除多余空白后的内容。它不是安全过滤器；安全过滤必须发生在写入数据库之前。

### 1.4 写入前的过滤与项目鉴权

下面是独立 TypeScript 示意。它说明两件事：先过滤敏感字段，再验证写入项目就是当前项目。

```ts
type MemoryDraft = {
  scope: 'personal' | 'project'
  projectId?: string
  content: string
  source: 'user_confirmed' | 'tool_verified'
}

function canPersistMemory(draft: MemoryDraft, currentProjectId: string) {
  if (draft.content.length === 0 || draft.content.length > 2_000) return false
  if (looksSensitive(draft.content)) return false
  if (draft.scope === 'personal') return draft.projectId === undefined
  return draft.projectId === currentProjectId
}

function looksSensitive(text: string) {
  // 最小示例；生产环境应使用更稳健的分类器和人工确认路径。
  return /(?:\b\d{6}\b|BEGIN [A-Z ]+ KEY|access[_ -]?token)/i.test(text)
}
```

Rust 账本应再做一次同样的校验。不要只相信前端，因为前端数据可以被篡改。Papyrus 的 `secretary_ledger.rs` 也会在读取和写入时验证 `ProjectAccess`，并在任务、检查点和记忆之间维持项目归属。

### 1.5 检索、注入与恢复

建议的检索算法：

```text
1. 查询当前项目的相关记忆和最近任务。
2. 查询全局个人偏好。
3. 只有用户明确选择时，才加入其他项目结果，并标记来源项目。
4. 按置信度、更新时间与查询相关性排序。
5. 只将少量摘要注入模型，不把整个数据库交给模型。
```

可复制的查询伪代码：

```ts
const context = await ledger.search({
  currentProjectId,
  includeCrossProject: false,
  query: userMessage,
  limit: 8,
})

const promptMemory = context.map((item) => ({
  source: item.projectTitle ?? '个人偏好',
  text: item.content.slice(0, 400),
}))
```

长任务还应保存检查点：任务状态、下一步、公开计划和经过筛选的上下文摘要。恢复时从**同一项目**的最近检查点继续，而不是重新把全部旧对话输入模型。

### 1.6 集成验收

- A 项目的检索不能返回 B 项目的内容。
- 只有开启 `includeCrossProject` 才能出现其他项目结果，且结果带项目名称。
- 敏感文本不会写入主表或 FTS。
- 修改记忆会递增修订号，可以回滚到上一修订。
- 重启后 SQLite 数据、检查点和项目绑定仍在。

---

## 2. 动态思考强度与采样配置

题目中的第 2、6 项都属于动态思考强度。本章同时说明模型参数与界面行为，避免把它误做成只有一个温度滑块。

### 2.1 两个维度：任务阶段优先，强度其次

同一个强度档位在不同阶段应表现不同：

| 阶段 | 目标 | 推荐倾向 |
| --- | --- | --- |
| 分类、规划、检索 | 稳定判断 | 低温、较短输出 |
| 正文写作、二稿润色 | 语言变化与想象 | 较高温、较长输出 |
| 审校、压缩、工具 JSON | 可重复、格式正确 | 低温、严格结构 |
| 网络恢复、错误修复 | 少猜测 | 低温、有限重试 |

思考强度 `low / medium / high / ultra_hive` 再调整预算：`low` 更快、更省并禁用子 Agent；`high` 提高分析和输出预算；`ultra_hive` 只应用于确实复杂的任务，并需要并发与费用上限。

### 2.2 采样配置函数

Papyrus 的实现位于 `agentSamplingService.ts`。下面是可独立移植的精简版本：

```ts
type Phase = 'planning' | 'writer' | 'judge' | 'tool_json'
type Effort = 'low' | 'medium' | 'high' | 'ultra_hive'

function samplingFor(phase: Phase, effort: Effort, repeatRisk = 0) {
  const creative = phase === 'writer'
  let temperature = creative ? 0.72 : 0.28
  let maxTokens = creative ? 8_000 : 4_000
  let frequencyPenalty = repeatRisk > 0.35 ? 0.55 : 0.12

  if (effort === 'low') maxTokens = Math.min(maxTokens, 2_400)
  if (effort === 'high') maxTokens = Math.max(maxTokens, 5_000)
  if (effort === 'ultra_hive') maxTokens = Math.max(maxTokens, 6_000)
  if (repeatRisk >= 0.6) temperature = Math.max(0.18, temperature - 0.06)

  return { temperature, frequencyPenalty, maxTokens }
}
```

不要把这些数值当成固定真理。你应为不同模型做测试，并记录“重复率、格式错误率、用户修改次数、成本和耗时”。

### 2.3 调度约束与 UI 语义

```ts
function canUseSubagents(effort: Effort) {
  return effort !== 'low'
}

function needsPlan(text: string) {
  return text.length > 100 || /研究|比较|整理|计划|多个/.test(text)
}
```

一句“你好”或“帮我改这句话”不应创建 Todo、工具调用或子 Agent。复杂任务才显示公开计划，并在 UI 中解释系统正在做什么。`ultra_hive` 可以有显眼的动态效果，但必须尊重系统的“减少动画”设置，不能用动画暗示不存在的推理能力。

### 2.4 缓存键必须包含采样参数

相同提示词在“写作”和“审校”阶段不应复用同一缓存结果：

```ts
const cacheKey = JSON.stringify({
  modelId,
  phase,
  effort,
  temperature: profile.temperature,
  maxTokens: profile.maxTokens,
  promptHash,
})
```

否则用户可能在要求严谨审校时，拿到之前较随意的创作答案。

---

## 3. 子 Agent 与蜂群：受预算约束的扇出与汇总

### 3.1 触发条件与禁止条件

子 Agent 适合可以并行且结果可独立检查的工作，例如：资料检索、提纲比较、事实核验、风格检查。它不适合简单问候、明确的单句改写，也不适合直接执行本机操作。

```text
分类器
  ├─ 简单任务 -> 主 Agent 直接回答
  └─ 复杂任务 -> 规划器拆成有限的研究/写作/审校子任务
                       -> 汇总器整合
                       -> 审校器检查
```

### 3.2 最小并发调度器

```ts
type Worker = { id: string; goal: string }

async function runWorkers(workers: Worker[], concurrency = 2) {
  const results: string[] = []
  const queue = [...workers]

  async function runner() {
    while (queue.length) {
      const worker = queue.shift()!
      results.push(await runReadOnlyResearch(worker))
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, workers.length) }, runner))
  return results
}
```

生产版本还需要：总超时、单个任务超时、最大工作者数量、取消信号、重复失败断路器和结果长度限制。子 Agent 应只返回摘要和引用线索；主 Agent 才负责最终措辞与用户沟通。

建议把下面这些限制显式写入运行时配置，而不是藏在 Prompt 中：

```ts
type HiveBudget = {
  maxAgents: number
  maxConcurrency: number
  maxRounds: number
  deadlineMs: number
  maxResultChars: number
}

const DEFAULT_HIVE_BUDGET: HiveBudget = {
  maxAgents: 4,
  maxConcurrency: 2,
  maxRounds: 2,
  deadlineMs: 90_000,
  maxResultChars: 6_000,
}
```

当预算耗尽、取消、连续无新增信息或所有候选工作者失败时，汇总器必须以明确的 `partial`/`failed` 状态结束；不要继续无界重试。

### 3.3 蜂群的安全规则

- `low` 强度不创建子 Agent。
- 子 Agent 不持有电脑助手、文件写入、浏览器提交或终端执行能力。
- 一个任务有固定预算：最大并发、最大轮数、最大模型调用数。
- 连续两次没有新增信息或持续报错时停止，要求用户修改任务。
- 对话时间线显示子任务的开始、进度、完成或失败，但不泄露完整内部提示词。

Papyrus 的 `WorkAssistantEvent` 已定义 `subagent.started`、`subagent.progress` 与 `subagent.completed` 事件。使用事件时间线能避免“模型正在做什么”变成不可观察的黑箱。

---

## 4. 电脑助手：结构化意图到原生动作

电脑助手应先分流意图，而不是让模型直接猜命令：

| 用户意图 | 应进入的受控通道 |
| --- | --- |
| “打开浏览器” | 已验证的应用目录 |
| “查看当前网页” | 已配对 Browser Bridge |
| “看看仓库状态” | 结构化 Git 诊断 |
| “整理项目文件” | 已授权工作区的文件预览 |

### 4.1 工具协议与错误恢复

```ts
type ToolIntent = {
  tool: 'launch_browser' | 'git_status' | 'browser_observe'
  arguments: Record<string, unknown>
}

function parseToolIntent(raw: string): ToolIntent | null {
  const stripped = raw.trim().replace(/^```json\s*|\s*```$/g, '')
  try {
    const value = JSON.parse(stripped)
    return typeof value?.tool === 'string' ? value : null
  } catch {
    return null
  }
}
```

如果模型输出不是有效 JSON，可以请求一次“只修正 JSON 格式”。第二次仍失败时，报告“未执行任何操作”，绝不猜测用户意图后继续执行。

### 4.2 Preview-Approve-Execute 契约

```ts
const preview = await native.preview({ runId, toolCallId, intent })

if (preview.risk === 'read') {
  return native.executeReadOnly(preview.id)
}

const choice = await ui.askForApproval(preview)
if (choice !== 'once') return { ok: false, summary: '用户未批准' }

const oneTimeToken = await native.approveOnce(preview.id)
return native.executeApproved({ previewId: preview.id, oneTimeToken })
```

批准必须绑定任务 ID、工具 ID、预览修订、操作目标和有效期。执行前要重新检查目标是否变过；变了就返回“预览已过期，请重新生成”，而不是沿用旧确认。

### 4.3 应用启动目录

安全的应用启动使用**不透明应用 ID**，模型只看见名称与平台，不能获得任意可执行文件路径：

```json
{ "tool": "desktop_open_app", "arguments": { "applicationId": "builtin-browser" } }
```

原生层负责检查它是否来自系统目录或由用户通过文件选择器登记；它还要在执行前再次验证文件身份，避免路径被替换。启动应用仍应让用户看见一次确认。

### 4.4 安全终端：枚举操作，不是 Shell

错误示例：

```text
shell -c "<模型生成的整段命令>"
```

安全示例：

```rust
match operation_name {
    "git_status" => run_fixed_git("status", ["--short"]),
    "git_branch" => run_fixed_git("branch", ["--show-current"]),
    "system_info" => run_platform_diagnostic(),
    _ => Err("operation_not_allowed"),
}
```

Papyrus 的终端层采用固定操作名、授权工作区、受限输出、超时、空环境和禁用交互输入。它不接受模型提供的 Shell 字符串、可执行路径、环境变量或标准输入。教学项目也应禁止通过构建工具或脚本“间接执行”项目代码。

### 4.5 Browser Bridge：配对与版本化快照

浏览器控制需要用户明确配对扩展。快照只给当前标签页的安全摘要、页面版本和不透明控件 ID；点击或填写时必须携带这些版本信息。

```text
配对 -> 快照(pageRevision) -> 选择控件(elementToken)
     -> 风险判断 -> 单次批准 -> 执行 -> 新快照
```

页面跳转、标签页切换、DOM 更新、超时或敏感页面都会使旧快照作废。登录、支付、验证码、下载执行、提交和删除等操作必须阻断或逐次确认。不要把网页表单值、剪贴板、会话标识或完整页面 HTML 写入长期记忆。

---

## 5. 安全边界：信任模型与拒绝策略

### 5.1 风险分类与授权范围

Papyrus 使用四级风险语义：

| 风险 | 例子 | 可选动作 |
| --- | --- | --- |
| `read` | 读取目录摘要、查看 Git 状态 | 直接执行 |
| `reversible` | 创建新文件、普通草稿填写 | 单次、本轮、拒绝 |
| `high` | 打开应用、覆盖、外部发送 | 单次、拒绝 |
| `blocked` | 未授权路径、敏感页面、任意命令 | 只能拒绝 |

高风险动作不能获得“本轮一直允许”。Papyrus 的 `RUN_SCOPED_DENYLIST` 也明确排除删除、覆盖、打开应用、下载、跳转、发送、发布和提交等操作。

### 5.2 TOCTOU：预览后目标变化

安全系统需要在预览与执行之间绑定身份，而不只是保存路径文本：

```text
预览时：记录授权根、相对路径、文件身份、版本/摘要、操作类型
执行前：重新打开并比对上述信息
不一致：停止，要求重新预览
```

跨平台上可使用不同原生 API，但不变量相同：拒绝符号链接或重解析点逃逸、只在授权根内操作、以 no-replace 的原子发布方式创建新目标、删除/覆盖前保存可恢复回执。

### 5.3 回执、日志与隐私

模型应该获得“操作成功、失败原因、相对路径摘要”，而不是系统绝对路径、批准令牌、原始浏览器表单或敏感终端输出。日志与 FTS 同样要脱敏，因为它们往往比主界面保存得更久。

推荐的回执结构：

```ts
type SafeReceipt = {
  ok: boolean
  operation: string
  summary: string
  recoverable: boolean
  recoveryId?: string // 不含真实恢复目录路径
}
```

### 5.4 不应进入代码、文档或运行时的内容

- 真实签名私钥、服务账号、访问令牌、用户对话或数据库副本。
- 任意 Shell、动态脚本下载、绕过系统权限的操作方法。
- 自动登录、绕过验证码、自动支付或后台发送。
- 永久危险授权或把一次批准复用于其他任务。

---

## 6. 跨平台发布与 OTA：构建、签名与数据迁移

### 6.1 单一版本源

版本号应从一个位置派生到应用、安装包、插件、更新清单和发布标题。发布前做一致性检查：

```text
version source
  -> Tauri package
  -> Windows installer
  -> Linux deb/AppImage
  -> macOS bundle
  -> OTA manifest
  -> GitHub release assets
```

不要手工改其中一个文件。版本漂移会导致“显示已更新但实际安装旧包”或客户端拒绝更新。

### 6.2 CI 构建矩阵与发布门禁

Tauri 桌面项目常见的矩阵是：Windows x64、Linux x64、macOS x64、macOS ARM。Papyrus 的 `desktop-release.yml` 会在打包前执行前端测试、Rust 测试、浏览器回归和版本检查，然后收集各平台产物、签名更新包与校验和。

可直接调整的工作流骨架：

```yaml
strategy:
  matrix:
    include:
      - os: windows-latest
        target: x86_64-pc-windows-msvc
      - os: ubuntu-latest
        target: x86_64-unknown-linux-gnu
      - os: macos-latest
        target: aarch64-apple-darwin
steps:
  - run: npm run ci:desktop
  - run: cargo test --manifest-path src-tauri/Cargo.toml
  - run: npm run tauri -- build --target ${{ matrix.target }}
```

实际签名步骤必须放在受保护 CI 环境。私钥只能由该环境读取，永远不应进入仓库、文档、聊天记录或安装包。

### 6.3 OTA 清单与原子更新

OTA 清单应该包含版本、平台下载地址、文件签名和必要的发布说明。客户端只信任预置的**公开验证材料**，下载后验证签名与版本，再安装。

更新前后必须保护用户数据：

```text
更新前：暂停任务 -> 取消流式请求 -> 创建账本/配置快照
安装后：校验账本可打开 -> 恢复队列与检查点 -> 删除临时快照
失败时：保留旧数据和待恢复任务，不清空聊天记录
```

### 6.4 Debian 13 预装与用户数据分离

Papyrus 的 `os-integration/debian13/` 提供 `.deb`/AppImage 安装和 rootfs 预装思路。关键原则是：

- 程序安装在系统目录，例如 `/opt` 与应用菜单目录。
- 用户资料留在 XDG 数据与配置目录，安装、升级、卸载都不删除它们。
- 系统镜像构建只向 rootfs 写程序文件，首次启动由普通用户创建自己的数据目录。
- 安装包先校验发布的 SHA-256，再进行安装。

这使预装到 Debian 系统与用户自行安装使用同一数据布局，升级也不会丢失对话和长期记忆。

---

## 7. 接入顺序与验证门禁

### 7.1 推荐接入顺序

不要一次性把“长期记忆、蜂群、Computer Use、OTA”一起接入一个既有 Agent。推荐按以下次序合并，每一步都保持可发布：

1. 接入 `WorkAssistantEvent` 风格的运行事件和时间线，先让现有单 Agent 可观察、可取消。
2. 接入项目账本与检查点，并在所有查询 API 上强制 `projectId`。
3. 接入动态采样与 `low` 禁止子 Agent；用指标确认成本和格式稳定性。
4. 只接入一个只读本机工具，完成 preview/receipt、授权根和过期检查。
5. 接入高风险工具时，再增加单次批准、令牌消费、目标重校验和恢复回执。
6. 最后启用受预算限制的子 Agent；先做研究/审校，不给工作者原生执行权限。

### 7.2 必须保持的接口不变量

| 模块 | 不变量 |
| --- | --- |
| Ledger | 每个任务都有 `projectId`；默认查询不跨项目；敏感内容不入库、不入 FTS |
| Sampling | 缓存键包含阶段和参数；工具 JSON/审校使用稳定采样；`low` 不扇出工作者 |
| Tool protocol | 模型只输出一个经过 schema 校验的 JSON 意图；解析失败时零执行 |
| Preview | 预览 ID 绑定任务、参数、目标身份、风险与过期时间 |
| Approval | 高风险操作只能单次批准；令牌被消费后不可重放，也不可跨任务使用 |
| Native action | 执行前重新验证目标；失败时 fail closed；返回脱敏回执 |
| Browser | 控制只发生在显式配对的当前页面版本；敏感页面不可快照、不可动作 |
| Release | 安装包、OTA 清单和版本源一致；升级不能删除 XDG 用户数据 |

### 7.3 自动化测试门禁

- 项目隔离、FTS 中文检索、敏感记忆拒绝、检查点恢复。
- 每个采样阶段和强度档的输出预算；`low` 无子 Agent。
- 简单任务不创建计划、工具或子 Agent。
- 工具 JSON 的代码围栏解析、一次格式修复、第二次失败零执行。
- 预览过期、目标身份变化、批准令牌复用与跨任务复用均被拒绝。
- 终端只允许固定诊断操作；浏览器敏感页面不可操作。

### 7.4 真实设备验证

| 平台 | 至少验证 |
| --- | --- |
| Windows 10/11 | 安装、更新、应用启动确认、文件预览、浏览器配对 |
| Debian 13 | DEB/AppImage、XDG 数据保留、图形会话、受控工具能力 |
| macOS | 构建、启动、权限不足时的清晰降级提示 |

“构建成功”不是全部验证。每个平台都至少应做一次真实安装、启动、更新和数据保留检查。

---

## 8. 可复用的变更模板

### 8.1 新增一种长期记忆

1. 在账本层定义受限 `kind`，并补上迁移与修订记录。
2. 明确它属于 `personal` 还是 `project`；不要让调用方自行决定跨项目可见性。
3. 经过敏感内容过滤后写主表和 FTS。
4. 只将经确认或工具验证的条目注入上下文。
5. 添加“隔离、删除、回滚、重启恢复、FTS 不泄漏”的测试。

### 8.2 新增一种原生工具

1. 在协议层定义固定 `toolName`、严格参数 schema 和风险默认值。
2. 在原生层构造 Preview；该步骤不应产生外部副作用。
3. 将 Preview 的修订和目标身份写入一次性批准状态。
4. 执行器只接受 Preview ID 与批准令牌，重新校验后执行固定原语。
5. 返回不含敏感数据的 receipt，并通过事件流显示真实状态。
6. 先覆盖拒绝路径，再覆盖成功路径：未批准、过期、参数变化、取消、重放、部分失败。

### 8.3 新增一个子 Agent 角色

1. 定义输入摘要、输出 schema、最大字符数和允许引用来源。
2. 将角色注册进任务分类器，但让简单任务走主 Agent。
3. 为角色设置明确预算并禁止原生工具。
4. 汇总前做冲突检测与来源审校，不将多个输出直接拼接给用户。
5. 添加超时、空结果、重复结果、取消和费用上限测试。

## 9. 采用边界

这些模式可以移植到 Tauri、Electron、原生桌面程序或受控浏览器扩展；具体系统 API 可以替换，但“结构化意图、原生验证、用户批准、一次性执行、脱敏回执”的安全链路不能省略。可靠的秘书 Agent 不靠给模型更大权限，而靠让每一次真实世界动作可验证、可拒绝、可追溯、可恢复。

## 10. 实战踩坑与排查笔记

下面这些不是抽象原则，而是开发和发布时真正花过时间的问题。遇到类似现象时，先按证据排查，不要先改 Prompt。

### 10.1 发布通过但用户拿到旧版本

发布检查至少要有四个独立证据：

```text
CI 全绿
  -> GitHub Release 资产齐全
  -> latest.json 的版本、URL、签名和资产匹配
  -> 每个线上域名返回同一份清单
```

服务器部署时记录以下内容：

- 远端备份目录和时间戳。
- 本地文件哈希与远端文件哈希。
- PM2 每个实例的重启时间和状态。
- `latest.json` 的版本和四个平台签名是否与 Release 一致。

只看到 PM2 `online` 不够；旧进程也可能保持在线但没有加载新代码。反过来，部署命令返回成功也不够，PowerShell/SSH 的变量转义错误可能让脚本没有安装任何文件。

### 10.2 Windows、macOS 和 Linux 的测试差异

跨平台代码最容易在测试夹具上自欺欺人：

- Windows 的 `.exe` 路径、注册表和文件锁行为不能用 Linux 的可执行脚本代替。
- macOS 应用是 bundle，不是一个带 `.app` 后缀的普通文件；测试至少要创建 `Info.plist` 和 `Contents/MacOS`。
- Debian/Wayland 下，屏幕录制和 AT-SPI 可能因为桌面会话权限不可用。能力不可用时应返回诊断，不要偷偷降级为无权限截图或模拟点击。
- CI 的“构建成功”不等于实机的 WebView、托盘、权限和数据迁移成功。每个一级支持平台都要做一次真实安装和升级。

### 10.3 工具事件和对话正文错位

流式正文、工具事件、审批卡和子 Agent 事件来自不同异步源。没有统一序号时，工具卡可能先于模型解释出现，或者失败消息已经显示，旧的工具事件又被补进时间线。

实用做法是给每个事件带上：

```ts
{ runId, sequence, phase, eventId, createdAt }
```

前端按 `runId + sequence` 合并，终态事件只接受一次。重试必须开始新的 `runId`，取消和失败不能复用旧事件流。这样既能消除重复错误卡，也能避免用户误以为工具执行了两遍。

### 10.4 记忆迁移和升级的最后一道检查

数据库文件存在，不代表数据可恢复。升级前后至少验证：

1. SQLite 可以打开，迁移版本完整。
2. 项目、对话、记忆和检查点数量没有异常归零。
3. 当前任务仍绑定原来的 `projectId`。
4. 旧版本备份仍可读，失败时能回滚或人工恢复。

如果初始化 SQLite 失败，应该停用新的持久调度并保留旧数据；不要为了让界面“看起来正常”而悄悄写入另一套临时数据库。

### 10.5 一条适合交接时使用的排查记录

每次上线或重大故障都留一条简短记录即可，不必写成日报：

```text
时间：2026-07-30 14:20
版本：1.1.1
现象：Auto 请求返回 503，未执行工具
客户端：endpoint、status、error.type、resolved model、首 token=否
服务端：PM2 状态、网关日志 request id、上游状态
处理：刷新目录/回滚清单/重载实例/等待上游
结果：是否恢复，是否产生扣费，数据快照位置
```

这类记录比“已修复”“服务正常”更有用，因为下一位维护者可以从同一组事实继续排查。

### 10.6 从 Windows 版本适配到 Linux

Agent 软件从 Windows 移植到 Linux 时，最容易出问题的不是模型接口，而是默认环境假设。Windows 版本常常默认有注册表、PowerShell、固定盘符、桌面会话和完整的 UI Automation；这些条件在 Linux 上都不成立。适配时应先列出依赖，再逐项给出 Linux 实现或明确的能力提示，不要用一个“兼容模式”把失败吞掉。

几个实际经验：

- **路径和数据目录要交给系统决定。** 不要把 `C:\Users\...`、反斜杠或工作区写死在 Agent 上。Linux 下使用 XDG 数据目录，配置、账本、缓存和日志分开存放；展示给模型的仍然只应是相对路径和安全摘要。
- **进程启动不能照搬 Windows 命令。** `start`、`cmd /C`、PowerShell 和 `.exe` 都不能作为通用启动方式。应用启动应使用平台适配层，Linux 只从受信任的桌面入口或固定应用目录中选择目标，并在执行前重新校验文件身份。
- **桌面能力取决于会话。** X11、Wayland、GNOME、KDE、无桌面环境的权限和可用接口不同。屏幕观察、窗口聚焦和键盘输入失败时，要返回缺少什么权限或组件；不能偷偷改用未经授权的截图或模拟点击。
- **终端工具要按平台重新收窄。** Windows 上验证过的 Git 目录、参数和输出限制，在 Linux 上仍要重新验证。不要因为 Linux 有 Bash 就开放 Shell；结构化的 `git_status`、`git_diff_stat`、`git_branch` 等固定操作更容易审计。
- **浏览器桥接不等于浏览器已安装。** Linux 发行版可能使用 Chrome、Chromium、Firefox 或企业定制浏览器。桥接扩展、浏览器包名、Wayland 窗口权限和用户会话都应分别检查，未配对时给出明确入口，不要让模型声称“已经打开”或“已经点击”。
- **安装包和升级路径必须单独测试。** `.deb`、AppImage 和手动解压不是同一种安装方式。升级前要验证用户目录、SQLite 账本和待恢复任务仍在，不能只检查程序能否启动。AppImage 还要确认执行权限、FUSE 或兼容运行方式。
- **先做诊断命令，再做完整 Agent 流程。** Linux 适配的首个版本应有只读 doctor，检查 WebView、SQLite、桌面会话、AT-SPI、Portal、Browser Bridge 和更新助手。诊断结果要能区分“未安装”“无权限”“当前会话不支持”和“程序本身故障”。

适配完成的标准不是“在 Linux 上能打开窗口”，而是同一条任务链能够得到一致的安全结论：模型提出意图，原生层预览和校验，用户确认高风险动作，执行器返回脱敏回执；平台差异只影响能力是否可用，不应改变审批和拒绝规则。
