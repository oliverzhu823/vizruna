# Vizruna 产品需求文档

文档编号：PRD-001  
版本：0.2.0
状态：Approved for internal Alpha  
日期：2026-07-30
目标版本：Agent Studio Alpha / v0.1
负责人：待指定

## 1. 产品摘要

Vizruna 是面向 AI 转型项目的本地 Agent 工作台。它以现有桌面工程为产品底座，提供中文界面、文件工作台、会话树、扩展适配、独立 Worker、会话租约、Git Worktree、多 Agent 编排、集成终端和 Provider 登录能力。

产品长期路线已经确定：前期作为创始人和合作伙伴使用的 **Agent Studio**，中期演进为验证、版本化和打包成熟 Agent 的 **Agent 工厂**，后期通过独立 **Runtime** 将成熟 Agent 交付给客户。详细边界见 `19-Studio-Factory-Runtime-Roadmap.md`。

v0.1 的目标不是构建多租户 SaaS，而是提供一个可以稳定交付给企业内部技术团队的本地桌面客户端：

- 能使用国内外模型。
- 能让多个 Agent 安全并行工作。
- 能隔离代码修改。
- 能查看父子 Agent 状态和结果。
- 能在异常退出后恢复。
- 能以中文完成主要操作。
- 能把跑通的对话沉淀为可继续验证的 Agent 案例。

## 2. 背景与问题

现有 Pi CLI 适合技术用户，但企业落地存在以下问题：

1. 终端交互对非专业用户门槛高。
2. 多个 Agent 在同一代码目录中运行会产生文件冲突。
3. Agent 并发状态、父子关系和交付证据不可视。
4. 海外模型需要代理，中国模型需要直连，配置复杂。
5. GUI 与 CLI 共享会话时存在并发写入风险。
6. 开源 GUI 的签名、升级、审计和稳定性不足以直接作为企业产品。

## 3. 产品目标

### 3.1 v0.1 目标

| ID | 目标 | 成功判定 |
|---|---|---|
| G-01 | 提供完整中文 Agent 桌面工作流 | 核心流程不依赖英文理解或终端操作 |
| G-02 | 支持多个 Agent 并行运行 | 至少 4 个 Agent 可并行，状态互不串线 |
| G-03 | 隔离并行代码修改 | 子 Agent 默认可运行在独立 Git Worktree |
| G-04 | 防止会话并发写坏 | 同一会话只允许一个桌面写入者 |
| G-05 | 提供原生父子 Agent 编排 | 父 Agent 可创建、查询、读取和追问子 Agent |
| G-06 | 支持国内外模型路由 | Provider 可选择直连、系统代理或指定代理配置 |
| G-07 | 可恢复、可诊断 | 异常退出后能识别未完成任务、孤立 Worker 和 Worktree |
| G-08 | 形成可持续产品底座 | 有稳定 IPC、数据迁移、测试和签名发布流程 |
| G-09 | 不依赖命令行完成 Provider 登录 | 在设置中完成登录、交互、退出，并解释失败原因和所用路由 |
| G-10 | 提供完整项目终端 | 在可信 Workspace/Worktree 中使用多标签 PTY，不与 Agent Worker 混用 |
| G-11 | 沉淀 Agent 案例资产 | 有效会话可被命名、分类、验证、归档并重新打开 |

### 3.2 v0.1 非目标

以下能力不进入 v0.1：

- 多租户 SaaS。
- 企业 SSO、RBAC 和组织管理。
- 云端集中调度和远程 Worker 节点。
- 计费、用量结算和客户套餐。
- 手机端。
- 浏览器控制或完整 Computer Use。
- 自动合并所有子 Agent 的 Git 分支。
- 替代 GitHub/GitLab 的代码评审平台。
- 翻译模型回复、代码、终端输出或第三方扩展内容。

## 4. 目标用户

### 4.1 企业 AI 顾问

需要为客户快速配置模型、Skills、扩展和工作流，并能演示多个 Agent 分工。

### 4.2 企业开发者

