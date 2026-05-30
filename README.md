# Papyrus 莎草纸

Papyrus 是 Scallion 生态里的桌面端 AI 写作工作站，使用 Tauri 2 + React 19 + Vite + TypeScript 构建。

核心工作流：

- 伴写模式：以文稿选区为中心，支持原位改写、审查、纠错、查重、降噪和待审补丁。
- Flow 模式：主笔 Agent 自主规划任务，按需调用寻根、刺客、编剧、文风师、校雠、档案员等子 Agent。
- Story System：长篇任务固定走“作品合同 → 写作任务书 → 初稿 → 多维审查 → 二稿 → 文稿补丁 → 章节提交 → 记忆投影”。
- 项目上下文：当前聊天、文章、导入文件、STYLE/WORLD 规范与负向记忆共同参与上下文组装。
- 主站登录：通过 Scallion 设备码授权登录，用于内置云模型、会员状态和后续同步。

## 题材包

内置题材包覆盖修仙、玄幻、高武、都市异能、都市日常、历史、历史脑洞、古言、宫斗宅斗、现言、狗血言情、悬疑、规则怪谈、科幻、末世、无限流、现实题材、职场婚恋等方向。

学生写作包面向辅助写作、素材组织和作文升格，不承诺考试押题：

- 中学记叙文、说明文、议论文
- 大学记叙/散文、说明/科普、议论文/评论
- `/` 指令：`/中学作文`、`/大学写作`、`/记叙文素材`、`/说明文素材`、`/议论文论据`、`/作文升格`

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
https://scallion.uno/downloads/papyrus/Papyrus-0.1.1-portable-win-x64.zip
```

完整安装包和 OTA 更新包需要配置 Tauri updater 私钥：

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PATH`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

私钥文件不得提交到 Git。

OTA 更新端点：

```text
https://scallion.uno/api/papyrus/update
```

安装器 artifact：

```text
https://scallion.uno/downloads/papyrus/Papyrus_0.1.1_x64-setup.exe
```
