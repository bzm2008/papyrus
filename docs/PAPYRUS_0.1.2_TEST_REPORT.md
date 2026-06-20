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

### `npm run tauri:dev`

- 结果：通过
- 运行入口：`http://127.0.0.1:1420/`
- 桌面进程：`src-tauri\target\debug\papyrus.exe`
- 说明：已修复 Vite 监听 `src-tauri/target` 导致的 Windows `EBUSY` 问题。

### `npm run tauri:build`

- 结果：未通过
- 失败点：Windows MSVC 链接阶段 `LNK1105`，无法关闭临时 `.exe/.dll`，错误代码 `1224`。
- 判断：这是本机链接器/文件锁问题。前端构建、TypeScript、Rust dev 编译和 Tauri dev 启动均已通过。

## DeepSeek 冒烟测试

测试模型：`deepseek-v4-flash`

测试入口：`https://api.deepseek.com`

原始结果文件：`artifacts/deepseek-smoke-0.1.2.json`（本地忽略，不提交仓库）

安全说明：API key 只作为当前 PowerShell 环境变量使用，报告、脚本和仓库文件均不保存 key。

| 场景 | 思考强度 | 温度 | 结果 | 耗时 | 估算输入 token | 估算输出 token | 输出字数 |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| 中文写作 | `medium` | 0.72 | 通过 | 11733 ms | 89 | 572 | 699 |
| 降噪改写 | `high` | 0.34 | 通过 | 2485 ms | 114 | 19 | 24 |
| 蜂巢结构化规划 | `ultra_hive` | 0.48 | 通过 | 3435 ms | 103 | 116 | 215 |
| 低强度摘要 | `low` | 0.22 | 通过 | 2028 ms | 84 | 61 | 72 |

### 结果摘要

- 写作能力：可输出有细节和节制的中文散文开头，约 699 字。
- 降噪能力：可将模板化表达压缩为短句，但这次结果偏保守；后续产品层可继续优化“保留信息量”的降噪提示。
- 蜂巢能力：`ultra_hive` 场景返回了合法结构化 JSON，包含 summary、agents、risks、nextStep、confidence。
- 动态温度：创作场景温度较高，调度/降噪/摘要场景温度较低，输出形态和长度有明显差异。
- token 消耗：四档测试均给出估算输入/输出 token，可作为后续成本控制基线。

## 手动验收建议

- 模型选择器在写作模式和秘书模式都能展开，弹层不会被底部区域裁剪。
- 内置模型显示为主站返回的 Scallion 模型，不再显示旧的 `qwen3.6` 文案。
- 思考强度四档 `low / medium / high / ultra+hive` 选中态都清晰可读。
- `ultra+hive` 运行时能看到计划 Agent、活跃 Agent、完成/失败/跳过数量和共享黑板事件。
- 长期记忆与短期运行状态分层：执行轨迹、todo、临时队列和文稿补丁不会作为长期记忆持久化。

## 结论

0.1.2 的代码级验证和 DeepSeek API 冒烟测试已完成。安装包构建仍受本机 Windows 链接器文件锁影响，需要在清理锁定/杀软干扰后重试 `npm run tauri:build`。