需要让 Agent 修改代码、运行测试、查看 Diff，同时避免多个 Agent 修改同一工作目录。

### 4.3 Agent 操作员

不一定熟悉终端，需要通过中文界面启动任务、查看状态、回应问题和收集结果。

### 4.4 产品管理员

负责安装、升级、代理配置、模型配置、故障诊断和审计导出。

## 5. 核心使用场景

### SC-01：单 Agent 日常任务

用户打开项目，选择模型和思考等级，发送任务，查看流式消息、工具调用、文件变更和 Diff。

### SC-02：在独立 Worktree 中执行任务

用户创建新任务并选择 Worktree。系统创建新分支和目录，在该目录启动独立 Worker。任务完成后用户查看结果并选择保留或删除 Worktree。

### SC-03：父 Agent 分派多个子任务

父 Agent 调用内置编排工具创建多个子 Agent。每个子 Agent拥有独立会话，默认使用独立 Worktree。用户可以在父会话中查看所有子任务的状态和摘要。

### SC-04：用户追问子 Agent

用户或父 Agent读取子 Agent 输出，并发送补充要求。子 Agent继续在原会话和原 Worktree 中工作。

### SC-05：海外模型走代理，中国模型直连

用户为 OpenAI Provider 选择代理配置，为 DeepSeek 等 Provider 选择直连。切换模型后，新请求自动使用对应路由，不影响其他软件的系统代理。

### SC-06：GUI 与 CLI 共享会话

用户在 CLI 或另一个客户端打开同一会话时，桌面端检测到活跃写入租约，以只读方式打开并提示冲突，不允许静默并发写入。

### SC-07：异常退出后恢复

应用或 Worker 异常退出。再次启动时系统识别未完成任务、过期租约和孤立 Worktree，恢复可恢复状态并明确提示不可恢复部分。

### SC-08：把有效对话沉淀为 Agent 案例

用户完成一次有价值的 Agent 工作后，把当前会话保存为案例，补充名称、说明和标签，经过复测后标记为已验证，并可随时返回原会话继续改进。

## 6. 功能范围

### 6.1 P0：必须进入 v0.1

#### FR-LEASE：会话租约

- FR-LEASE-01：为正在写入的 Pi JSONL 会话创建单写入租约。
- FR-LEASE-02：租约包含实例 ID、PID、主机、会话路径、创建时间和刷新时间。
- FR-LEASE-03：活跃外部租约阻止桌面端绑定写入。
- FR-LEASE-04：过期或持有进程不存在的租约可以安全接管。
- FR-LEASE-05：租约冲突时允许只读查看。
- FR-LEASE-06：强制接管必须由用户明确确认并写入审计事件。
- FR-LEASE-07：正常关闭和切换会话时释放租约。

#### FR-WT：Git Worktree

- FR-WT-01：Git 项目新建任务时可选择 Local 或 Worktree。
- FR-WT-02：Worktree 名称和分支名默认自动生成，并允许用户修改。
- FR-WT-03：Worktree 存放在应用管理的固定根目录。
- FR-WT-04：每个 Worktree 作为独立 Workspace 和 Worker cwd。
- FR-WT-05：删除 Worktree 前检测未提交、未跟踪和未合并内容。
- FR-WT-06：系统不得默认强制删除脏 Worktree。
- FR-WT-07：启动时扫描孤立 Worktree，并提供恢复或清理建议。
- FR-WT-08：非 Git 目录不显示 Worktree 选项。

#### FR-ORC：多 Agent 编排

- FR-ORC-01：父 Agent 可以创建子 Agent。
- FR-ORC-02：创建请求必须包含明确任务说明。
- FR-ORC-03：子 Agent 有独立 Worker、会话和状态。
- FR-ORC-04：子 Agent 默认使用独立 Worktree；用户可显式选择 Local。
- FR-ORC-05：父 Agent 和用户可以列出子 Agent。
- FR-ORC-06：父 Agent 和用户可以读取子 Agent 的摘要、最近输出和系统采集的执行证据。
- FR-ORC-07：父 Agent 和用户可以向子 Agent 发送后续消息。
- FR-ORC-08：可以停止单个子 Agent。
- FR-ORC-09：子 Agent 状态至少包括 queued、running、waiting、complete、failed、cancelled。
- FR-ORC-10：父子关系和关键状态持久化，重启后可恢复查看。
- FR-ORC-11：达到并发上限时任务进入队列，不静默失败。
- FR-ORC-12：子 Agent 失败不得导致父 Agent 或其他 Worker 退出。

