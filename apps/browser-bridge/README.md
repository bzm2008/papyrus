# Papyrus Browser Bridge

这是跨 Windows、macOS、Linux 共用的 Chromium MV3 扩展。扩展只会在用户点击“连接当前标签页”后，向 Papyrus 的 `127.0.0.1` 回环 WebSocket 发送受限的可访问性摘要。

## 本地加载

1. 打开 Chromium 的扩展管理页并开启开发者模式。
2. 选择“加载已解压的扩展”，指向本目录。
3. 在 Papyrus 电脑助手设置中生成一次性 WebSocket、Token、Nonce。
4. 在扩展弹窗粘贴配对信息，然后主动连接当前标签页。

扩展不会读取 Cookie、LocalStorage、SessionStorage、浏览历史或其他标签页。密码、验证码、支付、账号安全、扩展权限管理页面会被硬阻断。所有动作都绑定页面 revision；页面变化后必须重新快照。
