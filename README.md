# Papyrus 莎草纸

Papyrus 是 Scallion 生态里的桌面端 AI 写作工作站，使用 Tauri 2 + React 19 + Vite + TypeScript 构建。

核心工作流：

- 伴写模式：以文稿选区为中心，支持原位改写、审查、纠错、查重、降噪和待审补丁。
- Flow 模式：主笔 Agent 自主规划任务，按需调用寻根、刺客、编剧、文风师、校雠、档案员等子 Agent。
- 项目上下文：当前聊天、文章、导入文件、STYLE/WORLD 规范与负向记忆共同参与上下文组装。
- 主站登录：通过 Scallion 设备码授权登录，用于内置云模型、会员状态和后续同步。

## 开发

```bash
npm install
npm run dev
npm run build
npm run lint
npm run tauri:dev
```

## Tauri / Rust 检查

```bash
npm run tauri:check:portable
```

如果本机缺少 Visual Studio Build Tools，可使用项目内便携 MSVC 脚本构建 Rust release：

```powershell
powershell -ExecutionPolicy Bypass -File scripts/with-portable-msvc.ps1 build --release
```

## 登录与模型

- 主站授权 API：`https://scallion.uno/api/papyrus/auth`
- 内置模型代理：`https://scallion.uno/api/papyrus/llm`
- 默认模型显示名：`qwen3.6`
- 默认上下文窗口：128K

客户端不保存真实上游 API Key。内置模型的真实 Key 只应存在于服务器环境变量中。

## 发布

当前主站下载包为 Windows 便携版：

```text
https://scallion.uno/downloads/papyrus/Papyrus-0.1.0-portable-win-x64.zip
```

完整安装包和 OTA 更新包需要配置 Tauri updater 私钥：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PATH`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

私钥文件不得提交到 Git。
