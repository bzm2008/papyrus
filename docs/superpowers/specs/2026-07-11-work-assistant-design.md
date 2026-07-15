# Papyrus 桌面电脑助手设计规格

- 日期：2026-07-11
- 状态：已确认，等待书面规格复核
- 目标版本：Papyrus 桌面端后续版本
- 适用平台：Windows、macOS、Linux
- 参考项目：[NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)

## 1. 摘要

Papyrus 的秘书模式将从以写作、检索和文稿编排为主的 Agent 工作台，扩展为本地优先的电脑管家与工作助手。首期覆盖两类能力：

1. 本机工作流：授权目录扫描、文件检索、分类与归档计划、复制、移动、重命名、回收站删除、打开文件或应用、下载目录整理和基础系统状态。
2. 浏览器协作：搜索、网页正文提取、资料归档、打开页面、连接用户主动授权的浏览器标签页、生成并填写表单草稿、管理下载项，以及在用户逐次确认后提交普通表单。

实现采用“原生受控能力层”。模型不能直接调用 Shell、执行任意代码或接管全屏鼠标键盘。所有能力均通过声明式工具注册、风险判定、执行前预览、用户审批、平台适配和审计回执完成。

## 2. 当前状态与问题

Papyrus 已具备秘书模式、`/plan`、`/goal`、Todo、Agent 步骤、Flow Trace、Hive 编排、模型流式输出、文稿补丁和右侧工作台。当前可调用工具仅包含联网搜索、项目上下文和文稿补丁，Tauri 后端主要提供文件读取、目录扫描、模型代理、搜索和打开外部 URL。

现有结构存在以下限制：

- `agentOrchestrator.ts` 同时承担规划、模型路由、工具选择、子 Agent 编排和文稿写入，继续加入电脑控制会扩大耦合与风险面。
- `src-tauri/src/lib.rs` 集中了多数原生命令，缺少工具清单、授权根目录、风险等级、预览和审计层。
- 当前 `read_text_file`、`read_binary_file` 和 `scan_project_folder` 接收路径后直接访问，不能作为未来 Agent 工具的权限边界。
- MCP 配置面板已存在，但 stdio 运行时仍为预留状态，不适合作为首期电脑助手的核心依赖。
- 当前消息、工具、审批和子 Agent 事件没有统一、可恢复的事件协议。

## 3. 目标与非目标

### 3.1 目标

- Windows、macOS、Linux 使用相同的前端协议、审批规则和回执结构。
- 所有写操作在执行前展示目标、影响范围、冲突处理和可撤销性。
- 文件工具只能访问用户明确授权的工作区和下载目录。
- 浏览器增强能力只作用于用户主动连接的当前标签页。
- 流式文本、工具事件、审批和子 Agent 进度按真实顺序显示，并可取消、恢复和去重。
- 简单任务继续使用单 Agent；只有现有分类器判断为复杂任务时才调度子 Agent 或 Hive。
- 审计数据保存在本机，不上传文件路径、页面内容或浏览器活动到 Scallion。

### 3.2 非目标

- 不向模型开放任意 Shell、PowerShell、AppleScript、Bash、终端或代码执行工具。
- 不提供全屏截图驱动的通用鼠标键盘接管。
- 不读取浏览器 Cookie、历史记录、其他标签页、密码管理器或隐藏表单字段。
- 不处理密码、验证码、银行卡、支付、账号安全设置和系统权限设置页面。
- 不让定时任务在无人值守时执行文件变更、表单提交或对外发送。
- 不在本阶段重构 Scallion 服务端、Remote Relay 或长期记忆系统。
- 不承诺兼容所有浏览器；增强桥接首期支持 Windows、macOS、Linux 上的 Chromium 系浏览器。

## 4. Hermes 借鉴范围

Papyrus 借鉴 Hermes 的边界和交互模式，不复制其 Python 运行时或通用终端：