#### FR-PROXY：Provider 路由

- FR-PROXY-01：每个 Provider 可配置 `direct`、`system`、`profile` 三种路由模式。
- FR-PROXY-02：代理配置至少包含 HTTP、HTTPS、SOCKS URL 和 `NO_PROXY`。
- FR-PROXY-03：代理只注入对应 Worker/请求，不修改全局系统代理。
- FR-PROXY-04：切换模型后，下一次请求使用目标 Provider 的路由。
- FR-PROXY-05：设置页提供不发送模型请求的连通性检测。
- FR-PROXY-06：日志不得记录代理密码、API Key、OAuth Token。
- FR-PROXY-07：中国 Provider 默认不强制经过海外代理。

#### FR-CORE：保留的 pi-app 能力

- FR-CORE-01：中英文即时切换和语言持久化。
- FR-CORE-02：流式时间线、Markdown、代码块和工具卡片。
- FR-CORE-03：文件附件、图片粘贴和拖放。
- FR-CORE-04：文件树、多标签预览、Diff 和 Review。
- FR-CORE-05：会话树、Fork、Clone 和 Rewind。
- FR-CORE-06：Skills、扩展和 Adapter 管理。
- FR-CORE-07：国内外自定义模型 Provider。
- FR-CORE-08：系统通知和后台会话运行。

#### FR-TERM：第一阶段内嵌终端

- FR-TERM-01：提供真实 PTY 终端、多标签和可调整尺寸的完整交互。
- FR-TERM-02：终端 cwd 只能是当前可信 Workspace 或 Worktree。
- FR-TERM-03：切换 Workspace、窗口重载、进程退出和用户关闭标签时回收 PTY。
- FR-TERM-04：终端输出采用有界回放和批量 IPC，不得拖垮 Agent Worker 或主进程。
- FR-TERM-05：Windows、macOS、Linux 按各自平台选择可用 Shell；首发正式验收仍为 macOS arm64。

#### FR-AUTH：第一阶段 GUI Provider 登录

- FR-AUTH-01：设置页展示支持的 Provider、认证方式、配置状态和当前登录路由。
- FR-AUTH-02：支持 OAuth/API Key 交互、浏览器授权、设备码/输入提示、取消和退出登录。
- FR-AUTH-03：仅目标 Provider 的登录请求进入它自己的 direct/system/profile 路由，不改变系统或其他软件代理。
- FR-AUTH-04：超时、回调失败、地区限制和浏览器打开失败显示错误类别、当前路由和下一步。
- FR-AUTH-05：凭据写入继续由 Pi AuthStorage 管理；Renderer、日志和产品 SQLite 不保存明文。
- FR-AUTH-06：认证变更后安全刷新空闲 Worker；正在运行的回合不得被中断，失败恢复不得丢失原会话绑定。

#### FR-CASE：Agent Case 第一闭环

- FR-CASE-01：当前有效会话可以保存为 Agent 案例。
- FR-CASE-02：案例包含名称、说明、标签、验证状态、原工作区、原会话、模型和思考等级。
- FR-CASE-03：案例可以重新打开原会话继续工作。
- FR-CASE-04：案例状态至少包含待验证、已验证和已归档。
- FR-CASE-05：案例元数据进入现有 SQLite 迁移、备份和审计体系。
- FR-CASE-06：案例不得复制完整对话正文或保存 API Key、OAuth Token、Cookie 和代理密码。

### 6.2 P1：v0.1 完成后优先

