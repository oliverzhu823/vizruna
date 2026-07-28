<p align="center">
  <img src="resources/icon.svg" width="180" alt="Vizruna" />
</p>

<p align="center">
  让 Pi 驱动的 AI Agent 在桌面上可见、可控、可复核。
</p>

<p align="center">
  简体中文 · <a href="README.md">English</a>
</p>

# Vizruna

Vizruna 把 Pi Agent Runtime 变成一个可以日常使用的桌面产品。你可以在同一个
工作台里和 Agent 对话、观察思考与工具执行、切换模型和思考强度、检查改动文件、
使用终端，并组织多个 Agent 并行工作。

当前状态：**公开 Alpha**。所有人都可以下载和使用 Vizruna。现阶段可下载安装的
版本支持 **Apple 芯片 Mac（M1/M2/M3/M4 及后续型号）**。我们正在寻找早期用户和
真实反馈；Alpha 阶段请暂时不要把它用于不可中断的关键生产任务。

![Vizruna 桌面工作台](docs/images/vizruna-desktop.png)

## 主要功能

- **中英文界面**：支持浅色、深色、跟随系统和“鼠尾草浅绿”护眼主题。
- **保留 Pi 原生模型体验**：可选择 Provider、模型和思考强度；支持 `/login`、
  `/logout`，以及 Provider 提供的 OAuth 或 API Key 登录方式。
- **按 Provider 分流网络**：海外模型可以走代理，国内模型可以保持直连，且不会
  修改操作系统的全局代理。
- **Agent 过程可见**：按时间顺序展示回答、思考状态、工具调用、运行统计、上下文
  用量和对话分支。
- **项目工作台**：内置文件浏览器、终端和以项目为中心的多会话管理。
- **文件复核**：在右侧 Review 中查看改动和 Markdown，也可以调用 macOS 默认应用
  打开文件。
- **多 Agent 协作**：支持受管 Git Worktree、子 Agent、任务状态和异常恢复，同时
  继续使用现有的进程、状态与 UI 架构。
- **本地优先**：Pi 会话和授权留在用户自己的电脑上，安装包不会携带开发者的
  对话记录或凭据。

## 下载和安装

1. 打开仓库的 [Releases 页面](https://github.com/oliverzhu823/vizruna/releases)。
2. 在最新的预发布版本中下载 `Vizruna-*-arm64.dmg`。
3. 打开 DMG，把 **Vizruna** 拖到“应用程序”文件夹。
4. 启动 Vizruna。如果 macOS 阻止打开这个尚未签名的 Alpha 包，请按住 Control
   点击应用并选择“打开”，或者前往“系统设置 → 隐私与安全性”确认打开。

当前 DMG 只适用于 Apple 芯片 Mac。Windows、Linux 和 Intel Mac 尚未完成发布验收。

## 第一次使用

1. 如果要操作代码或文档项目，点击**打开文件夹**；如果只是临时对话，直接使用
   **新对话**。
2. 点击输入框旁边的模型入口，选择 Provider、模型和思考强度。
3. 在输入框输入 `/login` 完成登录，或打开**设置 → 模型**。需要退出某个模型账号
   时使用 `/logout`。
4. 输入你希望 Agent 完成的结果。Vizruna 会立即显示你的消息，然后按时间顺序显示
   “正在思考”、工具执行和最终回答。
5. 使用右侧的 **Review、Run、Context、Tree** 检查结果。点击有改动的 Markdown
   文件可在右侧预览；如果更习惯本机软件，也可以选择使用默认应用打开。

### 海外模型走代理、国内模型直连

进入**设置 → Provider 路由**，先添加一个代理配置，再分别给各个 Provider 选择
路线。例如，让 OpenAI Codex 使用 V2Ray 配置，同时让中国模型 Provider 保持
**直连**。该配置只作用于对应的 Agent Worker，不会改写系统全局代理，因此不会
影响其他软件。

## 用户数据与隐私

- 每位用户的 Pi 会话和认证信息保存在自己 Mac 的 `~/.pi/agent`。
- Vizruna 的偏好设置和产品元数据使用独立的 `Vizruna` 用户数据目录。
- 发布包来自经过清理的构建目录，不包含维护者的对话、最近项目、Token、代理密码
  或本机路径。
- 用户仍应避免在提示词中发送敏感信息，也不要把凭据提交进项目仓库。

## 反馈与参与

Vizruna 欢迎早期用户。你可以通过 [GitHub Issues](https://github.com/oliverzhu823/vizruna/issues)
报告问题、提出改进建议，或者描述你希望 Agent 支持的真实工作流程。反馈时建议提供
Vizruna 版本、macOS 版本、Mac 型号和所用模型 Provider，但不要公开 API Key、OAuth
Token 或私人对话内容。

## 本地开发

环境要求：Node.js 22.19.x、npm、Git；当前安装包目标为 macOS Apple Silicon。

```bash
nvm use
npm ci
npm run dev
```

执行完整质量检查：

```bash
npm run verify
```

生成内部 macOS 安装包：

```bash
npm run package -- --mac
```

正式签名和 Apple 公证需要发布凭据，仓库中不会保存这些敏感信息。

## 架构与开发文档

- 产品底座：[`justhil/pi-app`](https://github.com/justhil/pi-app)，固定提交
  `bcef920e3900a858b305c67c42a34e61779f977c`
- 行为参考：[`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui)
- Agent Runtime：`@earendil-works/pi-coding-agent@0.82.1`
- [开发启动包](docs/startup/README.md)
- [PRD v0.1](docs/startup/01-PRD-v0.1.md)
- [架构 RFC-001](docs/startup/02-Architecture-RFC-001.md)
- [开发路线图](docs/startup/03-Development-Roadmap.md)
- [验收标准](docs/startup/04-Acceptance-Criteria.md)
- [使用指南](docs/startup/12-User-Guide.md)
- [macOS 发布手册](docs/startup/13-macOS-Release-Runbook.md)
- [上游维护策略](UPSTREAM.md)
- [第三方声明](NOTICE.md)

产品保留 Electron Main、Preload、React Renderer 和 Utility Worker 边界；不会硬合并
两个 GUI 仓库，也不会引入第二套全局状态模型。
