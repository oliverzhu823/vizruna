<p align="center">
  <img src="resources/vizruna-lockup.svg" width="520" alt="Vizruna" />
</p>

# Vizruna

Vizruna 是基于 Pi SDK 构建的本地 AI Agent 工作台。它让 Agent 的执行过程
可见、可控、可复核。产品继续以
Pi JSONL 会话作为对话事实来源，并增加多 Agent 安全并行、受管 Git Worktree、
Provider 独立网络路由、异常恢复、审计证据和中英文操作能力。

当前状态：朋友测试 Alpha。现阶段支持 macOS Apple Silicon，安装包通过
GitHub Releases 提供。

## 下载安装

1. 打开仓库右侧的 **Releases**。
2. 下载名称以 `Vizruna-` 开头、以 `-arm64.dmg` 结尾的文件。
3. 打开 DMG，将 Vizruna 拖入“应用程序”。
4. 如果测试包尚未完成 Apple 公证，首次运行请在“系统设置 → 隐私与安全性”中确认打开。

测试版本不会携带开发者的会话、项目列表、授权凭据或本机路径；每位测试者在自己的
电脑上独立登录和选择项目。

## 架构基线

- 产品底座：[`justhil/pi-app`](https://github.com/justhil/pi-app)
- 固定提交：`bcef920e3900a858b305c67c42a34e61779f977c`
- 行为参考：[`minghinmatthewlam/pi-gui`](https://github.com/minghinmatthewlam/pi-gui)
- Agent Runtime：`@earendil-works/pi-coding-agent@0.82.1`

产品保留 Electron Main、Preload、React Renderer 和 Utility Worker 边界。不合并
两个 GUI 项目的 Git 历史，也不引入第二套全局状态模型。

## 本地开发

环境要求：

- v0.1 发布目标为 macOS Apple Silicon
- Node.js 22.19.x
- npm
- Git

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

签名和公证需要公司的发布凭据，仓库中不保存这些信息。

## 开发文档

- [开发启动包](docs/startup/README.md)
- [PRD v0.1](docs/startup/01-PRD-v0.1.md)
- [架构 RFC-001](docs/startup/02-Architecture-RFC-001.md)
- [开发路线图](docs/startup/03-Development-Roadmap.md)
- [验收标准](docs/startup/04-Acceptance-Criteria.md)
- [风险登记册](docs/startup/05-Risk-Register.md)
- [M0 基线证据](docs/startup/06-M0-Baseline-Report.md)
- [上游维护策略](UPSTREAM.md)
- [第三方声明](NOTICE.md)

## 数据边界

- 现有 Pi 会话和认证信息继续位于 `~/.pi/agent`。
- 产品配置和企业元数据使用独立的 `Vizruna` 用户数据目录。
- 应用不得修改操作系统全局代理。
- 每个 Provider 的路由只作用于对应 Worker。
