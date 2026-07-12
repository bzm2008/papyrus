# Papyrus Agent 架构与模型治理

这份概念参考说明 Papyrus 如何把模型编排、工作区能力和安全写回分开。Papyrus 可以继续承担写作、研究和审校任务，也可以在授权范围内协助管理本机文件；模型只能提出意图，原生代理负责校验、审批和执行。

## 动态采样

采样策略由 `agentSamplingService` 统一生成，并按阶段区分：

- 分类、规划、检索、裁判、压缩：低温稳定，减少发散和幻觉。
- 子 Agent 输出：中等温度，保留分析空间。
- 正文创作、二稿修复、长篇续写：较高温度，增强想象力和表达变化。
- `low`：降温并缩短输出，适合小任务。
- `medium`：默认平衡。
- `high`：略升温并放宽输出长度。
- `ultra+hive`：创作阶段进一步升温，增加存在惩罚，鼓励新场景、新意象和更充分展开。

重复风险由 `repeatRisk` 传入。若多个 Agent 输出没有新增信息，系统会提高频率惩罚并略降温，防止客套话、循环解释和空转。

## Auto 模型调度

Auto 模式只影响秘书模式和目标模式。写作模式保留手动模型，避免选区改写时模型频繁变动。

模型被分成三档：

- `T1`：中坚模型，负责复杂写作、长篇整合、严肃研究、合规审查和 ultra+hive 聚合。
- `T2`：普通模型，负责常规改写、资料整理、规划、运营和日常秘书任务。
- `T3`：轻量模型，负责分类、摘要、缓存复用、格式整理和重复小任务。

评分采用本地可解释规则，而不是让一个随机 AI 在线评估全部模型。原因是在线评估会消耗额度、结果波动大，也不适合在每次启动时阻塞用户。当前评分综合：

- 模型是否可用、是否验证过。
- 上下文窗口大小。
- 模型名称中的能力信号。
- 是否为文本生成主模型。
- 用户在设置中配置的 T1/T2/T3 权重。

规划、分类、压缩和裁判优先轻量可靠模型；正文生成、复杂推理、二稿修复和 ultra+hive 聚合优先 T1 或大上下文模型。

## Hive 与普通思考强度

`low / medium / high` 也可以调用子 Agent，但会限制规模：

- 简单任务：最多 1 个子 Agent。
- 标准任务：随思考强度约 1-3 个子 Agent。
- 复杂任务：随思考强度约 3-6 个子 Agent。
- 长程目标：随思考强度约 4-8 个子 Agent。
- 长篇小说：随思考强度约 4-8 个子 Agent。

`ultra+hive` 是最大思考强度加蜂巢编排，适合长篇、研究、合规、跨文档、复杂运营和 `/goal`：

```text
秘书长 Router
  -> Worker 小队：研究、结构、成稿、平台策略、专业服务
  -> Reviewer / Judge：事实、风格、合规、目标完成度
  -> 秘书长 Aggregator：整合最终交付
```

Hive 借鉴 Swarms 的 Sequential、Concurrent、Graph、Mixture-of-Agents 思路，以及 Ruflo 的共享记忆、统一协调器和 provider routing 思路，但不引入外部运行时依赖。

## Hive 上限

首次进入应用时，Papyrus 会检测 CPU、内存和 WebGL 暴露的 GPU 线索，并给 `ultra+hive` 设置本机限流：

- `low`：最多 4 个 Agent，并行 1。
- `medium`：最多 6 个 Agent，并行 2。
- `high`：最多 9 个 Agent，并行 3。
- `ultra`：最多 12 个 Agent，并行 4。

这些限制用于避免本机资源被打满。最终可用数量还会受任务复杂度、启用 Agent、用户禁用项和早停机制影响。

## Harness 与可观测性

每次 Agent run 都通过 harness 记录：

- prompt、模式、来源、本地或远程平台。
- 运行状态、摘要、错误和结束时间。
- 生成的文稿补丁与可沉淀记忆。
- todo、执行轨迹、Agent step、Hive telemetry 和 blackboard。

Hive runtime 还包含：

- 全局超时。
- 单 Agent 超时。
- 最多两次退火重试。
- 断路器。
- fallback 输出。
- 早停判断。

