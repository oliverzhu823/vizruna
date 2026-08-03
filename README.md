<p align="center">
  <img src="resources/icon.svg" width="180" alt="Vizruna" />
</p>

<p align="center">
  让 Pi 驱动的 AI Agent 在浏览器中可见、可控、可复核。
</p>

<p align="center">
  简体中文 · <a href="README.en.md">English</a>
</p>

# Vizruna

Vizruna 把 Pi Agent Runtime 变成一个可以日常使用的本地 Agent 工作台。
**Vizruna-web** 在浏览器中运行；你可以在同一个工作台里和 Agent 对话、观察思考与
工具执行、切换模型和思考强度、检查改动文件、使用终端，并组织多个 Agent 并行工作。

当前状态：**公开 Alpha**。Vizruna-web 是目前唯一维护和发布的用户版本；桌面客户端
已暂停开发与分发。Alpha 阶段请暂时不要把它用于不可中断的关键生产任务。

![Vizruna-web 工作台界面](docs/images/vizruna-web.png)

## v0.1.0-alpha.5 本次重点

- 新增唯一发布入口 **Vizruna-web**：在默认浏览器中使用完整 Agent Studio、模型登录、
  对话、文件、终端、Review、Worktree 和多 Agent 功能，不再发布桌面安装包。
- 新增可双击运行的 `Start-Vizruna-web.command`；首次自动准备依赖，Git 克隆版后续只在
  官方仓库、干净 `main` 分支和可快进时安全更新。
- 本地服务只监听 `127.0.0.1`，使用一次性随机启动令牌、HttpOnly 会话、来源与 CSRF
  校验、RPC 白名单和参数校验，局域网及其他网站无法直接调用本机 Agent。
- 会话、Pi 授权、Provider 设置、Agent 配置、提示词和案例都保存在源码目录之外；
  更新 Vizruna-web 不会删除这些用户数据。
- 浏览器内可以输入并验证项目目录；附件、诊断包和脱敏审计日志使用受控临时目录，
  导出完成后自动清理。
- 新增浏览器端端到端回归，覆盖登录事件、模型能力、项目切换、Review、Worktree、
  多 Agent、诊断导出、录音环境与核心安全拒绝路径。

完整变化见 [CHANGELOG.md](CHANGELOG.md)。

## 完整功能

### 对话、模型与运行过程

- **Pi 原生模型工作流**：选择 Provider、模型和思考强度；支持 `/login`、`/logout`、
  OAuth 和 Provider 提供的 API Key 登录。
- **新对话继承有效配置**：沿用上一次有效会话的模型和思考强度，并立即显示当前选择。
- **按 Provider 分流网络**：海外模型可走 V2Ray 等代理，国内模型保持直连，不修改
  macOS 全局代理，也不影响其他软件。
- **Agent 过程可见**：按真实时间顺序展示用户消息、正在思考、工具调用、流式回答、
  运行统计、上下文用量和对话分支。
- **会话操作**：支持项目会话、临时对话、重命名、Fork、Clone、回退和历史恢复。

### Agent Studio

- **Agent 配置库**：创建、编辑、复制、归档命名 Agent，为固定场景保存 System
  Prompt；从配置库可直接创建新对话。
- **系统提示词库**：独立管理可复用提示词；新对话也可临时输入一套不入库的提示词。
- **单会话单提示词**：每个新对话只能使用通用 Pi、某套系统提示词或某个 Agent
  配置中的一种，发送首条消息后保持不变。
- **Agent 案例库**：将有效会话归档成案例，保存名称、说明、标签、原项目、原会话、
  模型、思考等级与验证状态；案例不复制聊天正文或凭据。

### 项目工作台与复核

- **文件与终端**：内置文件浏览器和可交互项目终端。
- **Review 工作流**：在右侧查看文件改动、Diff、Markdown 和代码，也可调用 macOS
  默认应用打开文件。
- **Run、Context、Tree**：分别检查运行状态、上下文构成和会话分支，不只依赖
  Agent 的自然语言“已完成”。
- **图片与附件**：支持粘贴图片、引用文件与行号，并在浏览器中预览常见工具结果。

### 多 Agent 与扩展能力

- **受管 Git Worktree**：为并行任务创建隔离分支和工作目录，降低多个 Agent
  互相覆盖的风险。
- **子 Agent 编排**：创建、跟进和检查子任务，展示父子 Agent 状态与验证证据。
- **Skills、扩展与提示词资源**：管理 Pi Skills、Extensions、项目上下文和 Pi 原生
  Prompt 资源，保留与 Pi CLI 兼容的文件结构。
