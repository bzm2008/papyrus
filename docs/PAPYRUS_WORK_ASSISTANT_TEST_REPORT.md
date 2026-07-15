# Papyrus Work Assistant 发布测试报告

> 这是跨平台认证报告骨架。只有所有 CI、打包和真实设备记录完成后，才能把状态改为 `pass`。

## 发布元数据

| 字段 | 值 |
| --- | --- |
| Papyrus commit | `fa9203e732b455b4c6a0e379938ab8dd411e3567`（套餐/积分目录、审批 scope、Browser Bridge fail-closed 与 Linux 产物修复） |
| Desktop CI run | [29385279029](https://github.com/bzm2008/papyrus/actions/runs/29385279029) |
| Package smoke run | [29385738173](https://github.com/bzm2008/papyrus/actions/runs/29385738173)；旧 Linux artifact `8331412342` 因 `Papyrus.png`/`papyrus.png` 冲突无法在 Windows 解压 |
| 报告更新时间 | `2026-07-15（本地 plan-completion 收口）` |
| 发布负责人 | `待填写` |
| 总体状态 | `pending` |

## CI 与包产物

| 平台 | CI 状态 | 包 smoke 状态 | 产物/日志 |
| --- | --- | --- | --- |
| Windows 11 / NSIS | pass | pending | Desktop CI run 29385279029；package artifact `8331424527` 已生成但未完成下载/安装验证 |
| macOS 当前 / app + DMG | pass | pending | Desktop CI run 29385279029；package artifact `8331384687` 已生成但无本机设备安装记录 |
| macOS 上一主版本 / app + DMG | pending | pending |  |
| Ubuntu 24.04 GNOME / DEB + AppImage | pass | pending | Desktop CI run 29385279029；旧 package artifact `8331412342` 大小写冲突，修复待远端重跑 |
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
| `REL-CERT-PENDING` | smoke 包下载/安装和真实设备矩阵尚未完成；macOS 上一主版本及额外 Linux 未覆盖 | all | Desktop CI 29385279029 三平台通过；package run 29385738173 旧 Linux artifact 冲突；设备记录待补 | open |
| `REL-PACKAGE-LINUX` | Linux artifact 需要带大小写排除规则重新 dispatch 并在 Windows 解压验证 | Linux | 本地 workflow/release-check 修复与 12 项脚本测试通过；远端仍待授权 push/重跑 | open |
| `REL-GITHUB-SCOPE` | 当前 GitHub token 缺少 `workflow` scope，无法由本机更新 workflow 后 dispatch | all | `gh auth status` 仅 `gist`, `read:org`, `repo`；设备授权码流程未确认 | blocked |

路径逃逸、过期审批执行、受限页面动作、重复执行、崩溃或数据丢失必须保持为 blocker，不能以 warning 关闭。

## 签名边界

Windows 代码签名、macOS 签名与 notarization、Linux 仓库签名以及 Tauri updater 签名只允许在受保护凭据环境中生成。此报告的 CI smoke 包不包含生产签名，也不应通过关闭验证来伪装成最终发布包。

## 当前本地证据（2026-07-15）

以下证据对应当前工作树在 Windows 本机的最后一次完整回归，未使用真实用户文件执行写入：

- `npm run lint`：通过。
- `npm run test:wps`：2 个文件、17 项通过；包含流式 401/403 结构化错误、模型/额度部分成功、stale 保留和套餐权限文案回归。
- `npx tsc -p tsconfig.app.json --noEmit`：通过。
- `npm run test:unit`：36 个文件、179 项通过；包含 review-only 不生成补丁、run-scope 审批复用/取消清理、`/goal` 取消后不再自动推进、审批 UI 浏览器上下文和敏感复制脱敏。
- `npm run check:browser`：扩展语法/构建、前端桥接测试和 Rust Browser Bridge/Web Extract 定向测试通过；Rust Browser Bridge 定向为 33 项，包含注入式私网重定向 fixture。
- `npm run test:browser:e2e`：真实 Chromium 9 项通过，覆盖普通字段、默认 input、contenteditable、下载、表单提交、字段变更 stale、链接 query 变化 stale、凭据链接/可执行文件名阻断和受限页面。
- `npm run build`：生产构建通过；仅有既有动态导入和大 chunk 提示。
- `npm run test:desktop`：36 个 TypeScript 文件、179 项通过；portable MSVC Rust 门禁 129 项通过，包含 run-scope approval、取消清理和 legacy pairing fail-closed。直接 cargo debug 构建仍可能受本机 `link.exe` LNK1105/错误 1224 文件锁影响。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`：通过。
- `npm run tauri:check:portable`：Windows MSVC portable check 通过。
- `npm run browser:package`：生成 5 个运行时文件的 `Papyrus-Browser-Bridge_0.1.2.zip`。
- 本机 Windows unsigned NSIS smoke：两次隔离 target（含单线程 Cargo）均在 MSVC `link.exe` 关闭临时 DLL/build-script 文件时返回 `LNK1105` / Windows 错误 1224；未生成可验证安装包。GitHub Windows portable CI 对同一提交通过，package smoke 仍以远程 workflow artifact 为准。
- `npm run test:release-scripts`：12 项通过，新增 Linux AppDir 大小写冲突排除规则回归，覆盖缺失 workflow 语义步骤、checkout SHA/产物命名、脚本 gate、CSP、命令白名单和扩展权限失败场景。
- `npm run wps:build`：WPS 插件 TypeScript、Vite 生产构建和 legacy 入口准备通过。
- Browser Bridge security：覆盖私网重定向/注入 DNS、受限字段、隐藏控件、跨源 tab、wrong-tab、stale snapshot、伪造/重放审批、超大消息和 token 单次使用。
- Work Assistant doctor：Rust 注入式诊断 6 项、TypeScript doctor 2 项通过；无文件、进程或 trash 副作用。
- Browser Bridge workbench/settings：状态分层、当前标签页/来源、健康错误、配对 token 生命周期和受限页面展示回归通过。
- `npm run release:assistant-check`：release 阶段通过；检查三平台 workflow 的关键命令、手动 dispatch、artifact 上传/保留、checkout commit SHA、Linux 大小写冲突排除、签名边界和打包 overlay。
- Scallion 模型/额度契约：模型目录默认请求 `include_unavailable=1`，套餐外模型只读展示并禁用；余额以 `points_balance` 为准；模型目录按 token 去重并设置超时；不确定的 Scallion 网络结果不会自动切换 Tauri 重发。
- WPS 模型/额度同步：`/models` 与 `/quota` 独立更新；单通道失败时保留旧目录/积分并显示 `stale`，无旧值时显示 `error`；成功、402、5xx、超时和流中断后会触发额度刷新，取消和认证失效不重复刷新。
- WPS 套餐降级显示：当 `/quota` 临时失败但 `/models` 返回套餐信息时，插件仍显示套餐类别和到期时间；积分仍只在额度成功响应中使用 `points_balance`，不会用模型目录伪造余额。
- 跨目标静态检查：本机未安装 Linux/macOS Rust 标准库；对应验证由 Desktop CI 的 Ubuntu/macOS runner 完成。

`npm run ci:desktop`：在停止并发编辑后的稳定工作树上通过；该聚合脚本不包含 Rust、portable MSVC 和真实 Chromium E2E，这些项目已由上面的独立门禁覆盖。`npm run release:assistant-check:local` 与 `npm run release:assistant-check` 均通过。真实用户文件的完整写入/恢复 smoke 尚未执行，不能用临时测试目录替代现场记录。

以上证据包含 Windows 本地回归和远程三平台 CI。平台 smoke 包的修复后重跑、真实安装/升级、macOS 上一主版本以及真实设备矩阵仍标记为 `pending`；不把 unsigned smoke 包标记为生产发布。

## 远程仓库证据（2026-07-14）

- 远程 `main` 当前为 `ac1f625`；Desktop CI run [29385279029](https://github.com/bzm2008/papyrus/actions/runs/29385279029) 在 Windows、macOS ARM、Ubuntu 24.04 全部通过。
- Package smoke run [29385738173](https://github.com/bzm2008/papyrus/actions/runs/29385738173) 三 job 完成；Windows artifact `8331424527`、macOS artifact `8331384687` 已生成，Linux artifact `8331412342` 在 Windows 解压时暴露大小写冲突。修复已在本地工作树，尚未进入远端默认分支。
- 真实设备记录、生产签名/公证和 updater 产物仍未执行，不能关闭 `REL-CERT-PENDING`。
