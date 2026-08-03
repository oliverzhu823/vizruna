## Vizruna-web v0.1.0-alpha.5

### 首个 Vizruna-web 公开测试版

- Vizruna-web 成为唯一维护和发布的用户版本；桌面客户端暂停开发与分发。
- 在默认浏览器中提供完整的 Pi 对话、模型登录、Agent Studio、文件、终端、Review、
  Worktree 和多 Agent 能力。
- 本地服务只绑定 `127.0.0.1`，并使用一次性启动令牌、HttpOnly 会话、同源与 CSRF
  校验、RPC 白名单和参数校验。
- 会话、OAuth、Provider 设置、Agent 配置、提示词和案例保存在源码目录之外，更新
  Vizruna-web 不会删除这些数据。

### 安装方法

1. 安装 Node.js 22.19.0 或更高版本。
2. 下载 `Vizruna-web-0.1.0-alpha.5-source.zip` 和 `SHA256SUMS.txt`。
3. 解压 ZIP，双击 `Start-Vizruna-web.command`。
4. 首次启动等待依赖安装和页面构建完成，默认浏览器会自动打开。
5. 保持启动终端运行；需要停止时按 `Control+C`。

完整安装、升级和故障处理说明见 [README.md](README.md)。

### 发布物

本版本只发布 Vizruna-web 源码 ZIP、SHA-256、SBOM 和 GitHub 构建来源证明，不包含
DMG、`.app` 或桌面 ZIP。发布包由 GitHub 从仓库提交生成，不包含维护者的会话、
OAuth 凭据、最近项目或本机路径。
