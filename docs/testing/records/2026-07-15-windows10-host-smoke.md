# Windows 10 宿主 unsigned smoke

## 设备信息

| 字段 | 值 |
| --- | --- |
| OS 与版本 | Windows 10 22H2 / build 19045（不在当前支持矩阵内） |
| 架构 | x64 |
| 桌面环境 | Windows desktop |
| Papyrus commit | `e0ef0e71124c5a6d64916006020e13a567b28c14` package smoke artifact |
| 包类型与文件名 | unsigned NSIS / `Papyrus_0.1.2_x64-setup.exe` |
| 浏览器与版本 | 未执行浏览器现场矩阵 |
| 测试日期（时区） | 2026-07-15 Asia/Shanghai |
| 测试者 | Codex automation |
| 结果 | `blocked` |

## 已执行证据

- 安装器退出码：`0`。
- 本次使用隔离安装目录 `artifacts/device-smoke/windows10/Papyrus`，未触碰现有 `E:\Papyrus` 安装；安装版本 `0.1.2`。
- 隔离安装后的 `papyrus.exe` 启动后保持响应约 8 秒，窗口标题为 `Papyrus`，随后由 smoke 脚本结束进程；结束后无残留 `papyrus` 进程。
- 安装器 SHA-256：`20C3EBBE7F707ECBD544CB582C890C726506A67E055530869A1780CFD8E7742B`；隔离安装后 exe SHA-256：`79A1B36F8E438BF9DF7B830B26B4EDCB3748A28FA66B47429377E0FB0CB4BC31`。
- 包来源：GitHub package smoke run [29414240914](https://github.com/bzm2008/papyrus/actions/runs/29414240914)，artifact `8342536560`。
- Windows 10 不满足方案要求的 Windows 11 当前稳定版，因此本记录不能关闭 Windows 11 设备认证。

## 未执行项

原生审批、真实用户文件回收/恢复、Browser Bridge 现场配对、受限页面、取消/stale UI 和多尺寸布局均未在该宿主记录为 pass。它们仍由自动化测试和待补的支持设备记录覆盖。

## 发布判定

本记录仅证明当前 Windows 10 宿主的 unsigned 安装/启动 smoke，结果保持 `blocked`；不能替代 Windows 11、macOS 当前/上一主版本或额外 Linux 桌面认证。