- FR-CASE-EVAL：为一个 Agent 建立固定任务、人工验收标准和多次真实复测记录；每次记录
  冻结 Agent 快照版本，并从 Pi 会话采集实际输入、正文输出、耗时、Token、工具与失败。
- FR-AGENT-VERSION-01：Agent 有效配置变化时自动形成不可变版本；无实际变化不得增加版本号。
- FR-AGENT-VERSION-02：可比较历史版本的 System Prompt、模型、思考度、工具、Pi 资源和能力要求。
- FR-AGENT-VERSION-03：评测集必须固定绑定具体版本，历史版本可以直接启动真实 Pi 会话。
- FR-AGENT-VERSION-04：只有全部固定任务原始输入一致且人工通过的版本才能标记为已验证。
- FR-AGENT-VERSION-05：Pi Package Studio 只能交付已验证版本，并在交付物中保存版本身份。
- FR-AGENT-VERSION-06：可以把一套固定任务、验收标准、标签和顺序原样复制到另一个
  不可变 Agent Version；不得复制历史运行结果。
- FR-AGENT-VERSION-07：版本效果对比必须按固定任务配对，并只采用每个任务最新的真实
  运行；质量变化以人工结论和输入是否漂移为准，耗时、Token、成本和工具失败仅作辅助。
- FR-AGENT-VERSION-08：存在缺失运行、待复核、输入漂移或任务不一致时，不得自动宣称
  新版本改进；同时存在进步和退化任务时必须明确标记为混合结果。
- FR-EVD：在 P0 基础证据之上，增加评审结论、人工验收和证据管理界面。
- FR-AUDIT：在 P0 基础审计事件之上，增加筛选、查看和 JSONL/JSON 导出。
- FR-UPDATE：公司自有更新源、下载、校验和回滚。

### 6.3 P2：后续版本

- `.vizagent` Agent Package 的导出、校验和导入。
- 独立客户 Runtime；具体采用 Desktop、Web 或 Docker 由首批付费场景决定。
- 远程 Agent 节点。
- 企业策略中心。
- 团队模板和工作流市场。
- 服务端审计汇总。
- 成本预算和配额。
- Web 管理控制台。

## 7. 用户体验要求

### 7.1 新建任务

新建任务界面至少包含：

- 项目
- 执行环境：Local / Worktree
- Provider
- 模型
- 思考等级
- 首条任务
- 高级选项：代理配置、并发策略

### 7.2 多 Agent 状态

父会话中必须能看到：

- 子任务名称
- 当前状态
- 所在 Worktree/分支
- 使用模型
- 已运行时间
- 最近摘要
- 是否需要用户输入
- 打开子会话、停止、追问操作

### 7.3 错误表达

错误必须告诉用户：

1. 发生了什么。
2. 是否影响会话或文件。
3. 系统已经做了什么。
4. 用户下一步可以做什么。

不得只显示堆栈或 `Unknown error`。

## 8. 非功能要求

### NFR-01：稳定性

- 单个 Worker崩溃不导致主窗口退出。
- Worker异常退出后 2 秒内更新状态。
- 已落盘 JSONL 不因 UI 崩溃损坏。
- 脏 Worktree 不得被自动强删。

### NFR-02：性能

- 参考设备上冷启动 P95 不超过 5 秒。
- 普通会话切换 P95 不超过 1 秒，历史分页可异步加载。
- Composer 输入到渲染响应 P95 不超过 100 毫秒。
- Worker 事件到可见 UI P95 不超过 500 毫秒。
- 4 个并行 Agent运行时主界面保持可交互。

### NFR-03：安全

- Renderer 保持 `sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`。
- Renderer 不直接访问文件系统、进程或密钥。
- 新增 IPC 必须使用白名单、类型化契约和运行时校验。
- 密钥使用 Electron `safeStorage` 或只保存在 Pi 已有认证存储。
- 外部链接、Markdown 和工具输出按不可信输入处理。
- Worktree 操作必须限定在已解析的受管根目录。

### NFR-04：兼容

