# Work Assistant 跨平台认证矩阵

这份矩阵是 Papyrus Work Assistant、Browser Bridge 和桌面打包的发布门禁。每一项必填案例都要在真实设备或对应 CI 运行中记录证据；“未执行”不能记作通过。

## 支持环境

| 平台 | 必测环境 | 浏览器 | 包类型 |
| --- | --- | --- | --- |
| Windows | Windows 11 当前稳定版，x64 | Edge 或 Chrome 当前稳定版 | NSIS |
| macOS | 当前主版本及上一主版本，Apple Silicon 或 Intel | Chrome 当前稳定版 | `.app`、DMG |
| Linux | Ubuntu 24.04 GNOME；另一个常见 Linux 桌面（例如 Fedora KDE） | Chromium 或 Chrome 当前稳定版 | DEB、AppImage |

每份记录至少包含：OS 版本、架构、Papyrus commit、包类型、桌面环境、浏览器版本、测试日期、测试者、结果、日志/截图路径。

## 原生电脑助手案例

1. 授权目录添加、查看和移除；拒绝未授权路径。
2. 嵌套授权目录、重复目录和符号链接逃逸均被拒绝。
3. 扫描上限、搜索结果上限和取消均可控，界面不冻结。
4. 文件预览显示目标、风险、影响和有效期，过期预览不能执行。
5. 复制、同卷移动、跨卷移动、重命名和新建目录均要求正确批准。
6. 冲突策略 skip、rename、overwrite 的结果与审计一致。
7. 回收站/恢复和取消不会造成数据丢失；部分失败会显示恢复凭据。
8. 可执行文件、脚本、安装包和快捷方式的打开/登记被阻止。
9. 用户登记的应用别名可启动；模型不能提交任意命令或参数。
10. URL 打开、文件打开、显示文件位置只接受受控目标。
11. 审计查看、分页、清空和应用重启后的持久性。
12. `work_assistant_doctor` 报告应用数据目录、审计路径、授权根、下载目录、应用注册路径、回环端口和 Browser Bridge 状态。

## Browser Bridge 案例

1. 配对、当前标签授权、token 过期、断开和浏览器重启恢复。
2. 标签切换、导航、来源变化和扩展移除立即使授权失效。
3. 公共页面提取成功；私有地址、内网重定向和受限页面在 DOM 操作前阻止。
4. 普通 input、textarea、contenteditable 填充触发 input/change 事件。
5. 普通按钮点击、下载元数据和操作后快照可回归。
6. 提交/发送/发布必须显示高风险预览并等待一次性批准；拒绝时保留草稿。
7. 密码、OTP、银行卡、支付、账号安全、管理控制台和隐藏凭据页面始终受限。
8. 快照 ID、元素指纹、来源和页面版本不匹配时返回 stale，不自动寻找相似元素。
9. 断开、超大消息、错误 token、token 重放和迟到事件均安全失败。

## UI 与流式案例

1. 首 token、两秒停顿提示、工具行顺序和审批等待状态清晰可见。
2. 取消含部分回复时不重复消息、不创建待应用补丁；迟到事件被丢弃。
3. 简单任务只创建单 Agent；复杂任务显示子 Agent 树和聚合结果。
4. 右侧工作区按任务自动打开；手动关闭后在同一次运行中保持关闭。
5. 1040x680、1360x860 和窄 WebView 宽度下无文字重叠、按钮出界或不可滚动区域。

## 结果规则

- 每个必测案例必须填写 `pass`、`fail` 或 `blocked`，并附证据。
- Linux 文件管理器只能打开父目录时可记录 warning，不阻断发布。
- 任一路径逃逸、过期审批执行、受限页面动作、重复执行、崩溃或数据丢失都是 release blocker。
- smoke 包未签名只用于安装/启动验证；生产签名、 notarization、Linux 仓库签名和 updater 签名必须在受保护凭据工作流中完成。

## 记录索引

使用 [WORK_ASSISTANT_TEST_RECORD_TEMPLATE.md](./WORK_ASSISTANT_TEST_RECORD_TEMPLATE.md) 为每台真实设备建立记录，并在 [PAPYRUS_WORK_ASSISTANT_TEST_REPORT.md](../PAPYRUS_WORK_ASSISTANT_TEST_REPORT.md) 汇总。
