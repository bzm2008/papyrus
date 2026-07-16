# Papyrus 1.0.0 发布指南

Papyrus 1.0.0 是本地优先的文科秘书版本。Windows 10/11 与 Debian 13 是功能认证和发布硬门；macOS 保持构建、启动与核心兼容 smoke，不替代前两者的真实设备记录。

## 版本来源

根目录的 `package.json` 是唯一权威版本来源。不要手动分别修改 Tauri、Cargo、Browser Bridge 或锁文件中的版本。

```bash
npm run version:sync
npm run version:check
```

`version:sync` 会从 `package.json` 派生以下发布镜像，`version:check` 会在任一镜像漂移时失败：

- `package-lock.json`
- `src-tauri/Cargo.toml` 与 `src-tauri/Cargo.lock`
- `src-tauri/tauri.conf.json`
- `apps/browser-bridge/manifest.json`

Browser Bridge 构建产物和 WPS 安装包在构建时直接读取根版本，因此不维护第二个版本来源。使用 `npm version <next-version>` 时，项目的 `version` 生命周期会同步这些镜像；手动修改版本后必须先执行上述两条命令。

## 本地发布前检查

```bash
npm ci
npm run version:check
npm run lint
npm run test:release-scripts
npm run browser:build
npm run release:assistant-check
npm run build
```

完整 release gate 还会检查三平台 workflow、Debian 13 容器、Browser Bridge 权限、发布文档和未签名 smoke 包边界：

```bash
npm run release:assistant-check
```

## 产物与 OTA

Browser Bridge 和 WPS 的包名由根版本生成：

```bash
npm run browser:package
npm run wps:package
```

Tauri updater 端点仍为 `https://scallion.uno/api/papyrus/update`，本版本不修改 Scallion API 契约。生产 OTA 只能在受保护的签名环境生成：

1. 在受保护环境提供 `TAURI_SIGNING_PRIVATE_KEY` 或 `TAURI_SIGNING_PRIVATE_KEY_PATH`，以及必要的密码变量；私钥、签名和凭证不得进入仓库或日志。
2. 使用已通过 `version:check` 的 `1.0.0` 工作树构建签名安装器和 updater 产物。
3. 上传安装器、对应 `.sig` 与服务端更新清单；更新清单的 `version` 必须为 `1.0.0`，并且签名必须与下载文件一致。
4. 发布后执行 `npm run release:check`。该命令会读取本地权威版本，并拒绝版本不一致、缺失签名、无效 NSIS 下载地址或过小安装器。

本仓库只生成和校验客户端侧产物。生产签名、主站清单发布和真实 OTA 下载是外部受保护步骤；在这些步骤完成前，任何本地或 CI smoke 包都不是生产发布物。

## 设备门禁

- Windows 10 与 Windows 11：分别完成 NSIS 安装、启动、托盘隐藏/恢复、显式退出、秘书任务恢复、文件与浏览器审批的真实设备记录。
- Debian 13：完成 DEB 与 AppImage 安装、启动、托盘、SQLite 账本、恢复和受控工具审批的真实设备记录，详见 [Debian 13 验证清单](testing/DEBIAN_13_VALIDATION.md)。
- macOS：保留 CI 包构建、启动和核心兼容 smoke；未将其作为 Windows/Debian 同等级的功能认证阻塞项。

请把设备证据写入 `docs/testing/records/`，再在发布报告中汇总。历史 `0.1.2` 报告是历史证据，不以本指南回写或替代。
