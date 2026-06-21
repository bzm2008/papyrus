# Papyrus 0.1.2 测试报告

生成时间：2026-06-21

## 自动验证

### `npm run lint`

- 结果：通过
- 退出码：0

### `npm run build`

- 结果：通过
- 退出码：0
- 产物摘要：
  - `dist/index.html`
  - `dist/assets/index-CRjHqI8g.js`
  - `dist/assets/index-BGAt62I5.css`
- 备注：Vite 仍提示主 bundle 超过 500 kB，这只是体积警告，不是失败。

### `npm run wps:build`

- 结果：通过
- 退出码：0
- 产物摘要：
  - `dist-wps-addin/taskpane.html`
  - `dist-wps-addin/assets/taskpane-hhBYugzR.js`
  - `dist-wps-addin/assets/taskpane-CzvKZ25V.css`
  - `dist-wps-addin/js/main.js`

### `npm run tauri:dev`

- 结果：通过
- 前端入口：`http://127.0.0.1:1420/`
- 运行进程：`src-tauri\target\debug\papyrus.exe`
- 说明：本轮已成功启动桌面 dev 进程并返回 200。

### `npm run tauri:build`

- 结果：未通过
- 失败点：Windows MSVC 链接阶段 `LNK1105`
- 错误码：`1224`
- 失败对象：`E:\llinux os\papyrus\src-tauri\target\release\build\anyhow-2d126352a742942f\build_script_build-2d126352a742942f.exe`
- 说明：前置前端 build 已成功，失败发生在 Rust release 链接阶段，属于本机文件锁/链接器环境问题。

## DeepSeek 冒烟测试

测试模型：`deepseek-v4-flash`

测试入口：`https://api.deepseek.com`

原始结果文件：`artifacts/deepseek-smoke-real-0.1.2.json`

安全说明：API key 只作为当前 PowerShell 环境变量使用，报告、脚本和仓库文件均不保存 key。

| 场景 | 思考强度 | 温度 | 结果 | 耗时 | 估算输入 token | 估算输出 token | 输出字数 |
| --- | --- | ---: | --- | ---: | ---: | ---: | ---: |
| 中文写作 | `medium` | 0.72 | 通过 | 13389 ms | 89 | 750 | 920 |
| 降噪改写 | `high` | 0.34 | 通过 | 1831 ms | 114 | 19 | 24 |
| 蜂巢结构化规划 | `ultra_hive` | 0.48 | 通过 | 2693 ms | 103 | 133 | 237 |
| 低强度摘要 | `low` | 0.22 | 通过 | 1995 ms | 84 | 67 | 80 |

### 结果摘要

- 写作能力：可输出较完整的中文散文开头，文本细节和氛围稳定。
- 降噪能力：可将模板化表达压缩为短句，结果干净。
- 蜂巢能力：`ultra_hive` 场景返回了合法结构化 JSON，包含 summary、agents、risks、nextStep、confidence。
- 动态温度：创作、降噪、蜂巢、摘要四个场景输出长度和形态明显不同。
- token 消耗：四档测试都给出了估算输入/输出 token，可作为后续成本控制基线。

## 手动验收建议

- 模型选择器在写作模式和秘书模式都能展开，弹层不会被底部区域裁剪。
- 内置模型显示为主站返回的 Scallion 模型，不再显示旧的 `qwen3.6` 文案。
- 思考强度四档 `low / medium / high / ultra+hive` 选中态都清晰可读。
- `ultra+hive` 运行时能看到计划 Agent、活跃 Agent、完成/失败/跳过数量和共享黑板事件。
- 长期记忆与短期运行状态分层：执行轨迹、todo、临时队列和文稿补丁不会作为长期记忆持久化。

## 结论

0.1.2 的主应用、WPS 插件、Tauri dev 和 DeepSeek 冒烟测试都已按本轮真实数据验证通过。`npm run tauri:build` 仍受本机 Windows 链接器文件锁影响，安装包构建需要在清理锁定或杀软干扰后重试。