这让 Papyrus 能在复杂任务中保持可追踪、可恢复，而不是把多 Agent 协作藏成一团不可解释的长提示词。

## 电脑管家能力的边界

电脑管家模式把本机操作当作受控能力，而不是给模型一个通用终端。模型可以请求工作区列表、扫描、搜索、检查和受限的批量文件计划；写操作只能引用已授权的工作区根、已生成的预览和一次性审批令牌。

原生代理只接受结构化的 `file_plan_batch` 协议。它不会执行模型生成的命令、脚本或任意绝对路径，也不会把回收站、文件管理器或其他桌面程序当作绕过审批的后门。所有写操作都要经过路径策略、身份快照和用户审批；事务再按类型选择原语：复制和跨设备移动需要临时 staging，移入恢复库和覆盖需要 recovery 预检，新目标发布和同卷移动/重命名需要 no-replace。

## 恢复库、回收站与 receipt

需要恢复保护的删除、覆盖、跨设备移动或替换路径会先进入 Papyrus 私有的同卷恢复库。恢复库目录名固定为 `.papyrus-recovery`，位置由原生适配器根据源文件或旧目标所在的授权父目录选择；模型不能提供恢复库路径或目录名。恢复对象使用适配器生成的 UUID 叶子，并保存 `content` 与 `receipt.json`。新目标同卷 `Move` / `Rename` 直接使用 no-replace rename，不产生 recovery 内容。

每个 receipt 都可以由用户追溯和恢复，包含预览 ID、批次序号、原始相对路径、平台文件身份和不透明的恢复库范围标识。receipt 不包含绝对路径，也不依赖操作系统回收站；UI 应显示原始相对路径和可恢复状态，让用户在确认后恢复或定位对象。

系统回收站不是安全原语。若桌面适配器提供系统回收站派发，它只能在私有 recovery receipt 持久化并完成审计后 best-effort 执行；派发失败不能删除或覆盖 Papyrus 的恢复对象，也不能把已完成的操作改报成失败。当前 `file_trash` 的安全语义仍是移动到 `.papyrus-recovery`，不是直接调用系统回收站。

## 跨平台安全原语

三个桌面平台都执行同一组不变量：拒绝链接和重解析点，比较授权根、父目录和源文件身份，保存文件版本与内容摘要，并在提交前重新验证快照。不同操作只启用必要的原语：创建目录只验证父目录并创建一个新叶子；复制到新目标会先 staging，再用 no-replace 发布；同卷移动或重命名直接使用源句柄和 no-replace rename；移入恢复库、覆盖和跨设备移动才需要 recovery receipt。任何身份、路径组件、共享模式或所需预检不匹配都会 fail closed。

| 事务 | 原生执行路径 |
| --- | --- |
| `CreateDirectory` | 校验目标父目录后创建一个新目录叶子，不创建 staging 文件或 recovery 内容 |
| 新目标 `Copy` | 读取已打开的源快照，写入目标父目录的临时 staging 文件，校验摘要后用 no-replace 发布 |
| 新目标同卷 `Move` / `Rename` | 重新验证源快照后，使用平台的相对 no-replace rename；不复制 staging 内容 |
| `Trash` | 将已验证的源文件移动到同卷 `.papyrus-recovery`，写入 receipt |
| 覆盖或跨设备 `Move` / `Rename` | 先 staging 并校验；覆盖时先恢复旧目标，跨设备移动发布并校验副本后再恢复原文件 |

| 平台 | 路径与身份校验 | 原子发布与恢复保护 |
| --- | --- | --- |
| Windows | 使用 `FILE_FLAG_OPEN_REPARSE_POINT` 和 `FileAttributeTagInfo` 拒绝 junction、symbolic link 等 reparse point；比较 `FILE_ID_INFO` 和文件版本；保留受共享模式保护的句柄 | 使用句柄相对的 `NtSetInformationFile(FileRenameInformation)`，设置 no-replace；恢复库目录使用当前用户私有 DACL |
| Linux | 使用 `openat`、`O_NOFOLLOW` 和 `fstatat(AT_SYMLINK_NOFOLLOW)` 逐组件检查；每次写入前从授权根重新绑定并比较设备与 inode 身份 | 使用 `renameat2(RENAME_NOREPLACE)`；内核没有该原语时返回不可用并拒绝降级到普通覆盖式 rename |
| macOS | 使用 `openat`、`O_DIRECTORY`、`O_NOFOLLOW` 和 `fstatat(AT_SYMLINK_NOFOLLOW)` 逐组件检查；每次写入前重新绑定授权根和父目录 | 使用 `renameatx_np(RENAME_EXCL)`；原语不可用时 fail closed，跨设备错误只有在复制、校验和恢复流程可用时才受控降级 |

