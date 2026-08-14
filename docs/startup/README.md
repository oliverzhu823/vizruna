# Vizruna 开发启动包

文档状态：Approved for internal Alpha v0.1  
基线日期：2026-07-24  
当前工程状态日期：2026-08-03
v0.1 产品名称：Vizruna\
产品底座：`justhil/pi-app`  
能力参考：`minghinmatthewlam/pi-gui`

## 1. 已确定的核心决策

1. 以 `pi-app` 为唯一主产品底座。
2. 保留 `pi-app` 的 Main、Preload、Renderer、Utility Worker 和 Zustand 架构。
3. 不合并两个 Git 历史，不引入第二套应用状态模型。
4. 从 `pi-gui` 迁移业务行为和测试语义，不整体复制 AppStore。
5. Pi JSONL 会话文件继续作为对话事实来源。
6. 混合产品元数据单独存储，不修改 Pi 上游会话格式。
7. 每个活跃 Agent 继续运行在独立 Utility Worker 中。
8. 新增能力从第一天接入中英文语言包、类型化 IPC 和审计事件。
9. 当前唯一用户发布形态为 macOS 本机运行的 Vizruna-web；Windows 和 Linux 尚未承诺公开 Alpha 支持。
10. `pi-app` 的 MIT 商业使用与再分发权限已经确认；分发时必须随包保留版权和许可
    声明。桌面签名与公证路线暂停，恢复桌面分发时再重新启用对应门禁。
11. 产品负责人已确认第一阶段必须交付 GUI OAuth 和完整内嵌终端；两项已进入工程候选版，不再属于可选后续范围。
12. Pi 采用经过当前产品测试的内嵌版本 `0.84.1`；外部 SDK 必须位于已验证的
    `0.84.x` 兼容线，并通过模型、会话、Settings 与 Package 生命周期能力检查，否则
    自动回退内嵌版。

## 2. 文档目录

| 文档 | 解决的问题 | 当前状态 |
|---|---|---|
| [01-PRD-v0.1.md](./01-PRD-v0.1.md) | 做什么、为谁做、什么算完成 | Approved |
| [02-Architecture-RFC-001.md](./02-Architecture-RFC-001.md) | 进程、数据、IPC、状态和失败恢复如何设计 | Accepted |
| [03-Development-Roadmap.md](./03-Development-Roadmap.md) | 按什么顺序开发、投入多少、每阶段交付什么 | Approved |
| [04-Acceptance-Criteria.md](./04-Acceptance-Criteria.md) | 功能、质量、安全和发布如何验收 | Approved |
| [05-Risk-Register.md](./05-Risk-Register.md) | 已知风险、触发条件、缓解和负责人 | Active |
| [06-M0-Baseline-Report.md](./06-M0-Baseline-Report.md) | 正式开发基线、验证证据和开放门禁 | Internal gate passed |
| [07-M1-Session-Lease-Report.md](./07-M1-Session-Lease-Report.md) | 会话单写租约实现、测试证据和剩余风险 | Internal gate passed |
| [08-M2-Managed-Worktree-Report.md](./08-M2-Managed-Worktree-Report.md) | 受管 Worktree 生命周期、安全删除、恢复对账和测试证据 | Internal gate passed |
| [09-M3-Multi-Agent-Orchestration-Report.md](./09-M3-Multi-Agent-Orchestration-Report.md) | 父子 Agent 控制面、队列、取消、恢复、证据和任务树 | Internal gate passed |
| [10-M4-Stability-Audit-Diagnostics-Report.md](./10-M4-Stability-Audit-Diagnostics-Report.md) | 统一错误、审计、脱敏诊断、元数据恢复、对账和稳定性 | Internal gate passed |
| [11-M5-Productization-Report.md](./11-M5-Productization-Report.md) | Provider 独立路由、双语门禁、macOS 发布链路与开放门禁 | Conditional |
| [12-User-Guide.md](./12-User-Guide.md) | 安装、模型、V2RayN HTTP/SOCKS5 代理、Worktree、恢复与排障 | Ready for pilot |
| [13-macOS-Release-Runbook.md](./13-macOS-Release-Runbook.md) | 历史桌面签名、公证、装订和 Gatekeeper 方案 | Paused; reference only |
| [14-Pilot-Kit.md](./14-Pilot-Kit.md) | 3–5 人试点计划、反馈模板、验收和 Go/No-Go | Ready; execution pending |
| [15-v0.1-Completion-Audit.md](./15-v0.1-Completion-Audit.md) | P0/AC/NFR 逐项完成度、证据边界和外部解除条件 | Active release audit |
| [16-Release-Evidence-Gate.md](./16-Release-Evidence-Gate.md) | 正式签名、双 Provider、七天内测、试点与四方签署的本地证据硬门禁 | Ready; evidence pending |
| [17-Release-Readiness-Preflight.md](./17-Release-Readiness-Preflight.md) | 历史桌面正式发布基础设施预检 | Paused; reference only |
| [18-Phase-1-Chinese-GUI-Progress.md](./18-Phase-1-Chinese-GUI-Progress.md) | 第一阶段产品目标、已完成能力、验收结果和下一步 | Engineering candidate |
| [19-Studio-Factory-Runtime-Roadmap.md](./19-Studio-Factory-Runtime-Roadmap.md) | Agent Studio、Agent 工厂与独立 Runtime 的长期路线 | Active |
| [20-alpha3-Agent-Case-Progress.md](./20-alpha3-Agent-Case-Progress.md) | Agent 案例库与 Alpha 迭代进展 | Engineering candidate |
| [21-Vizruna-web-Implementation.md](./21-Vizruna-web-Implementation.md) | Local Web 架构、安全边界、实测证据和发布方式 | Release candidate |
| [22-Pi-Native-Harness-Roadmap.md](./22-Pi-Native-Harness-Roadmap.md) | Pi-native Harness 定位、Pi Inspector、资源中心和 Agent Composer 路线 | Active |

