## Vizruna v0.1.0-alpha.1

### 首个朋友测试版

- 正式启用 **Vizruna** 品牌与像素 Logo，覆盖应用窗口、Dock、安装包、favicon、加载动画和仓库展示
- 提供中文优先的 Pi Agent 桌面界面，内嵌 `@earendil-works/pi-coding-agent@0.82.1`
- 支持在输入框选择模型和推理强度，新会话继承上一次有效会话配置
- 恢复 Pi 原生 `/login`、`/logout` 工作流，并在“设置 → 模型”集中管理 OAuth 与 API Key
- Provider 可分别选择直连、系统代理或指定代理配置，不修改操作系统全局代理
- 修复流式消息时间顺序、发送后的即时“正在思考”反馈与多处模型切换同步问题
- Markdown 和代码文件可在右侧 Review/文件面板预览，也可调用系统默认应用打开
- 新增鼠尾草浅绿护眼主题、集成终端、受管 Git Worktree 与多 Agent 编排能力

### 安装方法

1. 下载 `Vizruna-0.1.0-alpha.1-arm64.dmg`。
2. 打开 DMG，将 Vizruna 拖入“应用程序”。
3. 本版本尚未使用 Apple Developer ID 签名或公证；如果 macOS 阻止首次打开，请进入“系统设置 → 隐私与安全性”，确认仍要打开。

### 测试版说明

- 当前仅支持 Apple Silicon Mac。
- 安装包不包含开发者的会话、OAuth 凭据、项目列表或本机路径。
- `SHA256SUMS.txt` 可用于校验下载文件，SBOM 文件记录生产依赖。

---

安装包见本页 Assets。请将使用中发现的问题记录到仓库 Issues。
