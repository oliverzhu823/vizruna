# M3 多 Agent 编排 MVP 验收报告

| 项目 | 内容 |
| --- | --- |
| 文档编号 | M3-REPORT-001 |
| 日期 | 2026-07-25 |
| 对应范围 | FR-ORC-01–12、AC-M3-01–08 |
| 结论 | Internal engineering gate passed |
| 下一阶段 | M4 Stability, Audit and Diagnostics |

## 1. 结论

M3 已形成真实的父子 Agent 控制面，而不是任务树外观模拟：父 Agent 通过 Pi `customTools` 请求 Main 编排服务；Main 创建独立 Utility Worker、Pi Session 和默认受管 Git Worktree；关系、状态和证据写入 SQLite；Renderer 只投影实时状态。

系统已经支持创建、列出、读取、发送消息、停止和有界等待六项父 Agent 操作，也向用户提供同一套受信 IPC 能力。并发达到上限后进入明确队列；父任务取消会传播到所有后代；Worker 崩溃、应用重启和超时都结束于可解释状态，不会被误报为成功。

本阶段的自动化闭环使用真实临时 Git 仓库和两个真实受管 Worktree，并在各自目录完成代码写入和测试命令；Agent Runtime 使用确定性测试替身，避免把外部模型自然语言输出当作验收事实。真实外部 Provider 的双 Agent 调用仍需在 M5 Provider 路由完成后复测，因此本结论只表示内部工程门禁通过，不表示已可商业分发。

## 2. 架构与数据边界

### 2.1 控制路径

```text
Parent Pi Agent
  -> custom orchestration tool
  -> Worker-to-Main RPC (rpcId)
  -> Orchestration Service
  -> Worker Manager / Session Lease / Managed Worktree
  -> child Pi Agent Session
  -> sequenced AppEvent + system evidence
  -> SQLite + Agents UI
```

- Worker 只声明工具和转发请求，不持有父子关系主数据。
- Main 从实际 Worker Slot 派生父会话、Worker Key 和 `cwd`，不信任模型传入身份。
- Renderer 的读写 IPC 只能访问当前受信 Git 仓库对应的关系。
- 子会话继续使用 Pi JSONL；父子关系和证据不写入 Pi JSONL。
- 每个子会话继续受 M1 单写租约保护。
- 默认隔离环境调用 M2 受管 Worktree Service；显式 `local` 才复用父 Agent 工作区。

### 2.2 持久化

新增 SQLite 表：

- `agent_relationship`：父/子会话、Worker、根仓库、执行工作区、Worktree、目标、状态、模型、超时、序号和恢复信息。
- `orchestration_evidence`：命令、退出码、文件变更、错误、验证状态、工作区和时间。

Pi JSONL 仍是会话正文、工具调用和会话树的事实来源；SQLite 不复制完整对话正文。

Renderer 新增独立 Orchestration Zustand Slice。关系投影、加载态和错误态均不进入 Local Storage；持久化白名单仍只包含工作区和布局偏好。

## 3. 状态机与调度

已实现状态：

`queued → starting → running → waiting/complete/failed/cancelled/interrupted/timed_out`

- 默认 Worker 上限为 4，安全硬上限为 16。
- 父 Worker 计入同一个进程池上限。
- 达到上限时保留任务、Worktree 和目标，状态回到 `queued`，不静默失败。
- 空闲后台 Worker 可以被安全释放以启动队列任务；运行中 Worker 不被逐出。
- 每个关系保存对外状态序号和最后 Worker 事件序号；重复或乱序事件被拒绝。
- Worker 重启或显式恢复时重置 Worker 事件代次，避免新进程从序号 1 开始后被旧序号永久屏蔽。
- 任务超时会中止当前轮次并进入 `timed_out`；用户可继续、重试或取消。
- 应用启动时，遗留的 `starting/running/waiting/timed_out` 统一标记为 `interrupted`，必须显式恢复。
- 父会话取消会并行通知所有运行中后代，并取消未启动任务；Session 和 Worktree 保留供检查。

最大递归深度为 3。关系只能从已有父会话向下创建，不允许修改父关系形成环。

## 4. 父 Agent 工具

Pi Session 新增六个稳定工具：

1. `create_child_agent`
2. `list_child_agents`
3. `read_child_agent`
4. `send_message_to_child_agent`
5. `stop_child_agent`
6. `wait_for_child_agents`

所有参数使用 TypeBox Schema，Main 再使用 Zod Schema 二次验证。等待最长 60 秒，单次目标文本最长 20,000 字符，超时配置有上下界。工具返回结构化 JSON，不要求父 Agent读取子会话全文。

## 5. 证据真实性

系统从实际 Worker `AppEvent` 采集：

- Bash 命令开始和结束。
- 退出码、输出摘要、工作目录和时间。
- Edit、Write、Git 等文件变更。
- Assistant 最后摘要和输出。
- Runtime 错误、阻塞和等待输入。

只有被识别为测试、lint、typecheck、verify 或 build 的命令，且退出码为 0，才能把 `verificationStatus` 设为 `passed`。普通命令成功仍为 `unverified`；没有测试证据时不会因子 Agent 自述“已通过”而升级。

