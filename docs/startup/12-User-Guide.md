# Vizruna v0.1 用户手册

本手册面向首批内部或友好客户试点用户。v0.1 是 macOS Apple Silicon 本地 Agent 工作台；它不是多租户 SaaS，也不提供企业 SSO、集中式 RBAC 或远程托管。

## 1. 安装前准备

需要：

- Apple Silicon Mac。
- 一个可读写的项目目录。
- 如需代码任务，该目录应是 Git 仓库。
- 至少一个已在 Pi 中配置的模型 Provider。
- 访问国际 Provider 时，一个可用的 HTTP、HTTPS、SOCKS5 或 SOCKS5H 代理监听地址。

不要使用生产客户密钥做首次试点。先准备限额测试 Key，并确保可以随时吊销。

## 2. 安装与首次启动

1. 从公司内部发布页下载 arm64 DMG 和 `SHA256SUMS.txt`。
2. 校验下载文件哈希：

   ```bash
   shasum -a 256 "Vizruna-0.1.0-alpha.1-arm64.dmg"
   ```

3. 打开 DMG，把 Vizruna 拖入“应用程序”。
4. 从“应用程序”启动。正式试点包应直接通过 Gatekeeper；如果系统提示开发者无法验证，不要用右键强行绕过，联系发布负责人。
5. 在设置中选择简体中文或 English。核心界面会立即切换，不需要重启。
6. 点击“打开文件夹”，选择试点项目。

## 3. 配置模型

应用沿用 Pi 的模型和认证体系：

- Pi 全局目录：`~/.pi/agent`
- 认证：`~/.pi/agent/auth.json`
- 自定义 Provider/模型：`~/.pi/agent/models.json`

在“设置 → 模型”中检查 Provider 和模型是否出现。API Key 或 OAuth 状态由 Pi 管理；应用不会把明文密钥写入自己的 SQLite 元数据库。

### 3.1 在 GUI 中登录 Provider

1. 先按下一节给目标 Provider 选择正确路由。OpenAI 等国际 Provider 通常选择代理 Profile，中国 Provider 通常选择直连。
2. 进入“设置 → Pi → Provider 登录”，找到目标 Provider。界面会同时显示当前登录路由。
3. 选择“账号登录”或“API Key”。浏览器授权、设备码、选择和文本输入会由桌面界面继续引导。
4. 登录完成后状态变为“已连接”。退出登录也在同一行完成。

登录网络只作用于当前 Provider 的认证流程，不修改 macOS 全局代理，也不影响其他软件或中国 Provider。若失败，界面会显示错误类别、当前路由和建议操作；不要只根据浏览器显示“授权成功”判断，仍要回到应用确认“已连接”。

## 4. 为不同 Provider 设置不同网络

进入“设置 → Provider 路由”。

### 4.1 三种模式

- `直连/direct`：明确绕过启动 Shell 中已有代理。适合中国 Provider。
- `系统/system`：读取应用启动环境或 macOS 当前代理。应用只读，不改系统设置。
- `代理 Profile/profile`：只让指定 Provider 使用应用内的 HTTP、HTTPS、SOCKS5 或 SOCKS5H 代理。

推荐示例：

| Provider | 路由 |
| --- | --- |
| OpenAI / Anthropic / Google | 指定代理 Profile |
| 智谱 GLM / Moonshot / 国内自建服务 | 直连 |

### 4.2 V2RayN 示例

1. 在 V2RayN 中确认本地 HTTP 或 SOCKS5 入站已开启。常见示例为 `127.0.0.1:10808`，以你的实际设置为准。
2. 新建代理 Profile：
   - 协议：`http`
   - Host：`127.0.0.1`
   - Port：V2RayN 的 HTTP 监听端口，例如 `10808`
   - 用户名/密码：只有本地监听明确配置了认证时才填写
   - `NO_PROXY`：可选，例如 `localhost,127.0.0.1,*.corp.example`
3. 保存后，把 OpenAI 等国际 Provider 指向该 Profile。
4. 把智谱、Moonshot 等中国 Provider 设为“直连”。
5. 分别点击“测试连接”。

注意：

- 当前 Profile 支持 HTTP、HTTPS、SOCKS5 和 SOCKS5H；SOCKS5H 表示目标域名由代理侧解析。PAC 地址不在 v0.1 范围。
- `NO_PROXY` 支持逗号或空格分隔的主机、域名后缀、可选端口和 `*`。未填写时，显式 Profile 不会继承 Shell 中的绕过规则。
- “测试连接”不携带模型凭据，也不会产生推理费用。401/403 可能表示网络已经通，但仍需用测试 Key 完成一次真实调用。
- 路由修改不会影响其他软件，也不会改 macOS 或代理客户端配置。
- Agent 正在运行时修改路由，本回合继续使用原路由；新路由在回合结束后生效。

## 5. 开始第一个任务

1. 打开项目。
2. 点击项目行右侧的新建按钮，打开“新建 Agent 任务”。
3. 选择 Local 或 Worktree、Provider、模型和 Thinking 等级。
4. 如选择 Worktree，可让系统自动生成 Worktree/分支，也可分别填写名称；
   已存在或不合法的分支会被拒绝，不会覆盖原分支。
5. 输入一个范围清晰、可验证的首条任务，例如：

   > 阅读项目说明，找出启动命令，不修改文件；最后列出依据。

