# M2 受管 Git Worktree 验收报告

| 项目 | 内容 |
| --- | --- |
| 文档编号 | M2-REPORT-001 |
| 日期 | 2026-07-25 |
| 对应范围 | FR-WT-01–08、AC-M2-01–06 |
| 结论 | Internal engineering gate passed |
| 下一阶段 | M3 Multi-Agent Orchestration MVP |

## 1. 结论

M2 已形成“能力检测、事务创建、实时安全检查、明确确认、回收、启动对账、管理界面”的闭环。受管 Worktree 只创建在产品专用根目录，Git 命令通过参数数组执行而不经过 Shell；SQLite 记录与 Git 结果相互验证，无法持久化元数据时不会继续伪装创建成功。

本阶段允许用户把受管 Worktree 打开为真实 Workspace，后续 Worker 会以该路径作为 `cwd`。父子 Agent 与 Worktree 的自动绑定属于 M3，不在 M2 中用静态 UI 模拟。

本结论只表示内部工程门禁通过，不单独解除签名、公证和客户发布门禁。M0 中记录的
pi-app 许可证问题已于 2026-07-30 由上游 MIT LICENSE 和作者确认解除。

## 2. 实现边界

### 2.1 数据与目录

- 元数据表：`managed_worktree`。
- 受管根目录：`~/.vizruna/worktrees`。
- 仓库目录：`<repo-slug>-<root-hash>`，避免同名仓库碰撞。
- Worktree 目录：`<task-slug>-<id8>`。
- 分支：默认 `pi-agent/<task-slug>-<id8>`，也可由用户提供尚不存在的合法分支名。
- 主会话 JSONL 未修改；Worktree 元数据只进入产品 SQLite。
- Renderer 只保存界面布局，不持久化 Worktree 列表、能力检测、加载态或错误态；每次以 Main、SQLite 和 Git 重新对账。

### 2.2 状态机

已实现：

`creating → ready/dirty/missing/error → removing → removed`

- 创建前先登记 `creating`。
- 自定义分支先通过 `git check-ref-format --branch` 并确认本地分支不存在；检查失败发生在元数据和 Git 创建之前。
- Git 创建后必须重新读取 `git worktree list --porcelain` 验证路径和分支。
- 持久化 `ready` 失败时回滚 Git Worktree、目录和本事务实际创建的新分支，并保留 `error`；绝不删除预先存在的用户分支。
- 启动和界面刷新时对照 Git、磁盘与 SQLite，把虚假的 `ready` 改为 `dirty` 或 `missing`。
- 外部工具在受管根内创建但未登记的 Worktree 只报告为 `unregistered`，不静默接管、不自动删除。
- 状态变化和创建、阻止、删除、强制删除均进入审计事件。

### 2.3 删除安全等级

删除前实时检查：

- 工作树目录是否存在。
- Git 是否仍登记该 Worktree。
- 未提交和未跟踪文件。
- 相对基线的未合并提交。
- 相对 upstream 的未推送提交；没有 upstream 时以相对基线的新增提交作为保守判断。
- 当前界面或任一前后台 Worker 是否仍使用目标路径。

处理分为三层：

1. 安全删除：检查无阻断项，使用普通 `git worktree remove`；删除分支是独立选项。
2. 风险删除：脏、未合并、未推送、缺失或登记异常时默认阻止；只有风险复选框明确确认后才允许强制删除。
3. 禁止删除：当前 Workspace 或后台 Worker 仍使用目标时，即使勾选强制确认也不能删除，必须先切换并停止任务。

界面在执行前显示等价 Git 操作预览。实际执行使用 `execFile('git', args)`，不把预览字符串交给 Shell。

## 3. 安全边界

- Renderer 只能调用 allowlist 中的 6 个 Worktree IPC。
- 创建、查询、删除只能作用于当前受信 Workspace 所属的主 Git 仓库。
- ID 使用 UUID Schema；名称、基线引用和路径参数均有边界校验。
- 强制删除 Schema 要求 `force: true` 与字面量 `confirmed: true` 同时存在。
- 所有删除先验证目标规范路径和真实路径仍位于受管根目录。
- 恶意 SQLite 记录即使指向受管根外，也不能触发文件删除。
- 当前/后台仍在使用的 Worktree 不允许删除，避免 Worker 继续向被移除目录写入。
- Git 子进程有超时和输出上限；不使用 `shell: true`。
- SQLite 写入后立即回读验证；数据库不可用时创建失败，不产生“Git 已创建但产品显示成功”的状态。

## 4. 用户界面与双语

右侧新增 `Worktrees` 核心面板，默认可见，提供：

- 仓库当前分支、受管 Worktree 列表、状态、路径和关联会话。
- 创建任务名称；Worktree 名称和分支可留空自动生成，也可分别修改。
- 打开 Worktree 为 Workspace、在文件管理器中显示位置。
- 刷新与手动对账。
- 安全/强制/禁止三类删除对话框、风险原因、改动文件和命令预览。
- 未登记 Worktree 的告警和定位入口。
- 非 Git、裸仓库和未初始化仓库的诚实降级说明。

