## Vizruna-web v0.1.0-alpha.6

### Pi-native Agent Harness 升级

- Agent 配置库升级为完整工作台，可组合并检查模型、System Prompt、工具和 Pi 原生资源。
- 新增不可变 Agent Version、固定任务评测、版本对比和验证门禁。
- 新增 Pi Package Studio、目标环境就绪检查和安全的 Package 导入流程。
- 新增 Pi 有效配置、资源中心和 Run Debugger，提供逐轮运行、Context、Token、费用、工具与错误证据。
- 内嵌 Pi Runtime 升级到已验证的 `0.84.1`。
- 右侧工具导航改为紧凑分组布局，所有面板可以直接点击切换。

### 安装方法

1. 安装 Node.js 22.19.0 或更高版本。
2. 下载 `Vizruna-web-0.1.0-alpha.6-source.zip` 和 `SHA256SUMS.txt`。
3. 解压 ZIP，双击 `Start-Vizruna-web.command`。
4. 首次启动等待依赖安装和页面构建完成，默认浏览器会自动打开。
5. 保持启动终端运行；需要停止时按 `Control+C`。

完整安装、升级、功能和故障处理说明见 [README.md](README.md)。

### 发布物

本版本只发布 Vizruna-web 源码 ZIP、SHA-256、SBOM 和 GitHub 构建来源证明，不包含
DMG、`.app` 或桌面 ZIP。发布包由 GitHub 从仓库提交生成，不包含维护者的会话、
OAuth 凭据、最近项目或本机路径。
