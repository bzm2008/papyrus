# Papyrus

Papyrus 是 Scallion 生态里的桌面端文学与文科写作 Agent 工作台。它不是只面向网文连载的写作助手，而是把小说、作文、说明文、议论文、评论、散文、资料搜集、文学常识问答和文稿审校放进同一个可编辑工作流里。

## 核心能力

- 文学秘书模式：在编辑器旁随时提问、改选区、解释文学常识、批改作文、整理素材、搜索资料和诊断结构。
- Flow 模式：由主笔 Agent 规划任务，按需调度检索、结构、文风、审校、档案等子 Agent。
- `@skill`：显式指定文学起草、结构诊断、检索反证、文风连续、终校、档案记忆、文科论证、人物声纹、场景镜头、发表前编辑等技能。
- `#file`：引用已导入的 Word、Markdown、TXT 或项目文件，让 Agent 明确读取并引用上下文。
- 文体工作流：支持小说章节、记叙文、说明文、议论文、评论、散文、文学常识和资料搜集。
- Story System：面向长篇与连载任务，维护作品合同、章节任务书、伏笔、读者承诺、角色状态和提交记忆。
- 导出：支持 Word 与 UTF-8 TXT 导出，保持中文不乱码。
- 用量浮球：显示上下文占用、文稿 tokens、对话 tokens、资料数、当前模型和运行状态。

## 技术栈

- Tauri 2
- React 19
- Vite
- TypeScript
- Tiptap
- Zustand
- Tailwind CSS v4

## 开发

```bash
npm install
npm run dev
npm run build
npm run lint
npm run tauri:dev
```

Tauri / Rust 便携检查：

```bash
npm run tauri:check:portable
```

## 模型与授权

Papyrus 保留 Scallion 主站授权和内置模型代理。客户端不保存真实上游 API Key，内置云模型的真实 Key 只能存在于服务器环境变量中。

- 主站授权 API: `https://scallion.uno/api/papyrus/auth`
- 内置模型代理: `https://scallion.uno/api/papyrus/llm`
- 默认模型显示名: `qwen3.6`
- 自定义模型: 支持 OpenAI-compatible Base URL、模型名和 Key

## 文档

- [功能说明](docs/FEATURES.md)
- [Remote Relay 远程通讯](docs/REMOTE_RELAY.md)
- [WPS 文字插件](docs/WPS_ADDIN.md)
- [设计语言](docs/DESIGN.md)
- [路线图](docs/ROADMAP.md)

## 发布注意

Tauri updater 需要签名私钥，私钥不得提交到 Git。

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PATH
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```