- **语音输入与提醒**：可配置语音转写；Agent 完成或需要用户确认时可发出本机提醒。

### 界面、数据与可靠性

- **中英文界面**：支持浅色、深色、跟随系统和“鼠尾草浅绿”护眼主题。
- **本地优先**：会话、OAuth、API 配置、案例与 Agent 配置保存在用户自己的电脑。
- **备份与审计**：为产品数据库迁移创建备份，并提供可靠性、恢复和脱敏审计能力。
- **安全更新**：Git 克隆版只在官方来源、干净 `main` 分支和可快进时更新；ZIP 版
  使用新版源码目录启动，用户数据保持不变。

## 安装并使用 Vizruna-web

Vizruna-web 的界面在默认浏览器中打开，Pi Runtime、终端、文件和凭据仍只在你的
电脑上运行，不会上传到 Vizruna 服务器。当前公开 Alpha 已在 macOS 上完成验收，
使用源码启动包运行，不需要安装 `.app` 或 DMG。

### 方式一：下载 Release 源码包（最适合普通使用者）

1. 安装 [Node.js](https://nodejs.org/zh-cn/download) 22.19.0 或更高版本，安装包中已包含 npm。
2. 打开 [Vizruna Releases](https://github.com/oliverzhu823/vizruna/releases)，下载
   `Vizruna-web-版本-source.zip`；建议同时下载 `SHA256SUMS.txt` 核对文件。
3. 解压 ZIP，进入解压后的 `Vizruna-web-版本` 文件夹。
4. 双击 `Start-Vizruna-web.command`。首次运行会联网安装本地运行依赖并构建页面，
   可能需要几分钟。
5. 默认浏览器自动打开后即可使用。运行期间保持终端窗口开启；要停止 Vizruna-web，
   回到该窗口按 `Control+C`。

需要核对下载文件时，把 ZIP 和 `SHA256SUMS.txt` 放在同一目录并执行：

```bash
grep 'Vizruna-web-.*-source.zip' SHA256SUMS.txt | shasum -a 256 -c -
```

出现 `OK` 才表示文件与 GitHub Release 中的校验记录一致。

如果 macOS 不允许直接执行启动器，右键点击它并选择**打开**。如果仍提示没有权限，
在该文件夹打开终端后执行：

```bash
chmod +x Start-Vizruna-web.command
./Start-Vizruna-web.command
```

不要对其他来源不明的脚本执行上述操作。

### 方式二：使用 Git 克隆（适合持续测试和开发）

在终端运行：

```bash
git clone https://github.com/oliverzhu823/vizruna.git
cd vizruna
./Start-Vizruna-web.command
```

这种方式还需要 Git。启动器会在每次运行时检查官方 `main` 分支；只有 origin 精确
指向 `oliverzhu823/vizruna`、当前分支为 `main`、本地没有改动并且可以快进时才更新。
离线、来源不符、分支分叉或存在本地修改时都会保留原状并继续启动。临时跳过检查可用：

```bash
VIZRUNA_WEB_SKIP_UPDATE=1 ./Start-Vizruna-web.command
```

每个 Release 只提供一个 Vizruna-web 源码 ZIP，并附带 SHA-256、SBOM 和 GitHub
构建来源证明，不再提供桌面安装包。

安全边界：服务只监听 `127.0.0.1`，不能被局域网其他设备访问；每次启动生成新的
随机访问令牌，并使用 HttpOnly 会话、同源校验和 CSRF 防护保护本地 API。不要修改
启动地址为 `0.0.0.0`，也不要把启动链接发给别人。

### 启动故障排查

- **提示没有 Node.js**：安装 Node.js 22.19.0 或更高版本，关闭终端窗口后重新启动。
- **启动器没有执行权限**：使用上面的 `chmod +x` 命令，只处理当前下载的启动器。
- **浏览器没有自动打开**：按 `Control+C` 停止后重新双击启动器；不要复用上一次启动
  地址，因为其中的一次性令牌已经失效。
- **提示已有实例运行**：关闭其他 Vizruna-web 启动窗口后重试。同一时间只运行一个实例。
- **首次安装依赖失败**：确认 npm 可以联网，重新运行启动器；它会从中断处重新准备环境。

## 第一次使用

1. 如果要操作代码或文档项目，点击**打开文件夹**；如果只是临时对话，直接使用
   **新对话**。
2. 点击输入框旁边的模型入口，选择 Provider、模型和思考强度。
3. 在输入框输入 `/login` 完成登录，或打开**设置 → 模型**。需要退出某个模型账号
   时使用 `/logout`。
4. 新对话如需特定角色，可在输入框左下角选择**系统提示词**或**Agent 配置**；
   不选择则使用通用 Pi。
5. 输入你希望 Agent 完成的结果。Vizruna 会立即显示你的消息，然后按时间顺序显示
   “正在思考”、工具执行和最终回答。
6. 使用右侧的 **Review、Run、Context、Tree** 检查结果。点击有改动的 Markdown
   文件可在右侧预览；如果更习惯本机软件，也可以选择使用默认应用打开。

### 海外模型走代理、国内模型直连

进入**设置 → Provider 路由**，先添加一个代理配置，再分别给各个 Provider 选择
路线。例如，让 OpenAI Codex 使用 V2Ray 配置，同时让中国模型 Provider 保持
**直连**。该配置只作用于对应的 Agent Worker，不会改写系统全局代理，因此不会
影响其他软件。

## Agent 配置、系统提示词和案例怎么用

- **只是想临时定制下一次对话**：新建对话 → 打开 Agent/提示词选择器 → 临时自定义
  System Prompt。它只用于这次新会话，不进入库。
- **提示词会重复使用，但模型等设置仍想临时选择**：进入**设置 → 提示词 → 会话系统
  提示词**，保存到提示词库；新建对话时选择它。
- **已经形成稳定角色或工作方法**：进入 **Agent 配置库**，建立命名 Agent；以后
  直接从该配置启动对话。
- **一次真实任务已经跑通，值得沉淀和复测**：在当前会话中选择归档为 **Agent
  案例**，填写说明和标签；复核后将状态标记为“已验证”。

System Prompt 负责固定 Agent 的角色、目标、边界和输出要求；需要在运行过程中按需
调用的方法，更适合做成 Skill。

## 升级与数据保留

**Git 克隆版**：正常双击启动器即可。满足官方来源、干净 `main` 分支和可快进三个
条件时，启动器会先安全更新代码，再安装有变化的依赖并重新构建。

**Release ZIP 版**：停止旧版本，从 Releases 下载新版 ZIP，解压到一个新文件夹，
然后运行新文件夹里的启动器。确认新版正常后可以删除旧的源码文件夹；不要把用户数据
目录一起删除。ZIP 副本不会自行覆盖源码，避免更新失败时损坏当前可用版本。

两种升级方式都不会删除以下外部数据：

- `~/Library/Application Support/Vizruna`：产品设置、Agent 配置、提示词库、案例索引
  和数据库。
- `~/.pi/agent`：Pi 会话、OAuth 与 Provider 配置。
- `~/.vizruna/worktrees`：受管工作目录。

请勿手动或使用清理工具删除这些目录。Alpha 阶段升级前建议备份上述目录；数据库只
保证向前迁移，不建议运行新版后再降级。

## 用户数据与隐私

- 每位用户的 Pi 会话和认证信息保存在自己 Mac 的 `~/.pi/agent`。
- Vizruna 的偏好设置和产品元数据保存在
  `~/Library/Application Support/Vizruna`。
- Release 源码包由 GitHub 从仓库提交生成，不包含维护者的对话、最近项目、Token、代理密码
  或本机路径。
- 用户仍应避免在提示词中发送敏感信息，也不要把凭据提交进项目仓库。

## 反馈与参与

Vizruna 欢迎早期用户。你可以通过 [GitHub Issues](https://github.com/oliverzhu823/vizruna/issues)
报告问题、提出改进建议，或者描述你希望 Agent 支持的真实工作流程。反馈时建议提供
Vizruna 版本、macOS 版本、Mac 型号和所用模型 Provider，但不要公开 API Key、OAuth
Token 或私人对话内容。

## 本地开发

环境要求：Node.js 22.19.0 或更高版本、npm 和 Git。当前用户发布流程已在 macOS
完成验收；Windows 和 Linux 尚未承诺公开 Alpha 支持。

`npm run dev:web` 使用与公开 Vizruna-web 相同的本机产品数据，便于复现真实使用状态；
修改数据库或凭据相关功能前应先备份。自动化 E2E 使用独立临时用户目录和 Pi 目录，
不会读取正式用户的 OAuth、API Key 或会话。

```bash
nvm use
npm ci
npm run dev:web
```

日常产品开发和验收都使用 Vizruna-web。桌面客户端源码暂时保留作为共享运行时和回退
参考，但停止功能迭代，也不进入预发布产物。

执行完整质量检查：

```bash
npm run verify
```

运行浏览器端端到端测试：

```bash
npm run test:e2e:install
npm run test:e2e:web
```

打上版本 Tag 后，GitHub 工作流只生成版本化 Vizruna-web 源码 ZIP、SHA-256、SBOM
和构建来源证明，不构建或上传 DMG、`.app` 或桌面 ZIP。
