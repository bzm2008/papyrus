# 公开仓库前安全说明

Papyrus 可以公开源码，但公开前必须把“客户端开源”和“内置模型额度安全”分开看。客户端源码不应包含真实上游模型密钥；内置模型能力只能通过 Scallion 服务端鉴权代理提供。

## 当前风险判断

### 已降低的风险

- 仓库内没有发现明文上游 API Key。
- `.env.example` 只应保留变量名和示例，不应包含真实密钥。
- Tauri 签名私钥放在 `src-tauri/keys/`，该目录只保留 README，真实私钥不得提交。
- 自定义模型 Key 由用户在本地设置中填写，不应写入文档、测试报告或 Git 历史。
- 客户端调用 Scallion 内置模型代理时必须携带 Scallion 登录 token。

### 仍需服务端保证的风险

公开客户端后，任何人都能看到 Scallion API 端点。因此服务端必须假设端点是公开的，并强制执行：

- 所有 `/api/papyrus/llm/chat` 请求必须校验 Bearer token。
- token 必须绑定用户、设备或会话。
- 每个用户必须有额度、频率限制和并发限制。
- 模型名必须在服务端白名单内，不能让客户端任意指定高成本上游模型。
- 服务端不得把上游 API Key 下发给客户端。
- 失败日志、审计日志中不得记录完整用户文稿、token 或上游密钥。
- WPS 插件、桌面端和远程 Relay 使用同一套鉴权原则。

## 公开前检查清单

运行：

```bash
npm run lint
npm run build
rg -n -i "api[_-]?key|secret|token|password|bearer|authorization|appid|app_id|private_key|TAURI_SIGNING" . -g "!node_modules" -g "!dist" -g "!_reference"
git status --short
```

人工确认：

- 没有真实 `.env`、私钥、服务端 token、机器人密钥、远程连接密钥。
- `src-tauri/keys/` 不包含真实签名私钥。
- `artifacts/`、测试报告和截图没有泄露真实用户内容或密钥。
- `_reference/` 参考仓库被 `.git/info/exclude` 或 `.gitignore` 排除。
- 内置模型代理在无 token 时返回 401/403。
- 服务端已启用额度扣减、限流、模型白名单和异常审计。

## 不应公开的内容

- Scallion 服务端源码中的上游模型密钥。
- Tauri updater 私钥。
- 用户本地持久化数据。
- 真实远程连接平台的 App Secret。
- 发布服务器 SSH、对象存储、CDN 或数据库凭据。

## 建议公开方式

如果服务端鉴权和限流已确认生效，可以公开客户端仓库。公开后仍建议：

- 默认保持内置模型需要登录。
- 鼓励开发者使用自有 OpenAI-compatible 模型配置。
- 在 README 中明确：开源客户端不包含免费内置模型额度，内置模型由 Scallion 账户额度控制。
- 定期用 secret scanner 或 GitHub secret scanning 检查新提交。
