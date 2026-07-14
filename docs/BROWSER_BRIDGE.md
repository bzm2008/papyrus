# Papyrus Browser Bridge

Papyrus Browser Bridge 是一个跨 Windows、macOS、Linux 的 Chromium MV3 扩展与桌面端回环协议。它让秘书模式协作当前用户明确授权的标签页，同时把网页读取和动作限制在可审计、可撤销的边界内。

## 配对

桌面端在“电脑助手 → Browser Bridge”中生成一次性 `wsUrl`、`token`、`nonce`。扩展弹窗只接受用户粘贴这些值，并通过 `chrome.tabs.query({active: true})` 取得当前标签页的 `tabId` 与 `origin`。桌面端只监听 `127.0.0.1` 的临时端口，配对绑定扩展 ID、标签页 ID、origin、会话 nonce 和过期时间；退出、断开、标签关闭或超时都会失效。

消息使用 JSON WebSocket 帧：

```json
{"type":"pair","payload":{"token":"…","nonce":"…","extensionId":"…","tabId":12,"origin":"https://example.com"}}
{"type":"request","requestId":"…","action":"snapshot","payload":{}}
{"type":"response","requestId":"…","tabId":12,"payload":{"ok":true,"summary":"已完成"},"snapshot":{"tabId":12,"url":"https://example.com","origin":"https://example.com","title":"Example","text":"…","elements":[],"pageRevision":"…"}}
```

动作名称只有 `navigate`、`snapshot`、`fillDraft`、`click`、`download`、`submit`。响应必须带当前 `tabId`；如果附带快照，桌面端会先校验来源、标签页和页面版本，再唤醒等待中的请求。每个动作都携带 `pageRevision` 和稳定 `elementToken`；页面变化时返回 `stale_page`，客户端不能猜测新元素。一次性配对 token 只用于建立当前 WebSocket，会话断开或重配后必须生成新的配对信息。

## 页面边界

- 只返回标题、公开 URL、可访问名称、角色、普通文本摘要、元素边界和字段是否已有值（`hasValue`）；不返回字段真实内容。
- 文本最多 12,000 字，元素最多 200 个。
- 不读取 Cookie、LocalStorage、SessionStorage、浏览历史、扩展数据或其他标签页。
- 密码、验证码、支付、账单、身份验证、账号安全和扩展/权限管理页面会从快照字段中移除，并直接阻断写入、点击、下载和提交。

## 动作安全

- `browser_fill_draft` 只能填写普通文本字段，并明确返回“尚未提交”。
- `browser_click` 仅接受普通语义元素；删除、发送、发布、授权、安装、外部跳转等语义会升级/阻断。
- `browser_download` 只允许普通下载，不自动打开文件；可执行扩展名（`exe`、`msi`、`dmg`、`pkg`、`app`、`deb`、`rpm`、`sh`、`bat`、`cmd`）直接阻断。
- `browser_submit` 每次都需要 Papyrus 的一次性高风险审批。

## 安全网页提取与归档

`web_extract` 仅接受 `http(s)`，拒绝凭据 URL、localhost、回环、链路本地、私网、云元数据和解析到这些地址的主机；重定向会逐跳重复执行同一检查，并把该跳 DNS 地址固定到请求。响应大小和正文长度都有上限，结果包含 canonical URL、语言和摘要。`web_archive` 只能在秘书工具审批通过后写入当前 Papyrus 项目的 HTML `ImportedResource`，按 canonical URL 去重更新，不自动写入长期记忆；旧版直接归档命令已移除，不能绕过项目审批。

## 开发与测试

扩展没有运行时依赖。运行 `npm run browser:build` 后，在 Chrome、Edge 或 Brave 打开扩展管理页，开启“开发者模式”，选择“加载已解压的扩展程序”，指向 `dist-browser-bridge`；升级后重新加载扩展并重新配对。Linux Chromium 的扩展管理入口和桌面文件管理器名称可能不同，无法打开文件管理器时只降级为打开父目录，不绕过路径审批。

故障排查：确认 Papyrus 与浏览器在同一用户会话、扩展弹窗选择的是当前标签页、配对信息未过期且 WebSocket 仍为 `ws://127.0.0.1/.../bridge`；导航、切换标签页、扩展重载或桌面端重启后都应重新生成配对信息。若看到 `stale_page`，先刷新快照；若看到 `page_restricted`，不要尝试绕过密码、OTP、支付或账号安全页面限制。

桌面端测试覆盖 SSRF、敏感页面、快照限制、token、origin、tab、page revision 和动作阻断；前端测试覆盖工具注册、审批风险、归档去重和 Browser Bridge UI。发布前需要在 Windows、macOS、Linux 真实 Chromium 上回归配对、导航、快照、填写、点击、下载、提交审批和断开。