- `toolsets.py`：组合式工具集和按场景收窄工具面。
- `tools/registry.py` 与工具运行文档：工具注册、可用性检查、统一派发和结构化错误。
- `tools/approval.py`：会话审批、不可绕过的硬阻断、敏感目标保护和审批关联 ID。
- `agent/tool_guardrails.py`：相同参数重复失败、无进展循环和工具滥用熔断。
- `tools/computer_use/permissions.py`：平台能力健康检查、第三方子进程环境清洗和明确的可用状态。
- Hermes Desktop 消息流：合并 token 增量、工具事件前刷新文本、按稳定 ID 更新工具行、取消后丢弃迟到事件。
- Hermes Desktop UI：工具步骤内联、审批紧贴工具行、子 Agent 状态集中在输入区上方、右侧栏用于目标检查和结果预览。

Papyrus 不采用 Hermes 的永久危险命令许可、YOLO 模式、通用终端后端或全功能 Computer Use 驱动。

## 5. 总体架构

```text
用户请求
  -> 秘书任务分类与规划
  -> Work Assistant Tool Router
  -> Capability Registry
  -> Policy Engine
  -> Preview Builder
  -> Inline Approval
  -> Tauri Capability Broker
  -> Platform Adapter / Browser Bridge
  -> Structured Result + Local Audit
  -> Agent 继续执行或生成最终回执
```

### 5.1 前端职责

- 将用户请求分类为写作任务、工作区任务、浏览器任务或混合任务。
- 只向模型暴露当前平台可用且用户已启用的工具 schema。
- 管理运行事件、审批状态、取消信号、重试边界和 UI 展示。
- 在模型请求工具后调用本地策略检查，不相信模型提供的风险等级。
- 将工具结果以受限摘要返回模型，将完整路径和详细差异保留在本地 UI。

### 5.2 Rust 职责

- 保存授权根目录和平台能力状态。
- 规范化路径，验证目录边界、符号链接、挂载点和执行前快照。
- 构建写操作预览，并验证批准的预览未过期。
- 执行固定能力，不接受任意命令字符串。
- 产生结构化结果、错误分类、撤销提示和审计记录。
- 管理仅绑定回环地址的 Browser Bridge 会话。

### 5.3 浏览器扩展职责

- 由用户主动连接当前标签页，并显示连接状态。
- 返回当前页的可访问 DOM 摘要和明确可交互元素，不返回 Cookie 或存储数据。
- 执行点击、滚动、普通文本填写和下载触发等受控动作。
- 在页面导航、刷新或 DOM 快照失效后拒绝旧动作。
- 在密码、验证码、支付和账号安全页面上拒绝读取或执行。

## 6. 工具集与首期能力

### 6.1 `workspace` 工具集

| 工具 | 行为 | 默认风险 |
|---|---|---|
| `workspace_list` | 列出授权根目录和能力状态 | 读取 |
| `workspace_scan` | 限深度扫描目录，返回统计和摘要 | 读取 |
| `file_search` | 按名称、扩展名、时间和可选文本搜索 | 读取 |
| `file_inspect` | 读取元数据和受支持文本摘要 | 读取 |
| `file_plan_batch` | 生成复制、移动、重命名、建目录或回收站计划 | 读取 |
| `file_apply_batch` | 执行已批准且未过期的批量计划 | 可逆变更或高风险 |
| `file_open` | 使用系统默认程序打开普通文件或目录 | 可逆变更 |
| `downloads_scan` | 扫描已授权下载目录并生成整理建议 | 读取 |

`file_apply_batch` 不接受模型直接提交的任意操作列表。它只能执行由 Rust `Preview Builder` 生成并签名的预览 ID。

`file_open` 拒绝可执行文件、脚本、安装包、快捷方式和其他可启动格式。这些目标只能通过用户预先注册的 `desktop_open_app` 应用别名打开。

### 6.2 `desktop` 工具集