`Agents` 右侧面板显示层级、状态、耗时、模型、隔离方式、实际工作区、摘要、错误和验证状态，并允许打开子会话、追问、停止、继续和重试。生产 Electron 冒烟测试在首次实现中发现并修复了 Zustand selector 生成不稳定数组导致的 React 最大更新深度错误。

## 6. 验收证据

| 验收项 | 自动化/实现证据 | 结果 |
| --- | --- | --- |
| AC-M3-01 父子闭环 | 两个子任务创建两个真实 Git Worktree；各自写入模块、执行命令、记录文件与测试证据并完成 | Pass（确定性 Runtime）；真实外部 Provider 复测转 M5 |
| AC-M3-02 并发限制 | 同时创建 6 个任务，确定性容量为 4；4 个 `running`、2 个 `queued` | Pass |
| AC-M3-03 失败隔离 | 注入 Prompt 失败和 Worker `exit(9)`；目标任务分别 `failed/interrupted`，另一个任务保持 `running` | Pass |
| AC-M3-04 取消传播 | 创建父子两层任务；取消顶层父会话，直接子任务和孙任务均为 `cancelled`，并收到停止信号 | Pass |
| AC-M3-05 超时 | 10ms 故障注入后进入 `timed_out`，不残留 `running`；重试恢复为 `running` | Pass |
| AC-M3-06 重启恢复 | 预置 `running` 持久化关系后初始化服务；状态改为 `interrupted`，保留会话和工作区 | Pass |
| AC-M3-07 事件一致性 | 先处理序号 30 再处理 29；旧摘要被拒绝；显式恢复后新 Worker 从序号 1 正常接收 | Pass |
| AC-M3-08 证据真实性 | Bash start/end 跨事件关联；`npm test` 退出 0 才通过；普通命令和无测试保持 `unverified` | Pass |
| 工具契约 | 六项 ToolDefinition、Worker→Main `rpcId`、120s 传输上限、Main Zod 二次验证 | Pass |
| IPC 权限 | 当前受信仓库归属检查；UUID/长度/枚举 Schema；Preload allowlist 与 Main 注册同步 | Pass |
| UI 状态边界 | 旧/重复关系序号不覆盖新状态；编排关系和加载态不进入 Zustand 持久化 | Pass |
| 生产 Electron | `Agents` Tab 可见并成功加载懒路由；完整桌面冒烟 13/13 | Pass |

主要测试文件：

- `src/main/orchestration/orchestration-service.test.ts`
- `src/main/orchestration/orchestration-worktree.integration.test.ts`
- `src/renderer/src/stores/ui-store-orchestration-slice.test.ts`
- `scripts/tests/orchestration-contract.test.mjs`
- `src/main/__tests__/worker-manager-pool.test.ts`
- `e2e/smoke.spec.ts`

完整验证结果：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | Pass，零错误 |
| `npm run lint` | Pass，零错误 |
| `npm run test:scripts` | Pass，255 项 |
| `npm run test:unit` | Pass，66 文件、250 项 |
| `npm run build` | Pass，Main/Preload/Renderer 生产构建成功 |
| `npm run sbom` | Pass，334 个生产组件 |
| `npm run test:e2e` | Pass，13/13 |
| `npm audit --omit=dev --audit-level=high` | Pass，0 vulnerabilities |

## 7. 依赖与兼容性

`@earendil-works/pi-ai@0.80.7` 从传递依赖提升为直接固定依赖，只用于定义 Pi 自定义工具的 TypeBox 参数 Schema；版本与固定的 `@earendil-works/pi-coding-agent@0.80.7` 一致。依赖已进入 lockfile、生产 SBOM 和漏洞审计。

Worker 仍可加载产品选择的 Pi SDK 路径；当前 M3 ToolDefinition 合同以固定 0.80.7 为支持基线。未来 SDK 升级必须通过自定义工具注册、事件映射和 Worker Bundle 契约测试。

## 8. 剩余风险

- 自动化闭环使用真实 Git 和真实命令，但没有消耗真实外部模型额度；OpenAI 类和中国 Provider 的双 Agent 实际调用需在 M5 独立路由完成后验证。
- 子 Agent 触发非前台扩展交互时会进入 `waiting` 并保留请求摘要；复杂结构化问卷的后台回答体验需要在 M4 统一失败/恢复模型中继续完善。
- 默认并发和硬上限已限制 Worker 数，但 8 小时稳定性、100 个连续子任务、CPU/内存和文件句柄趋势属于 M4 长时间门禁。
- 关系和证据已进入 SQLite，但备份、损坏恢复、诊断包和 JSON/JSONL 审计导出属于 M4。
- Worktree 不会随任务取消或失败自动删除；这是数据保护策略，用户需在确认 Git 安全状态后从 Worktrees 面板回收。
- pi-app 许可证确认已于 2026-07-30 完成；正式客户版继续受 Apple 签名、公证和真实试点验收门禁约束。

## 9. Go/No-Go

- M3 内部工程门禁：Go。
- GATE-2 开始 M4 稳定性、审计和诊断：Go。
- 面向客户商业发布：No-Go；真实 Provider 独立路由、8 小时稳定性、诊断脱敏、数据库恢复、签名、公证和干净设备仍未完成。