## 3. 研究基线

本文档包基于以下源码快照，不代表未来上游状态：

| 项目 | Commit | 用途 |
|---|---|---|
| `justhil/pi-app` | `bcef920e3900a858b305c67c42a34e61779f977c` | 主产品底座 |
| `minghinmatthewlam/pi-gui` | `48ed3025868ddb9fd359cd1fc19b7ac48916cb39` | Worktree、Orchestration、Terminal、Session Lease 行为参考 |
| `@earendil-works/pi-coding-agent` | `0.84.1` | 当前内嵌 Agent Runtime；外部版本限已验证的 0.84.x 兼容线 |

上游地址：

- <https://github.com/justhil/pi-app>
- <https://github.com/minghinmatthewlam/pi-gui>
- <https://github.com/earendil-works/pi>

## 4. 文档评审顺序

1. 先评审 PRD 的目标、范围和非目标。
2. 再评审 RFC 的架构边界和数据所有权。
3. 根据通过的 PRD/RFC 调整路线图。
4. 最后冻结验收标准和首个版本门禁。
5. 五项文档已通过评审；M0–M4 内部工程门禁已通过。
6. M5 桌面发布门禁已暂停；当前发布验收以 Vizruna-web 的干净安装、浏览器 E2E、真实模型调用和早期用户试用为准。

## 5. Vizruna-web 公开 Alpha 仍需登记的外部事项

PRD 评审已经冻结 v0.1 名称、内部 Alpha 范围、macOS arm64、默认并发 4、
受控强制接管、逐 Provider 路由、JSONL/JSON 审计导出，以及第一阶段必须包含
GUI OAuth 和完整内嵌终端。
扩大公开测试前仍需登记：

- 公司 GitHub 发布仓库及管理员。
- 工程、测试、产品、安全/法务四类签署人的姓名。
- 3–5 名内部或友好客户试点参与者及测试设备。
- 安全/法务对随包 `NOTICE`、MIT 正文、第三方依赖清单和 SBOM 的发布批次复核记录。

## 6. 变更控制

- PRD 功能范围变化：更新 PRD 和路线图。
- 进程、数据所有权、IPC、持久化变化：新增或修订 RFC。
- 已验收行为变化：同步修改验收标准。
- 高风险事项变化：更新风险登记表。
- 文档进入 `Approved` 后，任何影响里程碑的变化必须记录决策人、日期和原因。