| 工具 | 行为 | 默认风险 |
|---|---|---|
| `desktop_status` | 返回 CPU、内存、磁盘和平台能力状态 | 读取 |
| `desktop_open_url` | 使用默认浏览器打开 HTTP(S) URL | 可逆变更 |
| `desktop_open_app` | 打开用户预先注册的应用别名 | 高风险 |
| `desktop_reveal_file` | 在系统文件管理器中定位文件 | 可逆变更 |

`desktop_open_app` 只接受用户在设置页注册的应用 ID。模型不能传入可执行文件路径、命令行参数或环境变量。

### 6.3 `browser` 工具集

| 工具 | 行为 | 默认风险 |
|---|---|---|
| `web_search` | 现有联网搜索 | 读取 |
| `web_extract` | 提取公开网页正文、标题和来源 | 读取 |
| `web_archive` | 保存网页摘要或正文为 Papyrus 项目资源 | 可逆变更 |
| `browser_open` | 打开页面或切换到已连接标签页 | 可逆变更 |
| `browser_snapshot` | 获取当前授权标签页的可访问页面摘要 | 读取 |
| `browser_fill_draft` | 将普通文本填入预览中指定的字段 | 可逆变更 |
| `browser_click` | 点击预览中指定的普通元素 | 按元素语义判定 |
| `browser_download` | 触发已确认的普通下载 | 可逆变更 |
| `browser_submit` | 提交普通表单 | 高风险，每次确认 |

页面被判定为密码、验证码、支付、账号安全、浏览器扩展/权限管理或本机与内网管理控制台时，`browser_fill_draft`、`browser_click`、`browser_download` 和 `browser_submit` 不进入审批，而是直接阻断。

`browser_click` 的风险由本地策略根据元素角色、可访问名称、所属表单和目标 URL 判定。删除、发送、发布、授权、安装、外部跳转和任何提交语义自动升级为 `high`；策略无法确定含义时也按 `high` 处理。

### 6.4 `project` 工具集

- 将文件或网页结果导入现有资源系统。
- 将工作结果转为 Todo、秘书计划或文稿补丁。
- 不直接修改外部文件；外部文件变更仍由 `workspace` 工具集执行。

## 7. 权限与审批模型

### 7.1 风险等级

1. `read`：授权范围内的只读操作，可自动执行。
2. `reversible`：复制、移动、重命名、建目录、打开应用、普通字段填写和下载，需要预览后批准；允许“执行一次”或受严格作用域约束的“本轮允许”。
3. `high`：覆盖、回收站删除、外部程序启动、表单提交、发送和发布，每次单独批准，不允许会话或永久许可。
4. `blocked`：任意命令执行、永久删除、密码/验证码/支付/账号安全操作、越过授权根目录、读取凭据和修改 Papyrus 安全配置，始终拒绝。

### 7.2 审批关联

每个审批请求必须包含：

- `runId`
- `toolCallId`
- `approvalId`
- 工具名称和用户可读意图
- 风险等级和触发原因
- 目标路径、域名或标签页
- 影响数量和冲突策略
- `previewRevision`
- 是否可撤销
- 过期时间

批准只对这组关联 ID 和 revision 生效。路径、页面、标签页、表单字段或文件元数据发生变化后，旧批准自动失效。

“本轮允许”不是工具级通配许可。文件操作必须同时匹配工具、授权根目录、目标父目录、冲突策略和不超过原批准的数量上限；浏览器填写必须匹配当前 origin、标签页和普通字段类别。覆盖、删除、应用启动、下载、外部跳转、发送、发布和表单提交不支持“本轮允许”。

### 7.3 工作区边界

- 授权目录由系统文件夹选择器产生，Agent 不能自行新增。
- 路径在预览和执行阶段均执行 canonicalize 和根目录包含检查。
- Windows 路径比较处理盘符、UNC 和大小写；macOS/Linux 处理符号链接和挂载点。
- 默认忽略隐藏目录、系统目录、凭据文件和大型二进制文件；用户可在设置中显式调整普通忽略规则，但不能关闭硬阻断。
- 批量操作设置文件数和总字节上限，超过上限必须拆分为多个审批批次。

