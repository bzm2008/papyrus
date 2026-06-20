# Papyrus 0.1.2 测试报告

生成时间：2026-06-21

## 自动验证

### `npm run lint`

- 结果：通过
- 命令输出摘要：`eslint .`
- 退出码：0

### `npm run build`

- 结果：通过
- 命令输出摘要：`tsc -b && vite build`
- 退出码：0
- 备注：Vite 仍提示主 bundle 超过 500 kB。这是体积警告，不是构建失败。

## DeepSeek 冒烟测试

### 当前状态

- 结果：未执行
- 原因：当前 shell 环境没有配置 `DEEPSEEK_API_KEY`。
- 安全说明：测试脚本只读取环境变量，不会把 API key 写入报告、日志或仓库文件。

### 已准备的脚本

脚本路径：`scripts/deepseek-smoke-test.mjs`

覆盖场景：

- `writing`：中等思考强度下的中文散文生成能力。
- `denoise`：高思考强度下的中文降噪能力。
- `hive_structured`：`ultra_hive` 下的结构化秘书长/蜂巢规划能力。
- `low_effort`：低思考强度下的短摘要能力。

脚本会输出 JSON 报告，包含：

- 模型名
- baseUrl
- 场景结果
- 耗时
- 估算 prompt tokens
- 估算 output tokens
- 预览文本

### 复现命令

PowerShell：

```powershell
$env:DEEPSEEK_API_KEY = "<your key>"
$env:DEEPSEEK_MODEL = "deepseek-v4-flash"
node scripts/deepseek-smoke-test.mjs > artifacts/deepseek-smoke-0.1.2.json
```

## 手动验收建议

- 模型选择器在写作模式和秘书模式都能展开，弹层不会被底部区域裁剪。
- 内置模型显示为主站返回的 Scallion 模型，不再显示旧的 `qwen3.6` 文案。
- 思考强度四档 `low / medium / high / ultra+hive` 选中态都清晰可读。
- `ultra+hive` 运行时能看到计划 Agent、活跃 Agent、完成/失败/跳过数量和共享黑板事件。
- 长期记忆与短期运行状态分层：执行轨迹、todo、临时队列和文稿补丁不会作为长期记忆持久化。

## 结论

0.1.2 的代码级验证已通过；DeepSeek 外部 API 冒烟测试需要在提供 `DEEPSEEK_API_KEY` 的环境中执行。
