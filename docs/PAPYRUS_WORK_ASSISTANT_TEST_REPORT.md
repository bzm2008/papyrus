# Papyrus Work Assistant 发布测试报告

> 这是跨平台认证报告骨架。只有所有 CI、打包和真实设备记录完成后，才能把状态改为 `pass`。

## 发布元数据

| 字段 | 值 |
| --- | --- |
| Papyrus commit | `eea8dbf4fa0856d48aaf9ff0fd825d4d545950ea`（套餐/积分实时同步、全量模型权限展示、取消竞态、Browser Bridge 生命周期与跨平台 smoke 加固） |
| Desktop CI run | [29408046525](https://github.com/bzm2008/papyrus/actions/runs/29408046525) |
| Package smoke run | [29408076266](https://github.com/bzm2008/papyrus/actions/runs/29408076266)；Windows `8340022939`、macOS `8339989744`、Linux `8340015191` 均完成 |
| 报告更新时间 | `2026-07-15（远端三平台 CI/package smoke 通过后）` |
| 发布负责人 | `待填写` |
| 总体状态 | `pending` |

## CI 与包产物

| 平台 | CI 状态 | 包 smoke 状态 | 产物/日志 |
| --- | --- | --- | --- |
| Windows 11 / NSIS | pass | pass | Desktop CI 29408046525；artifact `8340022939` 含 `Papyrus_0.1.2_x64-setup.exe` 和 Browser Bridge ZIP；未完成真实安装验证 |
| macOS 当前 / app + DMG | pass | pass | Desktop CI 29408046525；artifact `8339989744` 含 ARM64 DMG/app 和 Browser Bridge ZIP；未完成真实设备安装验证 |
| macOS 上一主版本 / app + DMG | pending | pending |  |
| Ubuntu 24.04 GNOME / DEB + AppImage | pass | pass | Desktop CI 29408046525；artifact `8340015191` 含 DEB/AppImage 和 Browser Bridge ZIP；bundle smoke 日志 artifact `8340009947` |
| 额外 Linux 桌面 / DEB + AppImage | pending | pending |  |

Browser Bridge ZIP 必须出现在每个平台 smoke 产物中，文件名应包含版本号；smoke 产物不能被标记为已签名生产包。

## 真实设备记录

| 记录文件 | 平台 | 浏览器 | 结果 | blocker |
| --- | --- | --- | --- | --- |
| [`records/2026-07-15-windows10-host-smoke.md`](./testing/records/2026-07-15-windows10-host-smoke.md) | Windows 10 宿主（非支持矩阵） | 未执行现场浏览器矩阵 | blocked | 可补充安装/启动 smoke，但不能替代 Windows 11 |
| `待添加` | Windows 11 | Edge/Chrome | pending |  |
| `待添加` | macOS 当前 | Chrome | pending |  |
| `待添加` | macOS 上一主版本 | Chrome | pending |  |
| `待添加` | Ubuntu 24.04 GNOME | Chromium/Chrome | pending |  |
| `待添加` | 额外 Linux 桌面 | Chromium/Chrome | pending |  |

每条记录使用 [设备测试记录模板](./testing/WORK_ASSISTANT_TEST_RECORD_TEMPLATE.md)，并覆盖 [跨平台矩阵](./testing/WORK_ASSISTANT_PLATFORM_MATRIX.md) 中的全部案例。

## Blocker 清单

| ID | 描述 | 平台 | 修复/回归证据 | 状态 |
| --- | --- | --- | --- | --- |
| `REL-CERT-PENDING` | smoke 包真实安装/升级和真实设备矩阵尚未完成；macOS 上一主版本及额外 Linux 未覆盖 | all | Windows 10 补充记录为 blocked；Desktop CI 29408046525、package smoke 29408076266 三平台通过；支持设备记录待补 | open |
| `REL-PACKAGE-LINUX` | Linux artifact 大小写冲突 | Linux | package smoke 29408076266 / artifact `8340015191`；bundle smoke artifact `8340009947`；Linux 包 job 通过 | resolved |
| `REL-GITHUB-SCOPE` | GitHub workflow dispatch 权限 | all | `gh auth status` 已确认含 `workflow`；分支推送与 package smoke dispatch 成功 | resolved |

路径逃逸、过期审批执行、受限页面动作、重复执行、崩溃或数据丢失必须保持为 blocker，不能以 warning 关闭。

## 签名边界

Windows 代码签名、macOS 签名与 notarization、Linux 仓库签名以及 Tauri updater 签名只允许在受保护凭据环境中生成。此报告的 CI smoke 包不包含生产签名，也不应通过关闭验证来伪装成最终发布包。

## 当前本地证据（2026-07-15）

以下证据对应当前工作树在 Windows 本机的最后一次完整回归，未使用真实用户文件执行写入：

- `npm run lint`：通过。
- `npm run test:wps`：2 个文件、17 项通过；包含流式 401/403 结构化错误、模型/额度部分成功、stale 保留和套餐权限文案回归。
- `npx tsc -p tsconfig.app.json --noEmit`：通过。
- `npm run test:unit`：37 个文件、205 项通过；包含 review-only 不生成补丁、套餐/积分实时同步、完整模型目录权限标记、canonical run-scope 审批字段/数量边界、取消后不再启动 native preview、浏览器 pre-abort、审批竞态、取消清理失败提示和浏览器动作 `request_uncertain`。
- `npm run test:browser`：扩展语法/构建、前端桥接测试和 Browser Bridge Vitest 通过；扩展 service worker 集成 14 项，Browser Bridge 原生定向测试为 39 项，包含导航代际 stale 响应、FIFO 取消淘汰、表单 action/提交按钮 `formaction` 指纹与公共 URL/DNS 复检。
- `npm run test:browser:e2e`：真实 Chromium 11 项通过，覆盖普通字段、默认 input、contenteditable、下载、表单提交、form action 与 submitter `formaction` 私网变更阻断、字段变更 stale、链接 query 变化 stale、凭据链接/可执行文件名阻断和受限页面。
- `npm run build`：生产构建通过；仅有既有动态导入和大 chunk 提示。
- `npm run ci:desktop`：37 个 TypeScript 文件、205 项通过；portable MSVC Rust 全量门禁 138 项通过，包含 canonical run-scope approval、浏览器取消/待响应唤醒、取消清理、导航 origin 重绑定、导航迟到响应、表单目标校验、FIFO 取消标记和 legacy pairing fail-closed。直接 cargo debug 构建仍可能受本机 `link.exe` LNK1105/错误 1224 文件锁影响。
- `cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check`：通过。
- `npm run tauri:check:portable`：Windows MSVC portable check 通过。
- `npm run browser:package`：生成 5 个运行时文件的 `Papyrus-Browser-Bridge_0.1.2.zip`。
- 本机 Windows unsigned NSIS smoke：两次隔离 target（含单线程 Cargo）均在 MSVC `link.exe` 关闭临时 DLL/build-script 文件时返回 `LNK1105` / Windows 错误 1224；未生成可验证安装包。GitHub Windows portable CI 对同一提交通过，package smoke 仍以远程 workflow artifact 为准。
- `npm run test:release-scripts`：13 项通过，覆盖 Linux AppDir 大小写冲突排除、Browser Bridge manifest/package 版本一致性、缺失 workflow 语义步骤、checkout SHA/产物命名、脚本 gate、CSP、命令白名单和扩展权限失败场景。
- `npm run wps:build`：WPS 插件 TypeScript、Vite 生产构建和 legacy 入口准备通过。
- Browser Bridge security：覆盖私网重定向/注入 DNS、受限字段、隐藏控件、跨源 tab、wrong-tab、stale snapshot、伪造/重放审批、超大消息和 token 单次使用。
- Browser Bridge cancellation：原生取消命令按 run 清理预览/审批，disconnect 不清除已取消 run 标记；已取消 run 使用 FIFO 有界淘汰；已批准动作的发送闸门与取消串行，pending 响应可被唤醒，snapshot 请求携带 run id，前端 AbortSignal 在调用前 fail-closed；动作已发送后与取消竞态返回 `request_uncertain`，避免重复提交。
- Approval scope：文件 run grant 绑定 tool/root/target-parent digest/conflict policy/operation kind/max item count；危险操作不允许 run-scoped 复用，TS 与 Rust 比较规则一致。
- Work Assistant doctor：Rust 注入式诊断 6 项、TypeScript doctor 2 项通过；无文件、进程或 trash 副作用。
- Browser Bridge workbench/settings：状态分层、当前标签页/来源、健康错误、配对 token 生命周期和受限页面展示回归通过。
- `npm run release:assistant-check`：release 阶段通过；检查三平台 workflow 的关键命令、手动 dispatch、artifact 上传/保留、checkout commit SHA、Linux 大小写冲突排除、签名边界和打包 overlay。
- Scallion 模型/额度契约：模型目录默认请求 `include_unavailable=1`，套餐外模型只读展示并禁用；余额以 `points_balance` 为准；模型目录按 token 去重并设置超时；不确定的 Scallion 网络结果不会自动切换 Tauri 重发。
- WPS 模型/额度同步：`/models` 与 `/quota` 独立更新；单通道失败时保留旧目录/积分并显示 `stale`，无旧值时显示 `error`；成功、402、5xx、超时和流中断后会触发额度刷新，取消和认证失效不重复刷新。
- WPS 套餐降级显示：当 `/quota` 临时失败但 `/models` 返回套餐信息时，插件仍显示套餐类别和到期时间；积分仍只在额度成功响应中使用 `points_balance`，不会用模型目录伪造余额。
- Papyrus 套餐/积分 UI：工作台每 15 秒刷新 quota、每 60 秒刷新完整目录；模型选择器、设置、维护控制台和状态栏显示当前套餐、points_balance 和同步状态。没有成功 quota 时显示登录缓存并明确标注，不冒充实时余额；套餐外模型保留在目录中并禁用，显示所需套餐/主站原因。
- 跨目标静态检查：本机未安装 Linux/macOS Rust 标准库；对应验证由 Desktop CI 的 Ubuntu/macOS runner 完成。

`npm run ci:desktop`：在停止并发编辑后的稳定工作树上通过；该聚合脚本不包含 Rust、portable MSVC 和真实 Chromium E2E，这些项目已由上面的独立门禁覆盖。`npm run release:assistant-check:local` 与 `npm run release:assistant-check` 均通过。真实用户文件的完整写入/恢复 smoke 尚未执行，不能用临时测试目录替代现场记录。

以上证据包含 Windows 本地回归和远程三平台 CI。真实安装/升级、macOS 上一主版本以及真实设备矩阵仍标记为 `pending`；不把 unsigned smoke 包标记为生产发布。

## 远程仓库证据（2026-07-15）

- 远程 `main` 当前为 `ac1f625`；Desktop CI run [29385279029](https://github.com/bzm2008/papyrus/actions/runs/29385279029) 在 Windows、macOS ARM、Ubuntu 24.04 全部通过。
- Desktop CI run [29398029671](https://github.com/bzm2008/papyrus/actions/runs/29398029671) 在 Windows、macOS ARM、Ubuntu 24.04 全部通过，头部 SHA 为 `0eb3439484ab646105c7ad6602206eda9bcd1f42`。
- Desktop CI run [29399654442](https://github.com/bzm2008/papyrus/actions/runs/29399654442) 在 Windows、macOS ARM、Ubuntu 24.04 全部通过，头部 SHA 为 `556a40d8d1254dd1b1a8454fb0db62bd6f24dd3e`。
- Package smoke run [29398057472](https://github.com/bzm2008/papyrus/actions/runs/29398057472) 三 job 全部通过；Windows artifact `8336049339`、macOS artifact `8336011570` 已下载并核对，Linux artifact `8336041656` 通过 ZIP 中央目录核对，包含 DEB/AppImage/Browser Bridge ZIP 且大小写重复为 0。
- Desktop CI run [29408046525](https://github.com/bzm2008/papyrus/actions/runs/29408046525) 在同一远端提交 `eea8dbf4fa0856d48aaf9ff0fd825d4d545950ea` 上的 Windows、macOS、Ubuntu 24.04 全部通过。
- Package smoke run [29408076266](https://github.com/bzm2008/papyrus/actions/runs/29408076266) 三 job 全部通过；Windows artifact `8340022939`、macOS artifact `8339989744`、Linux artifact `8340015191` 均上传，另有平台独立 bundle smoke 日志 artifacts `8340021879`、`8339987630`、`8340009947`。
- 真实设备记录、生产签名/公证和 updater 产物仍未执行，不能关闭 `REL-CERT-PENDING`。