## 8. Browser Bridge 协议

增强浏览器能力使用 Papyrus Browser Bridge Chromium 扩展，Windows、macOS、Linux 使用同一扩展代码和协议。

### 8.1 连接方式

- Tauri 仅在 `127.0.0.1` 上启动临时 WebSocket 服务，不监听局域网地址。
- 每次配对生成高熵一次性 token、会话 nonce 和过期时间。
- 扩展需要用户在弹出页中主动选择“连接当前标签页”。
- 会话绑定扩展 ID、标签页 ID、当前 origin 和导航 revision。
- 应用退出、用户断开、标签页关闭或超时后立即失效。

### 8.2 页面数据边界

- 只返回可访问名称、角色、普通文本摘要、元素边界和受限属性。
- 不读取 Cookie、LocalStorage、SessionStorage、浏览历史、其他标签页或扩展数据。
- `input[type=password]`、验证码、支付、身份验证和隐藏字段从 schema 中移除。
- 页面正文与表单值仅在本轮任务中使用；除非用户明确归档，否则不写入长期记忆。
- `web_extract` 和 Browser Bridge 均拒绝 localhost、回环、链路本地、私网、云元数据地址及跳转到这些地址的请求。

### 8.3 动作安全

- 每个动作引用 `pageRevision` 和稳定元素 token。
- 页面导航或 DOM 结构变化后，旧元素 token 返回 stale 错误，不重新猜测目标。
- 提交动作必须展示域名、表单目标、可见字段摘要和按钮名称。
- 下载完成后只将文件交给已授权下载目录工作流，不自动打开可执行文件。

## 9. 统一事件流与消息状态

### 9.1 事件类型

```ts
type WorkAssistantEvent =
  | { type: 'run.started'; runId: string; at: number }
  | { type: 'message.delta'; runId: string; messageId: string; delta: string; at: number }
  | { type: 'stage.changed'; runId: string; stage: string; detail?: string; at: number }
  | { type: 'tool.started'; runId: string; toolCall: AssistantToolCall; at: number }
  | { type: 'tool.progress'; runId: string; toolCallId: string; progress: AssistantToolProgress; at: number }
  | { type: 'approval.required'; runId: string; request: AssistantApprovalRequest; at: number }
  | { type: 'tool.completed'; runId: string; toolCallId: string; result: AssistantToolResult; at: number }
  | { type: 'subagent.started'; runId: string; subagent: AssistantSubagent; at: number }
  | { type: 'subagent.progress'; runId: string; subagentId: string; progress: AssistantSubagentProgress; at: number }
  | { type: 'subagent.completed'; runId: string; subagentId: string; result: AssistantSubagentResult; at: number }
  | { type: 'run.completed'; runId: string; result: AssistantRunResult; at: number }
  | { type: 'run.failed'; runId: string; error: AssistantRunError; at: number }
  | { type: 'run.cancelled'; runId: string; at: number }
```

### 9.2 流式规则

- 文本 delta 先进入每个 run 的队列，按 30–50ms 合并刷新。
- 工具或审批事件到达时，先同步刷新此前 delta，防止工具行跳到前文之前。
- 工具行按 `toolCallId` upsert；开始、进度、审批和结果更新同一行。
- 最终回复是规范结果。完成时替换流式文本并去重，不追加重复消息。
- 用户取消后将 run 标记为 interrupted，所有迟到 delta、工具事件和完成事件被丢弃。
- 连续 2 秒没有可见输出且不在等待用户输入时显示轻量“仍在处理”和耗时。
- 等待审批时状态明确显示“等待你的确认”，不显示思考动画。
- 只展示阶段摘要，不展示模型内部思维链。

### 9.3 子 Agent 展示

每个子 Agent 记录：

- 父级 ID、目标、模型、状态和任务序号
- 当前工具和最近 24 条用户可验证进度
- 已读取和已变更的对象
- 耗时、工具数量和最终摘要
- 失败、取消或中断原因

