# Papyrus Work Assistant 发布测试报告

> 这是跨平台认证报告骨架。只有所有 CI、打包和真实设备记录完成后，才能把状态改为 `pass`。

## 发布元数据

| 字段 | 值 |
| --- | --- |
| Papyrus commit | `21b1427`（远程 `feature/work-assistant` head；包含本地等价提交 `ce64d6c`） |
| Desktop CI run | [29351096131](https://github.com/bzm2008/papyrus/actions/runs/29351096131) |
| Package smoke run | `未触发：workflow 仅存在于非默认分支，Actions API 返回 404` |
| 报告更新时间 | `2026-07-14（三平台 Desktop CI 刷新）` |
| 发布负责人 | `待填写` |
| 总体状态 | `pending` |

## CI 与包产物

| 平台 | CI 状态 | 包 smoke 状态 | 产物/日志 |
| --- | --- | --- | --- |
| Windows 11 / NSIS | pass | pending | Desktop CI run 29351096131 |
| macOS 当前 / app + DMG | pass | pending | Desktop CI run 29351096131 |
| macOS 上一主版本 / app + DMG | pending | pending |  |
| Ubuntu 24.04 GNOME / DEB + AppImage | pass | pending | Desktop CI run 29351096131 |
| 额外 Linux 桌面 / DEB + AppImage | pending | pending |  |

Browser Bridge ZIP 必须出现在每个平台 smoke 产物中，文件名应包含版本号；smoke 产物不能被标记为已签名生产包。

## 真实设备记录

| 记录文件 | 平台 | 浏览器 | 结果 | blocker |
| --- | --- | --- | --- | --- |
| `待添加` | Windows 11 | Edge/Chrome | pending |  |
| `待添加` | macOS 当前 | Chrome | pending |  |
| `待添加` | macOS 上一主版本 | Chrome | pending |  |
| `待添加` | Ubuntu 24.04 GNOME | Chromium/Chrome | pending |  |
| `待添加` | 额外 Linux 桌面 | Chromium/Chrome | pending |  |

每条记录使用 [设备测试记录模板](./testing/WORK_ASSISTANT_TEST_RECORD_TEMPLATE.md)，并覆盖 [跨平台矩阵](./testing/WORK_ASSISTANT_PLATFORM_MATRIX.md) 中的全部案例。

## Blocker 清单

| ID | 描述 | 平台 | 修复/回归证据 | 状态 |
| --- | --- | --- | --- | --- |
| `REL-CERT-PENDING` | smoke 包下载和真实设备矩阵尚未完成；macOS 上一主版本也未覆盖 | all | Desktop CI 29351096131 三平台通过；package workflow 非默认分支无法 dispatch；设备记录待补 | open |

路径逃逸、过期审批执行、受限页面动作、重复执行、崩溃或数据丢失必须保持为 blocker，不能以 warning 关闭。

## 签名边界

Windows 代码签名、macOS 签名与 notarization、Linux 仓库签名以及 Tauri updater 签名只允许在受保护凭据环境中生成。此报告的 CI smoke 包不包含生产签名，也不应通过关闭验证来伪装成最终发布包。

## 当前本地证据（2026-07-14）

以下证据对应当前工作树在 Windows 本机的最后一次完整回归，未使用真实用户文件执行写入：

- `npm run lint`：通过。
- `npm run test:wps`：2 个文件、17 项通过；包含流式 401/403 结构化错误、模型/额度部分成功、stale 保留和套餐权限文案回归。
- `npx tsc -p tsconfig.app.json --noEmit`：通过。
- `npm run test:unit`：35 个文件、166 项通过；包含 `/goal` 取消后不再自动推进回归。
- `npm run check:browser`：扩展语法/构建、前端桥接测试和 Rust Browser Bridge/Web Extract 定向测试通过；Rust Browser Bridge 定向为 33 项，包含注入式私网重定向 fixture。
- `npm run test:browser:e2e`：真实 Chromium 8 项通过，覆盖普通字段、默认 input、contenteditable、下载、表单提交、字段变更 stale、链接 query 变化 stale 和受限页面。
- `npm run build`：生产构建通过；仅有既有动态导入和大 chunk 提示。
- `cargo test --manifest-path src-tauri/Cargo.toml --locked`：Windows 本机 126 项通过；三平台 Desktop CI 同一远程提交全部通过。新增 macOS `O_NOFOLLOW`/`F_GETPATH` 文件读取与 destination symlink 防护已由 macOS/Linux CI 覆盖。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`：通过。
- `npm run tauri:check:portable`：Windows MSVC portable check 通过。
- `npm run browser:package`：生成 5 个运行时文件的 `Papyrus-Browser-Bridge_0.1.2.zip`。
- `npm run test:release-scripts`：11 项通过，覆盖缺失 workflow 语义步骤、checkout SHA/产物命名、脚本 gate、CSP、命令白名单和扩展权限失败场景。
- `npm run wps:build`：WPS 插件 TypeScript、Vite 生产构建和 legacy 入口准备通过。
- Browser Bridge security：覆盖私网重定向/注入 DNS、受限字段、隐藏控件、跨源 tab、wrong-tab、stale snapshot、伪造/重放审批、超大消息和 token 单次使用。
- Work Assistant doctor：Rust 注入式诊断 6 项、TypeScript doctor 2 项通过；无文件、进程或 trash 副作用。
- Browser Bridge workbench/settings：状态分层、当前标签页/来源、健康错误、配对 token 生命周期和受限页面展示回归通过。
- `npm run release:assistant-check`：local/release 两阶段均通过；release 阶段还检查三平台 workflow 的关键命令、手动 dispatch、artifact 上传/保留、commit SHA、签名边界和打包 overlay。
- Scallion 模型/额度契约：模型目录默认请求 `include_unavailable=1`，套餐外模型只读展示并禁用；余额以 `points_balance` 为准；模型目录按 token 去重并设置超时；不确定的 Scallion 网络结果不会自动切换 Tauri 重发。
- WPS 模型/额度同步：`/models` 与 `/quota` 独立更新；单通道失败时保留旧目录/积分并显示 `stale`，无旧值时显示 `error`；成功、402、5xx、超时和流中断后会触发额度刷新，取消和认证失效不重复刷新。
- 跨目标静态检查：本机未安装 Linux/macOS Rust 标准库；对应验证由 Desktop CI 的 Ubuntu/macOS runner 完成。

`npm run ci:desktop`：在停止并发编辑后的稳定工作树上通过；该聚合脚本不包含 Rust、portable MSVC 和真实 Chromium E2E，这些项目已由上面的独立门禁覆盖。`npm run release:assistant-check:local` 与 `npm run release:assistant-check` 均通过。真实用户文件的完整写入/恢复 smoke 尚未执行，不能用临时测试目录替代现场记录。

以上证据包含 Windows 本地回归和远程三平台 CI。平台 smoke 包下载、macOS 上一主版本以及真实设备矩阵仍标记为 `pending`；不把 unsigned smoke 包标记为生产发布。

## 远程仓库证据（2026-07-14）

- 远程 `feature/work-assistant` head 为 `21b1427176fcee2925263ec141bcbda74c6d353f`；Desktop CI run 29351096131 在 Windows、macOS ARM、Ubuntu 24.04 全部通过。
- 该分支的 `.github/workflows/desktop-packages.yml` 尚未出现在默认分支，因此 `workflow_dispatch` 返回 404；没有可引用的 package smoke artifact。
- 真实设备记录、生产签名/公证和 updater 产物仍未执行，不能关闭 `REL-CERT-PENDING`。
