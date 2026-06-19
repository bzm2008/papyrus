# Papyrus WPS 文字插件

Papyrus WPS 文字插件是一个面向 WPS 文字的右侧任务窗格版本。它把桌面端的 Flow 与伴写能力合并为一个“文学秘书侧栏”，让用户可以在文档里直接提问、润色选区、扩写缩写、审阅全文、生成提纲，并在确认后把 AI 结果写回文档。

第一版优先支持 WPS 文字，不依赖 Tauri 桌面端常驻，默认通过 Scallion 云端代理访问 Papyrus 模型能力。

## 功能范围

- 读取当前选区、光标状态和文档摘要，作为 Agent 上下文。
- 一个输入框同时支持问答、改写、续写、审阅和生成正文。
- 内置常用动作：解释、润色、扩写、缩写、改成议论文、改成说明文、提纲、审阅、续写。
- 支持 `@skill` 快捷技能选择，例如文学起草、结构诊断、终校、文科论证、场景镜头等。
- 生成结果先进入“待应用”卡片，用户可选择替换选区、插入光标、追加文末或复制。
- 插件独立登录 Scallion，token 只保存在插件本地 `localStorage`。
- 浏览器开发模式提供 mock 文档桥，便于不打开 WPS 时预览侧栏 UI。

## 目录结构

```text
apps/wps-word-addin/
  public/
    main.js
    ribbon.xml
    papyrus-icon.svg
  src/
    App.tsx
    services/
      wpsDocumentBridge.ts
      wpsScallionSession.ts
      wpsUnifiedAgent.ts
  taskpane.html
  vite.config.ts
```

构建产物输出到：

```text
dist-wps-addin/
```

其中 `main.js` 和 `ribbon.xml` 供 WPS 加载项读取，`taskpane.html` 和 `assets/` 是侧边栏 Web 应用。

为兼容部分 WPS 版本，构建产物会同时保留：

```text
main.js
js/main.js
```

两者内容一致。部分 WPS 本地 JS 加载项示例默认寻找 `js/main.js`。

## 开发

```bash
npm run wps:dev
```

默认地址：

```text
http://127.0.0.1:1430/
```

浏览器中运行时会显示“浏览器预览”状态，并使用 mock 文档内容。真正的读取选区、替换选区和插入正文必须在 WPS 加载项环境中执行。

## 构建

```bash
npm run wps:build
```

建议在提交或发布前同时运行：

```bash
npm run lint
npm run build
```

构建后可将插件同步到当前 Windows 用户的 WPS 加载项目录：

```bash
npm run wps:install
```

该命令会复制 `dist-wps-addin/` 到：

```text
C:\Users\<User>\AppData\Roaming\kingsoft\wps\jsaddons\PapyrusWpsAddin_\
```

并创建或更新同级 `publish.xml`。如果 WPS 已打开，需要重启 WPS 文字后重新加载插件。

如果按钮显示但侧栏未打开，可查看插件回调调试记录：

```bash
npm run wps:debug
```

## WPS 本地加载

本地调试时，可把构建产物同步到 WPS JS 加载项目录，例如：

```text
C:\Users\<User>\AppData\Roaming\kingsoft\wps\jsaddons\PapyrusWpsAddin_\
```

并在同级创建 `publish.xml`：

```xml
<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<jsplugins>
  <jsplugin enable="enable_dev" url="file://" name="PapyrusWpsAddin" type="wps"/>
</jsplugins>
```

在当前测试机上，WPS 可以识别 `PapyrusWpsAddin_` 目录并在功能区展示 `Open Sidebar` 按钮。不同 WPS 版本对 `ribbon.xml` 回调、任务窗格 API 和本地路径解析存在差异，如果按钮显示但没有打开侧栏，需要继续适配该版本的 ribbon 回调入口。

## 当前手测记录

- 已确认 WPS 能识别本地加载项，并弹出首次加载和加载项修改确认框。
- 已确认功能区能注入 `Open Sidebar` 按钮。
- 已修正构建结构：不再把 Vite 的 `index.html` 作为加载入口，避免覆盖 WPS 自动加载机制。
- 已把 `main.js` 保持为 ES5 安全写法，降低旧 WebView/IE 内核语法失败风险。
- 已将 `ribbon.xml` 统一改为 `OnAction` 分发，并在 `main.js` 中增加多全局对象注册、任务窗格 API 大小写兼容和本地调试日志。
- 当前测试机上的 WPS 版本需要重启后继续手测按钮回调。如果仍无法打开侧栏，可先检查浏览器本地存储中的 `papyrus.wps.addin.debug` 日志。

## 安全规则

- Scallion token 只保存在插件本地 `localStorage`。
- 不把 token、上游 API key 或用户文档内容写入 Git。
- 插件前端不保存真实上游模型密钥，模型密钥只应存在于 Scallion 服务端环境变量。
- AI 结果默认只进入待应用卡片，不自动覆盖用户文档。

## 已知限制

- 第一版只承诺 WPS 文字，不承诺 Microsoft Word Office.js 兼容。
- 第一版不迁移桌面端完整项目库、长篇连载控制台、TXT/Word 导出和 Remote Relay。
- WPS 不同版本的任务窗格 API 名称可能存在差异。
- 如果无法读取选区，插件会退回无选区状态，仍可进行问答、生成提纲和插入正文。