子 Agent 不各自生成聊天气泡。输入区上方显示折叠状态组，右侧工作台展示父子树和详细进度。完成后只将结构化摘要交给秘书长聚合。

## 10. UI 与布局

### 10.1 主对话区

- 助手消息按文本、工具步骤、审批和最终回执组成连续任务时间线。
- 工具步骤默认一行显示图标、动作、目标、状态和耗时。
- 展开后显示参数摘要、影响范围、来源、差异、错误和复制操作。
- 审批控件直接位于触发审批的工具行下方。
- 流式更新只重绘文本叶节点和对应工具行，消息页脚与右侧预览保持稳定，避免布局抖动。

### 10.2 输入区状态栈

- Todo、子 Agent、后台工具和输入队列统一显示在输入框上方。
- 默认折叠子 Agent 和后台工具，Todo 保持展开。
- 状态栈与输入框形成一个连续表面，但不遮挡最后一条消息。
- 用户可停止仍在运行的后台工具或打开子 Agent 详情。

### 10.3 右侧工作台

右侧工作台包含：

- `运行`：Todo、Agent、工具、错误、耗时和最终回执。
- `文件`：授权目录、文件树、批量差异、冲突和撤销提示。
- `浏览器`：Bridge 状态、已连接标签页、页面摘要、字段草稿、下载项和网站权限。
- `文稿`：保留现有编辑器视图。

工具选中文件或页面目标时自动切换到对应预览。用户手动关闭后，本轮不强制重新打开。

### 10.4 设置页

新增“电脑助手”分区：

- 授权工作区和下载目录
- 用户注册的应用别名
- 工具集开关与平台可用状态
- Browser Bridge 安装、配对和断开
- 最近审批与本地审计清理
- 权限健康检查和诊断结果

视觉继续沿用 Papyrus 现有纸白、墨色、绿色完成态和红色风险态。借鉴 Hermes 的信息层级、内联审批和右侧预览，不复制其品牌样式。

## 11. 核心类型

```ts
type AssistantRiskLevel = 'read' | 'reversible' | 'high' | 'blocked'
type AssistantToolStatus =
  | 'queued'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'

type AssistantToolManifest = {
  name: string
  toolset: 'workspace' | 'desktop' | 'browser' | 'project'
  description: string
  risk: AssistantRiskLevel
  supportedPlatforms: Array<'windows' | 'macos' | 'linux'>
  availability: AssistantCapabilityAvailability
  inputSchema: Record<string, unknown>
  previewRequired: boolean
  reversible: boolean
}

type AssistantToolCall = {
  id: string
  runId: string
  name: string
  intent: string
  arguments: Record<string, unknown>
  status: AssistantToolStatus
  createdAt: number
}

type AssistantApprovalRequest = {
  id: string
  runId: string
  toolCallId: string
  risk: AssistantRiskLevel
  reason: string
  targetSummary: string
  impactSummary: string
  previewRevision: string
  reversible: boolean
  expiresAt: number
}
```

详细参数类型按工具拆分，避免一个全局联合类型持续膨胀。

## 12. 模块拆分

将新增前端模块：

- `src/services/workAssistantProtocol.ts`
- `src/services/workAssistantRegistry.ts`
- `src/services/workAssistantRuntime.ts`
- `src/services/workAssistantPolicy.ts`
- `src/services/browserBridgeClient.ts`
- `src/services/workAssistantEventReducer.ts`
- `src/components/SecretaryToolStep.tsx`
- `src/components/SecretaryToolApproval.tsx`
- `src/components/SecretaryFileWorkbench.tsx`
- `src/components/SecretaryBrowserWorkbench.tsx`
- `src/components/SecretarySubagentStatus.tsx`

将新增 Rust 模块：

