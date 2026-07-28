# M1 会话单写租约验收报告

| 项目 | 内容 |
| --- | --- |
| 文档编号 | M1-REPORT-001 |
| 日期 | 2026-07-25 |
| 对应范围 | FR-LEASE-01–07、AC-M1-01–05 |
| 结论 | Internal engineering gate passed |
| 下一阶段 | M2 Managed Git Worktree |

## 1. 结论

M1 已建立从 Renderer 到 Main、Worker 和会话 JSONL 的单写边界。协议内的两个产品实例或 Worker 不能同时获得同一会话写入权；租约在真实写入前获取，历史预览不启动 Worker、不占用租约。发生冲突时，界面进入只读状态，并提供“返回、保持只读、明确强制接管”三条路径。

本结论仅表示内部工程门禁通过，不解除 M0 报告中的许可证、签名、公证和商业发布阻断。

## 2. 已实现的协议

- 租约文件紧邻会话：`session.jsonl.lease`。
- 协议版本：`1`。
- 字段：`appId`、`instanceId`、`hostname`、`pid`、`sessionFile`、`acquiredAt`、`refreshedAt`。
- 文件权限：尽力设置为 `0600`；写入使用临时文件与原子替换。
- 仲裁锁：短生命周期 `.lease.lock`，使用排他创建、随机 Token、超时和陈旧锁恢复。
- 心跳：10 秒。
- 跨主机 TTL：60 秒。
- 同主机：PID 存活时阻止写入；PID 不存在时标记为 stale。
- 文件损坏：进入可解释的 `corrupt` 状态，不静默覆盖；用户确认后才可恢复。
- 强制接管：只有真实冲突弹窗中的明确危险操作可以发起，Main Schema 还要求 `confirmed: true`。

## 3. 写入安全边界

### 3.1 获取时机

打开历史会话时只调用只读检查，不创建 Worker。首次发送、会话树导航或其他需要绑定 Worker 的写路径，先由 Main 获取租约，再启动/绑定 Worker。

### 3.2 写前复核

发送、steer、follow-up、abort、模型/思考级别修改、fork、clone、rename、delete、tree navigate 和扩展命令在下发 Worker 前复核当前实例仍持有租约。

Worker 正常退出时先复核租约，再允许 abort/dispose 刷盘。若租约已丢失，则跳过所有可能写 JSONL 的优雅退出消息并立即终止进程。

### 3.3 租约丢失

心跳发现租约被替换或刷新失败时：

1. 停止该租约的心跳。
2. 将 Worker 从池中移除。
3. 不发送 abort/dispose，立即终止 Worker。
4. 向 Renderer 发送结构化 `lease/lost` 事件。
5. UI 清除运行态、切换只读并显示冲突弹窗。

### 3.4 草稿完整性

Main 对竞争条件返回结构化 `SESSION_LEASE_CONFLICT`，不会把 Prompt 下发 Worker。Renderer 恢复发送前的富文本 Segment，因此普通文字、文件引用和剪贴板图片不会因租约冲突丢失。

## 4. 审计

SQLite 新增 `audit_event` 表和时间、会话索引。当前记录：

- `lease.acquire`：成功、阻止和 I/O 失败。
- `lease.expiry-detected`：发现死 PID 或跨主机过期租约。
- `lease.refresh`：刷新失败。
- `lease.release`：成功或失败。
- `lease.takeover`：显式强制接管。
- `lease.lost`：本实例丢失写入权。

审计详情进入统一递归脱敏器；Token、API Key、Authorization、Cookie、Password、Credential 等键不会以明文入库。会话正文不进入租约审计。

## 5. 用户路径与双语

冲突弹窗显示：

- 会话写入持有者应用。
- 主机名和 PID。
- 最近心跳时间。
- 判定原因。
- 强制接管的双写风险。

三个操作分别是：

1. 返回项目首页，不绑定 Worker。
2. 保持只读，继续查看历史。
3. 明确确认强制接管；成功后恢复发送能力。

新增中文和英文 `lease` 资源，核心路径没有只支持单一语言的新增文案。

## 6. 验收证据

| 验收项 | 自动化证据 | 结果 |
| --- | --- | --- |
| AC-M1-01 单写保护 | 两个独立 `SessionLeaseService` 并发获取，同一时刻只有一个成功 | Pass |
| AC-M1-02 正常释放 | A 释放后 B 无等待立即获取 | Pass |
| AC-M1-03 崩溃恢复 | 死 PID/过期记录先阻止，明确确认后接管；不需要手删文件 | Pass |
| AC-M1-04 无提示接管禁止 | 活跃持有者默认阻止；UI 三路径；IPC 要求字面量 `confirmed: true` | Pass |
| AC-M1-05 审计 | 获取、过期、刷新失败、释放、丢失和接管事件；递归脱敏测试 | Pass |
| 租约被替换 | 原持有者刷新失败并触发 lost callback | Pass |
| 损坏租约 | 默认阻止，确认后可恢复成合法记录 | Pass |
| 退出写入竞态 | 写前复核失败时立即 kill，不发送 abort/dispose | Pass |
| UI 租约丢失 | 状态切换只读、运行态归零、弹窗打开 | Pass |
| UI 明确接管 | 组件测试验证只读路径不调用 IPC，接管路径发送 `confirmed: true` | Pass |
| 100 次启动/退出循环 | 每轮有效持有者阻止竞争实例；正常退出后下一实例获得租约；循环结束无残留租约 | Pass |

主要测试文件：

- `src/main/lease/lease-policy.test.ts`
- `src/main/lease/session-lease-service.test.ts`
- `src/main/__tests__/worker-manager-pool.test.ts`
- `src/main/audit/audit-repository.test.ts`
- `src/renderer/src/stores/__tests__/apply-app-event-lease.test.ts`
- `src/renderer/src/features/session-lease/session-lease-conflict-dialog.test.tsx`

验证命令：

```bash
npm run typecheck
npm run lint
npm run test:scripts
npm run test:unit
npm run build
npm run test:e2e
```

## 7. 剩余风险

Pi CLI、原 pi-app 和其他不实现本协议的客户端不会读取 `.jsonl.lease`，所以它们仍可能在本产品持有租约时直接追加 JSONL。本阶段没有虚假声称可以阻止这类外部写入。

后续 M4 应补充会话文件外部追加监测、差异诊断、备份/导出和故障注入；在此之前，冲突弹窗会明确提示用户确认原任务已经停止。该剩余风险记录在 R-05、R-19，不阻塞 M2 的协议内 Worktree 开发。

## 8. Go/No-Go

- M1 内部工程门禁：Go。
- 进入 M2 Managed Git Worktree：Go。
- 面向客户商业发布：No-Go，继续受 M0 合规和签名门禁约束。