新增中文和英文 `worktrees` 资源。非 Git 目录不会伪装已经隔离；用户仍可留在现有 Local Workspace，或使用产品原有的临时 Local Sandbox 路径。

## 5. 验收证据

| 验收项 | 自动化/实现证据 | 结果 |
| --- | --- | --- |
| AC-M2-01 创建成功 | 真实临时 Git 仓库创建；验证分支、目录、文件、Git Porcelain、记录和审计一致 | Pass |
| FR-WT-02 自定义命名 | 自定义 Worktree 名与分支分别传递；非法分支和已有分支在事务前拒绝，已有分支内容保持不变 | Pass |
| AC-M2-02 创建失败回滚 | 非法基线、Git 创建后验证失败、`ready` 数据库写入失败三类注入；均不留下分支或 Git Worktree，记录不为 `ready` | Pass |
| AC-M2-03 脏状态保护 | 未跟踪文件默认阻止；强制操作缺少确认被 Schema/Service 双重阻止；确认后写审计 | Pass |
| AC-M2-04 恢复扫描 | 外部删除后从 `ready` 变 `missing`；外部创建识别为 `unregistered`；应用启动自动执行全库对账 | Pass |
| AC-M2-05 批量稳定性 | 连续创建并安全回收 20 个 Worktree；Git 只剩主工作树，无活跃记录或未登记路径 | Pass |
| AC-M2-06 非 Git 目录 | 非 Git 和裸仓库能力检测；UI 明确 Local 降级；创建请求返回结构化失败，不伪装隔离 | Pass |
| 路径越界 | 注入指向受管根外的恶意记录，强制确认仍拒绝删除，外部文件保持不变 | Pass |
| 运行中删除 | UI 组件验证不显示强制删除；Main 同时检查当前 Workspace 和全部 Worker `cwd` | Pass |
| 临时状态边界 | Zustand 黑盒测试验证 Worktree 派生/加载/错误状态不进入 Local Storage | Pass |
| IPC 契约 | allowlist 与 Main 注册同步；UUID、长度和强制确认 Schema 单测 | Pass |
| 双语界面 | 中英文资源、非 Git 降级和禁止删除组件测试 | Pass |

主要测试文件：

- `src/main/worktree/git-worktree-runner.test.ts`
- `src/main/worktree/managed-worktree-service.test.ts`
- `src/main/ipc/schemas-worktree.test.ts`
- `src/renderer/src/features/worktrees/worktrees-panel.test.tsx`
- `src/renderer/src/stores/__tests__/ui-store-worktree-persist.test.ts`
- `packages/shared/right-panels.test.ts`

完整验证结果：

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | Pass，零错误 |
| `npm run lint` | Pass，零错误 |
| `npm run test:scripts` | Pass，84 文件，251 项 |
| `npm run test:unit` | Pass，63 文件，237 项 |
| `npm run build` | Pass，Main/Preload/Renderer 生产构建成功 |
| `npm run sbom` | Pass，306 个生产组件 |
| `npm run test:e2e` | Pass，12/12 |
| `npm audit --omit=dev --audit-level=high` | Pass，0 vulnerabilities |

## 6. 架构变化

- 新增共享 `ManagedWorktree`、能力、请求、对账和删除安全契约。
- 新增独立 Main Worktree Service、Git Runner、Repository 和 SQLite 表。
- 新增类型化 Worktree IPC，不把 Git/文件删除能力暴露给 Renderer。
- 新增独立 Zustand Worktree Slice；派生状态不进入持久化白名单。
- WorkerManager 只新增只读的 Workspace 占用查询，没有把 Worktree 业务写入 Worker。
- 应用启动后异步执行对账；失败记录告警但不阻塞主窗口启动。

这些变化符合 RFC 的 Main 单写、Renderer 纯交互、Pi JSONL 不扩展原则，无需修订既有 ADR。

## 7. 剩余风险

- 外部命令行可以在受管根外创建任意 Worktree；产品只管理和删除自己登记且位于受管根内的路径。
- 当前恢复策略会报告“缺失”和“未登记”，但不自动把外部移动后的路径重新绑定到原记录，避免误接管。自动/人工重新绑定是否需要进入 M4，需结合真实试点决定。
- SQLite 已使用 WAL、写后回读和 Git 对账，但数据库备份、完整性检查、损坏重建工具仍属于 M4。
- M2 只支持用户手动创建/打开 Worktree；父 Agent 自动创建子 Worktree、取消传播和证据回传属于 M3。
- Windows/Linux 保留路径兼容代码，但 v0.1 仍只以 macOS Apple Silicon 为首发验收平台。

## 8. Go/No-Go

- M2 内部工程门禁：Go。
- GATE-1 开始 M3 编排：Go；M1 单写租约与 M2 Worktree 契约均已有自动化证据。
- 面向客户商业发布：No-Go，继续受 M0 合规、签名、公证和后续 M3–M5 门禁约束。