- `src-tauri/src/work_assistant/mod.rs`
- `src-tauri/src/work_assistant/types.rs`
- `src-tauri/src/work_assistant/registry.rs`
- `src-tauri/src/work_assistant/policy.rs`
- `src-tauri/src/work_assistant/workspace.rs`
- `src-tauri/src/work_assistant/desktop.rs`
- `src-tauri/src/work_assistant/browser_bridge.rs`
- `src-tauri/src/work_assistant/audit.rs`
- `src-tauri/src/work_assistant/platform/windows.rs`
- `src-tauri/src/work_assistant/platform/macos.rs`
- `src-tauri/src/work_assistant/platform/linux.rs`

浏览器扩展位于：

- `apps/browser-bridge/`

现有 `agentOrchestrator.ts` 只负责决定何时请求工具和如何聚合结果；不直接包含文件、浏览器或平台实现。现有 `lib.rs` 只注册新的模块命令。

## 13. 跨平台适配矩阵

| 能力 | Windows | macOS | Linux |
|---|---|---|---|
| 文件扫描、复制、移动、重命名 | Rust 标准实现 | Rust 标准实现 | Rust 标准实现 |
| 回收站删除 | Rust `trash` crate | Rust `trash` crate | Rust `trash` crate/Freedesktop Trash |
| 打开文件、目录和 URL | ShellExecute 类固定适配 | Launch Services 固定适配 | `xdg-open` 固定参数适配 |
| 文件管理器定位 | Explorer 定位 | Finder Reveal | 打开父目录并选中能力降级 |
| 系统状态 | `sysinfo` | `sysinfo` | `sysinfo` |
| 下载目录 | OS 已知目录 | OS 已知目录 | XDG 用户目录 |
| 网页搜索和提取 | Rust HTTP | Rust HTTP | Rust HTTP |
| Browser Bridge | Chromium MV3 | Chromium MV3 | Chromium MV3 |
| 路径安全 | 盘符、UNC、大小写 | 符号链接、卷 | 符号链接、挂载点、XDG |

Linux 不保证所有桌面环境都支持“在文件管理器中选中具体文件”。无法选中时打开父目录，并在回执中明确标记降级。其他核心能力不得静默降级。

## 14. 错误处理、取消与重试

错误分类包括：

- `permission_denied`
- `capability_unavailable`
- `path_outside_workspace`
- `stale_preview`
- `conflict`
- `network`
- `browser_disconnected`
- `page_restricted`
- `user_cancelled`
- `timeout`
- `protocol`
- `internal`

规则：

- 写操作失败后不自动重试，保留已完成项和未执行项。
- 只读网络操作可在未返回结果时受控重试一次。
- 浏览器导航或元素失效后重新生成快照，不自动点击新目标。
- 文件批次以单项原子操作执行；取消在当前单项结束后停止后续项。
- 所有失败状态保留原请求、预览、批准和结果，重试复用同一聊天消息并生成新的 tool call ID。
- 相同参数连续失败或连续返回相同无进展结果时触发工具熔断，并要求 Agent 改变策略或向用户说明。

## 15. 本地审计与隐私

审计记录包含：

- run、tool call 和 approval 关联 ID
- 工具名称、风险等级、时间和状态
- 目标的本地显示摘要
- 预览 revision 和用户决策
- 结构化结果、错误分类和撤销提示

默认不记录完整文件内容、完整网页正文、表单值、密码或凭据。审计存储在 Tauri 应用数据目录，设置页可查看和清理。Scallion 只继续处理登录、模型代理、额度和更新，不新增电脑活动上传接口。

## 16. 测试策略

### 16.1 TypeScript 单元测试

- 工具注册、工具集过滤和平台可用性。
- 风险等级不能被模型输入覆盖。
- 文本 delta 合并、工具事件前 flush 和最终消息去重。
- 取消后迟到事件丢弃。
- 工具调用 upsert 和审批关联。
- stale preview、过期审批和重复执行阻断。
- 子 Agent 父子树、状态聚合和终态不可回退。
- 相同参数失败和无进展循环熔断。

### 16.2 Rust 单元测试