`work_assistant_capabilities` 的 `available` 字段按编译目标报告平台级支持：Windows、Linux 和 macOS 构建会静态列出原生文件能力，其他目标列为不可用。它不会承诺当前内核或文件系统一定提供每个运行时原语。执行时仍会检查恢复预检、身份和 no-replace 能力；旧内核缺少 `renameat2` 等原语，或运行环境不能建立并清理 receipt 预检文件时，当前事务必须 fail closed，并返回 `recovery_unavailable` 或 `blocked`。UI 应在该次运行中禁用受影响操作，不应把运行时错误误解为 capability 列表已经动态更新。

跨设备移动只在能先复制、校验发布结果，再把原文件移入同卷恢复库时继续，不得改用未经保护的路径操作。

## 并发边界与威胁模型

原生代理可以防御模型参数导致的遍历、链接或重解析点跳转、过期预览以及普通并发修改。Windows 句柄共享策略和 POSIX 每次重新绑定还可以阻止常见的根目录替换和父目录移动。

仍有一个操作系统边界：同一身份的恶意进程如果在 Papyrus 建立快照之前已经持有破坏性 OS 句柄，非特权桌面应用不能完全撤销该句柄的能力。这个边界不等于允许模型控制路径，也不应通过放宽共享模式或取消身份校验来“修复”。能力状态和安全说明必须明确它，出现身份或共享冲突时仍然 fail closed。

## 运行结果与 UI 语义

UI 必须把原生执行结果当作状态机，而不是只显示一条成功或失败消息：

- `completed`：操作已完成；对应条目可带 `recoveryReceipts`，UI 应保留恢复入口
- `cancelled`：用户或运行取消；未发布的条目进入 `remaining`，不伪造 `failed`，允许用户明确重试
- `stale_preview`：快照、身份、版本或摘要不再匹配；预览前不应改变目标或恢复库，提示重新生成预览
- `partial_transaction`：事务可能已经产生部分状态变化，具体是否有 recovery 对象或 receipt 取决于失败条目和已完成步骤；当前失败条目可能只有可恢复的错误码、摘要和调用方保留的 `previewId`，也可能没有 `recoveryReceipts` 或新的 recovery 审计条目。UI 不能声称“没有发生任何变化”，也不能声称当前版本已经能按 `previewId` 自动定位 receipt；后续恢复入口或审计查询必须显式支持这条链路
- `audit_unavailable`：文件事务已经完成，但审计追加失败；保留 `completed` 和 receipt，显示可恢复的审计警告，不回滚文件
- `recovery_cleanup_unavailable`：取消、预检失败或未执行的事务留下空恢复槽清理警告；保留主结果，提示用户重试清理或检查恢复库
- `recovery_unavailable`：恢复库或 receipt 预检失败；批次在审批令牌消耗前停止，不写入目标

错误摘要只返回操作状态和相对上下文，不把绝对路径、恢复库绝对路径或系统诊断原文交给模型。真实 UI/WPS 手测和 Unix/macOS 目标编译属于独立发布门禁；本页不把未执行的验证写成通过。

## 长篇创作增强

长篇小说和连载任务会进入 Story System：

- 写前建立作品合同和章节任务书。
- 任务书包含开篇抓手、本章故事、本章人物、写法约束和章节收束。
- 遵守三条规则：大纲即法律、设定即物理、新实体需入库。
- 按 Quest / Fire / Constellation 控制主线、情感线和世界观比例。
- Reviewer 检查设定、时间线、连续性、人物、逻辑、AI 味和节奏。
- 章节提交后抽取伏笔、读者承诺、人物状态、世界规则和时间线锚点，进入后续上下文。

这套机制的目标是让 Papyrus 能处理百万字级长篇写作，而不是只生成一次性段落。
