# Vizruna 待开发能力清单

| 项目 | 内容 |
| --- | --- |
| 文档编号 | ROADMAP-003 |
| 版本 | 1.0 |
| 日期 | 2026-08-25 |
| 状态 | Active backlog；K0–K6 基础链路已实现，尚未发布 |
| 产品阶段 | Agent Studio → Agent 工厂 → 独立 Runtime 交付 |

## 1. 目的和使用规则

本文档记录 Vizruna 未来值得开发、需要延后，以及当前不值得投入的能力，作为版本规划和
需求评审的统一待办清单。

优先级含义：

- **P0：近期基础能力。** 直接影响安装、运行安全或长期 Runtime 边界，应优先进入版本路线。
- **P1：下一阶段高价值能力。** 对企业 Agent、批量运行或交付有明确价值，依赖 P0 基础。
- **P2：由真实案例触发。** 有价值，但开发和安全成本较高，不应在需求尚未验证时提前建设。
- **P3：当前不开发。** 不是永久拒绝，而是当前投入产出比低；只有满足触发条件后再重新评估。

执行原则：

1. 不因底层重构暂停当前可用的 Vizruna-web。
2. 不更换 Vizruna 的 Agent Studio / Agent Factory 产品底座。
3. 新能力优先复用 Pi Packages、Skills、Extensions、Prompt Templates 和 Agent Runtime。
4. UI、CLI 和未来客户系统应逐步共用同一个 Runtime，而不是分别维护业务逻辑。
5. 每项进入开发前必须补充验收标准、安全边界、迁移方案和失败回退方案。

## 2. Runtime、RPC 和 CLI 的关系

```text
浏览器界面 ─┐
命令行工具 ─┼→ Vizruna Runtime → Pi Agent → 模型与工具
客户系统 ───┘
```

- **Headless Runtime** 是没有图形界面的 Agent 发动机，负责会话、模型、Agent 配置、工具、
  权限和运行证据。
- **稳定 RPC** 是界面或外部系统调用 Runtime 的兼容接口，相当于标准插座。
- **CLI** 是通过稳定接口控制 Runtime 的命令行客户端，相当于遥控器。

CLI 本身不等于 Runtime，也不会自动替换 Pi 底座。K0–K6 已先完成纯 Node Runtime、
RPC v1、权限、证据、评测和 CLI；现有 Web 保留兼容宿主，下一步通过 Renderer RPC
Adapter 渐进迁移 Agent 执行，不影响 OAuth、终端和文件等平台能力。

### 2.1 2026-08-31 实施状态

- P0-1 至 P0-5 的工程主体已经完成，真实 Provider 与完整 GUI 回归仍是发布门禁。
- P1-1 Vizruna CLI 和 P1-3 Run Evidence Bundle 已提前完成第一版。
- P1-2 企业文档 Package、P1-4 附件资产管理及 P2/P3 项目仍保持待开发。
- 详细接口、安全边界和命令见 `25-Headless-Runtime-RPC-CLI.md`。

## 3. P0：近期基础能力

### P0-1 一键安装与启动 Vizruna-web

**状态：工程完成，等待 npm 包名/许可证/发布授权。**

**目标**

- 提供 `npx --yes vizruna@latest` 一条命令启动方式。
- 自动检查 Node、依赖、端口和本地运行条件。
- 将安装失败、网络失败和 Runtime 启动失败转换为可理解的中英文诊断。
- 保留现有 Git 和 Release ZIP 方式作为回退。

**价值**：直接降低朋友、测试用户和早期客户的安装成本。

### P0-2 整理 Runtime 边界

**目标**

- 明确 Renderer、平台适配层和 Agent Runtime 的职责。
- 将会话、模型、Agent 配置、评测运行、Worker 和运行证据逻辑从 Electron 窗口 API 中隔离。
- 先允许 Electron 继续承载无窗口后台，避免一次性重写。
- 为未来纯 Node/Bun Headless Runtime 建立兼容边界。

**价值**：避免 Web、CLI 和客户交付分别复制一套业务逻辑。

### P0-3 最小稳定 RPC

**第一阶段正式接口**

- 查询 Agent 与不可变 Agent Version。
- 创建运行、发送任务、停止运行和查询状态。
- 订阅思考、工具、输出、错误和完成事件。
- 获取结果、产物和脱敏运行证据。
- 处理工具授权、OAuth 等需要用户参与的交互。
- 提供 Runtime 版本和能力协商。

**约束**：不直接公开全部内部 IPC；内部实现可以变化，正式接口保持兼容。

### P0-4 Agent 运行权限策略

**目标策略**

- **观察模式**：读取自由；写入、命令和外部操作需要确认。
- **协作模式**：可信项目内普通操作允许；危险操作需要确认。
- **自动模式**：允许 Agent 在明确边界内自主执行。

**证据要求**：记录工具、策略、授权决定、决定时间、决定者和作用范围，并绑定具体运行。

### P0-5 Runtime 契约与兼容测试

**必须覆盖**