- Windows 盘符、UNC、大小写和路径穿越。
- macOS/Linux 符号链接、父级跳转和挂载点边界。
- 文件快照 revision、冲突检测和批次限制。
- 复制、移动、重命名、建目录和回收站删除。
- 固定应用别名和 URL 参数验证。
- Browser Bridge token、origin、tab 和 page revision 校验。
- SSRF、私网地址、重定向和危险下载限制。

### 16.3 集成测试

- 浏览器 Mock Bridge 覆盖连接、导航、快照、填写、下载、提交审批和断开。
- Mock Tauri 覆盖主对话、内联审批、右侧预览、取消和重试。
- 混合任务覆盖“搜索网页 -> 归档 -> 整理下载 -> 生成文稿补丁”。
- 简单任务验证不启动子 Agent；复杂任务验证子 Agent 状态和聚合。

### 16.4 三平台发布门槛

GitHub Actions 在 Windows、macOS、Ubuntu 上执行：

- TypeScript 构建与测试
- Rust check 与测试
- Tauri 打包检查
- Browser Bridge 构建与协议测试
- Chromium 自动化集成测试

正式发布前，在三种真实系统上手测：

- 授权目录和撤销授权
- 批量复制、移动、重命名、冲突和取消
- 回收站恢复路径
- 打开文件、目录、URL 和注册应用
- 网页提取、归档和下载整理
- Browser Bridge 配对、断开、页面变更和禁区阻断
- 表单草稿填写与提交前确认
- 流式消息、工具行、审批、子 Agent 和失败重试

任一平台未通过，不将该版本标记为三平台完成。

## 17. 分阶段交付

### 阶段 1：受控运行时与文件工作流

- 工具注册、策略、审批、审计和事件 reducer
- 授权工作区与文件工具
- 流式时间线、工具行、内联审批和子 Agent 状态栈
- Windows/macOS/Linux 文件与系统打开适配

### 阶段 2：浏览器基础能力

- 安全网页提取和资料归档
- 浏览器右侧预览和下载目录工作流
- Browser Bridge 回环协议、扩展骨架和配对 UI

### 阶段 3：浏览器增强与发布验证

- 标签页快照、普通字段草稿填写、受控点击和下载
- 普通表单提交的逐次审批
- 三平台 CI、安装包和真实设备回归

各阶段以可运行、可测试的纵向闭环交付。阶段 1 不以空 UI 或伪工具代替真实文件能力；阶段 2 不把未连接的浏览器桥接显示为可用；阶段 3 未通过三平台验证前不宣称完成。

## 18. 验收标准

- 用户可在三平台选择工作区并让秘书完成真实的文件扫描、归档预览和批准后执行。
- Agent 无法访问授权根目录外的文件，也无法通过符号链接或路径变体绕过。
- 所有文件写操作均有可验证预览，预览失效后不能执行。
- 用户可在三平台完成 Browser Bridge 配对，并只授权当前标签页。
- 普通表单可以生成和填写草稿；提交前必须逐次确认。
- 密码、验证码、支付和账号安全页面被硬阻断。
- 流式文本、工具调用、审批和子 Agent 事件顺序稳定，无重复消息或重复工具行。
- 取消后没有迟到事件污染下一轮对话。
- 简单请求不触发多 Agent，复杂请求的子 Agent 进度可查看但不淹没聊天。
- Windows、macOS、Linux CI 和真实设备回归均通过。

## 19. 已确认的产品决策

- 采用原生受控能力层，不采用通用 Shell 或独立 Hermes 运行时。
- 首期同时覆盖本机工作流和浏览器协作。
- Windows、macOS、Linux 是同等支持的平台。
- 浏览器增强通过跨平台 Chromium 扩展完成。
- 保留现有秘书模式、`/plan`、`/goal`、技能菜单、Todo、Trace、Hive 和文稿补丁结构。
- 借鉴 Hermes 的工具、审批、流式与 UI 模式，但保持 Papyrus 的技术栈、品牌和安全边界。