- 保持与 Pi CLI 的 JSONL 会话兼容。
- 不修改 Pi 上游会话 Schema。
- 支持中英文路径、空格路径和非 ASCII 用户目录。
- v0.1 支持 macOS Apple Silicon。

### NFR-05：可维护

- 不引入第二套全局状态容器。
- Worktree、Orchestration、Terminal、Provider Route 各自拥有独立模块和测试。
- Pi SDK 固定精确版本，通过兼容测试后升级。
- 新功能必须包含中英文词条。

## 9. 产品指标

内部 Alpha 阶段主要看可靠性，而不是 DAU：

| 指标 | 目标 |
|---|---:|
| 单 Agent 核心流程成功率 | ≥ 98% |
| Worktree 创建成功率 | ≥ 99% |
| 4 Agent 并发任务启动成功率 | ≥ 95% |
| 会话并发写入导致的数据损坏 | 0 |
| 脏 Worktree 被自动删除 | 0 |
| 中文核心流程覆盖率 | ≥ 95% |
| 崩溃后可识别未完成任务比例 | 100% |
| P0 自动化验收通过率 | 100% |

## 10. 发布假设

- v0.1 为公司内部 Alpha，不直接公开销售。
- 首个平台为 macOS Apple Silicon。
- 默认最大 Worker 数为 4，可配置但有安全上限。
- 子 Agent 默认创建 Worktree。
- 第一阶段必须包含集成终端和 GUI OAuth；真实 Provider 授权由外部测试凭据完成最终验收。
- 产品数据目录使用新命名，避免覆盖原 pi-app 配置。

以上假设需在 M0 开始前确认。

## 11. 依赖与约束

- `pi-app` 已通过上游 MIT `LICENSE`、提交 `0ae02be2e5e09586aa89c35358f1aab952705e6c`
  和作者在 Issue #38 的确认明确商业使用与再分发边界；分发时必须保留版权和许可声明。
- `pi-gui` 仓库包含 MIT LICENSE；如复制代码，仍需保留许可证和版权声明。
- Pi SDK 快速更新，必须固定版本。
- macOS 分发需要 Developer ID 和 notarization。
- 国内外 Provider 的网络可用性不由客户端完全控制。
- Pi CLI 暂不了解桌面端租约，因此租约只能先保护本产品实例之间的并发写入，并对外部改动做检测。

## 12. v0.1 发布定义

只有同时满足以下条件才可标记 v0.1：

1. P0 功能全部验收。
2. 关键数据迁移可回滚。
3. 所有 CI 门禁为绿色。
4. macOS 安装包完成签名、notarization 和下载路径冒烟测试。
5. 不存在未处理的 Critical/High 安全问题。
6. 至少完成 7 天内部试运行。
7. 完成一次真实异常恢复演练。
8. 完成开源许可和第三方依赖清单。

## 13. 已决策记录

| ID | 问题 | v0.1 决策 | 状态 |
|---|---|---|---|
| Q-01 | 正式产品名称 | Vizruna | 已决 |
| Q-02 | 首版客户范围 | 公司内部 Alpha；正式外部分发另过发布门禁 | 已决 |
| Q-03 | 默认最大 Worker 数 | 4，安全硬上限 16 | 已决 |
| Q-04 | 强制接管会话是否开放 | 仅在真实租约冲突的高风险弹窗中开放，并要求明确确认 | 已决 |
| Q-05 | 子 Agent 是否必须使用 Worktree | 默认是，可显式 Local | 已决 |
| Q-06 | 首版是否包含终端 | 第一阶段必须包含完整内嵌终端 | 已更新 |
| Q-09 | 首版是否包含 GUI OAuth | 第一阶段必须包含；真实 Provider 授权保留外部门禁 | 已决 |
| Q-10 | Pi SDK 版本策略 | 内嵌当前已测 0.84.1；外部版本限 0.84.x，并满足模型、会话、Settings 与 Package 能力门禁 | 已决 |
| Q-07 | 审计导出格式 | JSONL + JSON | 已决 |
| Q-08 | Windows 进入哪个版本 | v0.2，v0.1 不发布 Windows | 已决 |