6. 高级选项可调整当前 Provider 路由和最大并行 Worker。
7. 点击“准备任务”后，先在 Composer 复核文字，再由你发送。
8. 对修改代码的任务，要求 Agent 给出变更文件和测试结果。
9. 在右侧的 Review、Run、Context 面板检查真实变更、执行状态和上下文。

不要仅凭自然语言“已完成”判断成功。以 Review 中的文件、命令退出码和验证证据为准。

## 6. Worktree 与多 Agent

### 6.1 何时使用 Worktree

当多个子 Agent 会并行修改同一 Git 仓库时，为每个子任务使用独立 Worktree。这样可以减少分支和未提交文件互相覆盖。

### 6.2 安全规则

- 受管 Worktree 默认位于 `~/.vizruna/worktrees`。
- 非 Git 目录不能伪装成已隔离 Worktree。
- 有未提交、未推送、未合并或正在运行的任务时，普通删除会被阻止。
- “强制删除”会丢失工作区内容，只能在确认预览的路径和 Git 状态后使用。
- 不要在 Finder 中手工移动或删除受管 Worktree；先在应用中停止 Agent 并执行回收。

### 6.3 多 Agent 判断结果

任务树展示父子关系、状态、会话、Worktree 和证据。默认最多 4 个活跃 Worker；达到上限时新任务排队。取消父任务会递归取消子任务，但保留 Worktree 和已有证据供检查。

### 6.4 使用内嵌终端

1. 打开项目或某个受管 Worktree。
2. 在右侧面板选择“终端”。首次打开会在当前可信目录启动一个真实 PTY Shell。
3. 使用“+”新建标签；标签之间是独立 Shell 进程。关闭最后一个标签后不会自动重开，可点击空态重新创建。
4. 切换项目或 Worktree 时，旧目录的终端会被停止，防止命令继续在错误项目中运行。

终端是用户直接操作本机 Shell 的界面，不是安全沙箱，也不是 Agent 工具执行通道。不要在不可信项目中执行未知脚本；终端输出、代码和第三方命令不会被翻译。

## 7. 恢复、诊断与备份

进入“设置 → 可靠性与诊断”可以：

- 查看统一故障与恢复状态。
- 预览脱敏诊断包。
- 导出诊断包。
- 创建产品元数据 SQLite 备份。
- 从已登记且完整性检查通过的备份恢复。

诊断包默认不包含完整对话、API Key、Cookie、Authorization Header 或代理密码。发送给支持人员前仍应先预览。

Pi JSONL 是对话事实来源，位于 `~/.pi/agent`。SQLite 只保存产品关系、Worktree 登记、审计等元数据；恢复 SQLite 不会改写 Pi JSONL。

## 8. 常见问题

### OpenAI 授权成功后仍显示地区不支持

1. 不要先改全局系统代理。
2. 在“Provider 路由”中为 OpenAI 指定显式 HTTP/HTTPS/SOCKS5 Profile。
3. 确认协议和 Host/Port 与代理客户端实际开启的入站一致；不要把 SOCKS 端口保存成 HTTP 协议。
4. 运行连接测试，查看 endpoint、DNS 和 HTTP 阶段。
5. 结束当前 Agent 回合后再重试授权或模型调用。

### 中国模型变慢或访问失败

把该 Provider 改为“直连”，避免它继承 Shell 中的 `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY` 或 `NO_PROXY` 规则。

### 会话变成只读或提示外部修改

另一个 Pi 应用、CLI 或旧 Worker 可能在写同一 JSONL。先关闭其他写入者，再刷新。不要强制接管仍在写入的会话；必要时导出诊断包。

### Worktree 无法删除

检查阻断项：运行中 Agent、未提交文件、未推送提交、未合并分支或路径不在受管根目录。优先处理这些状态，不要直接从 Finder 删除。

### 应用崩溃后任务仍显示运行中

重启应用。恢复扫描会把无法证明仍在运行的任务标记为中断，而不会标记成功。检查任务证据和 Worktree 后选择重试或结束。

### 切换英文后仍看到中文

先确认文字不是模型输出、项目内容或 Provider 自身名称。若是菜单、按钮、对话框或错误提示，请截图并记录所在页面；CI 已阻止已知核心 UI 的硬编码中文。

## 9. 数据、升级与卸载

- 产品数据目录：`~/Library/Application Support/Vizruna`
- Pi 会话与认证：`~/.pi/agent`
- 受管 Worktree：`~/.vizruna/worktrees`

源码开发模式显示为 `Vizruna Dev`，并使用以下隔离目录：

- 开发数据：`~/Library/Application Support/Vizruna Dev`
- 开发 Pi 会话与认证：`~/Library/Application Support/Vizruna Dev/pi-agent`

因此，正式安装版会复用本机 Pi 用户自己的全局登录，而开发版和自动化测试不会读取
这些真实凭据。开发时运行 `npm run dev`；不要直接双击 `dist/mac-arm64` 中的候选
`.app`，该文件仍使用正式产品身份。

升级前在“可靠性与诊断”中创建元数据备份，然后退出应用并安装新版本。v0.1 不依赖自动更新元数据，使用公司提供的新版 DMG 手动覆盖应用。

把应用从“应用程序”移到废纸篓不会自动删除上述用户数据、项目、Pi JSONL 或 Worktree。需要清理时先由负责人确认备份和 Worktree 状态。

## 10. 当前明确不包含

- Windows/Linux 正式支持。
- 多租户、SSO、RBAC、集中审计服务和远程 Agent 托管。
- 对不可信项目或第三方扩展的操作系统级沙箱。
