# Debian 13 发布验证

Papyrus 对 Debian 13 的支持包含两层：GitHub Actions 中的 `debian:13` 容器构建验证，以及真实 Debian 13 设备上的安装与秘书流程验证。容器构建只能证明依赖、编译和包面存在，不能替代桌面环境、托盘和恢复行为的现场记录。

## CI 容器

`desktop-ci.yml` 的 `debian13` job 使用干净的 `debian:13` 容器运行 `scripts/ci/debian13-container.sh`。该脚本会：

1. 安装 Tauri、WebKit、托盘和打包所需的 Debian 依赖。
2. 安装项目指定的 Rust 1.95.0，并使用系统 Node/npm。
3. 执行 `npm ci`、`npm run version:check`、前端构建与 `cargo check --locked`。
4. 使用 Linux smoke overlay 构建 DEB 和 AppImage，并确认两种产物均存在。

本地复现可在 Linux Docker 主机中执行：

```bash
docker run --rm \
  --volume "$PWD:/workspace" \
  --workdir /workspace \
  debian:13 \
  bash scripts/ci/debian13-container.sh
```

容器中的文件由 root 创建；本地复现后请按本机策略清理 `node_modules` 和 `src-tauri/target`，不要将它们提交。

## 真实设备硬门

在 Debian 13 x64 的常用桌面环境中分别验证 DEB 与 AppImage，并为每种包记录 OS 版本、桌面环境、架构、Papyrus commit、包文件 SHA-256、测试日期、测试者、日志/截图路径和结果。

1. 使用包管理器安装 DEB；对 AppImage 执行 `chmod +x` 后启动。两者均应能首次启动、再次启动和正常卸载/删除。
2. 主窗口关闭应隐藏到托盘；从托盘显示、暂停、取消和显式退出均应可用。显式退出后重启应用，任务应处于已保存的安全状态而非重复执行。
3. 创建项目后运行写作、研究、沟通和整理任务；确认 SQLite 账本可保存项目、低风险记忆、任务、检查点和检索历史，并且跨项目搜索不会默认泄漏其他项目记录。
4. 暂停一个可恢复任务，重启后从最近检查点恢复；取消任务后不得继续流式输出、工具运行或产生新的自动写入。
5. 验证文件操作和 Browser Bridge 的预览/审批边界：拒绝高风险动作后不得执行，批准仅适用于该次预览，过期或已变更的目标必须失效。
6. 验证 Browser Bridge 配对、断开、受限页面阻止和普通页面只读/已批准动作；不得记录凭证、表单值或敏感页面内容。
7. 检查 DEB/AppImage 的首次启动、托盘、SQLite 初始化、恢复和受控工具流程的日志中没有崩溃、数据丢失或未批准的后台动作。

任一崩溃、任务重复、项目隔离失败、敏感信息落盘、未经批准的文件/浏览器动作、托盘退出丢失检查点或包无法启动均为发布 blocker。记录使用 [跨平台认证矩阵](WORK_ASSISTANT_PLATFORM_MATRIX.md) 和 [测试记录模板](WORK_ASSISTANT_TEST_RECORD_TEMPLATE.md)。
