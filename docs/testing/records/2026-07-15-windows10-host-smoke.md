# Windows 10 宿主 unsigned smoke

## 设备信息

| 字段 | 值 |
| --- | --- |
| OS 与版本 | Windows 10 22H2 / build 19045（不在当前支持矩阵内） |
| 架构 | x64 |
| 桌面环境 | Windows desktop |
| Papyrus commit | `0eb3439484ab646105c7ad6602206eda9bcd1f42` package smoke artifact |
| 包类型与文件名 | unsigned NSIS / `Papyrus_0.1.2_x64-setup.exe` |
| 浏览器与版本 | 未执行浏览器现场矩阵 |
| 测试日期（时区） | 2026-07-15 Asia/Shanghai |
| 测试者 | Codex automation |
| 结果 | `blocked` |

## 已执行证据

- 安装器退出码：`0`。
- 安装器更新现有 `E:\Papyrus` 注册表安装，版本 `0.1.2`；未删除或回滚已有安装。
- `E:\Papyrus\papyrus.exe` 启动后保持响应约 8 秒，随后由 smoke 脚本结束进程。
- 安装器 SHA-256：`045F34ABE8B15C437E31093E44F5B1C4B1D8E2A0CB9610F66E4AE217322826AC`；安装后 exe SHA-256：`0622D2EC51EDDA058CD4D9E87DB4D490F29F584DDD5454E857B7005B484484CF`。
- 包来源：GitHub package smoke run [29398057472](https://github.com/bzm2008/papyrus/actions/runs/29398057472)，artifact `8336049339`。
- Windows 10 不满足方案要求的 Windows 11 当前稳定版，因此本记录不能关闭 Windows 11 设备认证。

## 未执行项

原生审批、真实用户文件回收/恢复、Browser Bridge 现场配对、受限页面、取消/stale UI 和多尺寸布局均未在该宿主记录为 pass。它们仍由自动化测试和待补的支持设备记录覆盖。

## 发布判定

本记录仅证明当前 Windows 10 宿主的 unsigned 安装/启动 smoke，结果保持 `blocked`；不能替代 Windows 11、macOS 当前/上一主版本或额外 Linux 桌面认证。