- Pi Runtime 升级后的模型、OAuth、会话和工具兼容性。
- Agent 配置、Skills、Extensions、Packages 和 Prompt 的实际加载。
- Web 与未来 CLI 对同一 Runtime 的行为一致性。
- RPC 版本协商、旧接口兼容、断线恢复和取消语义。
- 权限决定、运行证据和凭据脱敏。

## 4. P1：下一阶段高价值能力

### P1-1 Vizruna CLI（第一版已实现）

第一版只提供：

```text
vizruna start
vizruna agent list
vizruna run
vizruna stop
vizruna status
vizruna evidence export
vizruna evaluation run
```

CLI 只调用稳定 Runtime API，不复制 Agent 业务逻辑。

### P1-2 企业文档 Pi Package

作为可选官方 Package，而不是核心安装依赖，逐步支持：

- PDF 文本、选页和表格提取。
- DOCX 段落和表格处理。
- XLSX Sheet、范围和结构化数据处理。
- PPTX 幻灯片内容提取。
- 图片信息与可选 OCR。
- 文档转 Markdown 和结构化 Diff。

### P1-3 Run Evidence Bundle（第一版已实现）

导出一次运行的脱敏证据包，包含 Agent Version、模型、Runtime、资源清单、输入输出摘要、
工具调用、Token、耗时、费用、产物、错误和人工结论。

禁止包含 API Key、OAuth Token、代理密码、本机敏感路径、未经授权的完整 System Prompt
和隐藏思考内容。

### P1-4 附件资产管理

- 附件持久化、来源、类型、大小和内容指纹。
- 与会话、案例、评测任务和 Agent Version 的关系。
- 删除、保留、迁移和脱敏导出策略。
- 复测时识别输入文件是否发生变化。

## 5. P2：由真实案例触发

### P2-1 受管浏览器 Runtime Adapter

让 Agent 可以打开、点击、输入、截图和下载，同时让用户看到操作过程，并将浏览器操作接入
权限、会话隔离、账号隔离和 Run Evidence。它适合网页操作类 Agent，但安全和实现成本高。

### P2-2 Plan 审批模式

Agent 先提交计划，用户接受、修改或拒绝后再执行。作为 Agent 配置中的可选运行政策，
不作为所有会话默认流程。

### P2-3 回答正文批注与 Follow-up

允许选中 Agent 回答的某段内容添加备注、发起追问或形成评测证据。优先与 Evaluation Studio
复用，不单独建立第二套审核状态。

### P2-4 便携会话包

支持完整会话和附件的脱敏导入、导出和跨电脑迁移。在 Run Evidence Bundle 验证不足以满足
需求后再建设，避免与案例库和证据包重复。

### P2-5 会话管理增强

增加搜索、归档、收藏、未读、标签，以及按 Agent、模型、状态和日期筛选。属于效率能力，
不阻塞 Agent 核心路线。

## 6. P3：当前不开发的备选能力

| 能力 | 当前不开发的原因 | 重新评估触发条件 |
| --- | --- | --- |
| Desktop 多窗口 | 当前唯一维护形态是 Local Web；会重新引入签名、窗口和跨平台复杂度 | 大量用户明确需要多个独立桌面窗口 |
| 完整复制 MkAgent/Craft UI | 会把 Vizruna 变成大型通用工作台，削弱 Pi-native Agent Harness 定位 | 仅针对经用户验证的单项交互重新评估 |
| 公网远程访问本机 Runtime | 身份、TLS、权限和数据泄漏风险高 | 有明确企业部署需求和完整安全投入 |
| 云账号与云同步 | 增加服务器、隐私、合规和运营成本 | 本地优先已验证且团队协作成为高频刚需 |
| 默认 Sentry/强制遥测 | 与本地隐私定位冲突 | 用户明确授权并完成隐私、合规设计 |
| 微信、WhatsApp、Slack、Teams、飞书渠道 | 产品范围扩张，且未来可通过 Runtime API 外接 | 某个渠道出现明确付费客户需求 |
| 通用可视化自动化平台 | 容易演变成 n8n/Zapier 类产品，与核心路线偏离 | Agent Runtime 与 CLI 稳定后仍存在高频需求 |
| 独立 Vizruna 插件市场 | Pi 已有 Packages、Skills、Extensions、Prompt 和 Themes | Pi 原生扩展机制不能满足已验证的 Vizruna 专属需求 |

## 7. 推荐实施顺序

```text
一键启动
  ↓
整理 Runtime 边界
  ↓
最小稳定 RPC
  ↓
权限策略与契约测试
  ↓
CLI
  ↓
企业文档 Package
  ↓
Run Evidence Bundle 与附件资产
  ↓
浏览器 Adapter（由案例触发）
  ↓
GUI Agent 执行迁移到 RPC v1
  ↓
客户系统调用和成熟 Agent Runtime 交付
```

## 8. 近期决策

独立纯 Node Runtime 已作为并行核心完成，不推倒现有 Web。现有 GUI 继续使用兼容宿主，
新增 CLI 和未来客户系统只调用 RPC v1。后续按功能迁移 Renderer；当模型、OAuth、终端、
文件、评测、编排和运行证据完成等价验证后，再删除 GUI 的旧 Agent 执行路径。
