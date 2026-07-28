# M4 稳定性、审计与诊断验收报告

| 项目 | 内容 |
| --- | --- |
| 文档编号 | M4-REPORT-001 |
| 日期 | 2026-07-25 |
| 对应范围 | M4-01–07、AC-M4-01–04 |
| 结论 | Internal engineering gate passed |
| 下一阶段 | M5 Provider Routing and Productization |

## 1. 当前结论

M4 已完成“可恢复且可审计”的产品底座：Main 统一分类网络、鉴权/地区、Worker、会话外部变更、Worktree、磁盘、SQLite、超时和取消故障；操作审计支持筛选和 JSON/JSONL 导出；诊断包必须先预览再导出，并对字段名和字符串内容执行两层脱敏；SQLite 支持迁移前备份、手动备份、完整性验证、显式恢复和失败回滚。

恢复工具只处理产品 SQLite 元数据，不读取、不截断、不重写 Pi JSONL 正文。Git、磁盘和 SQLite 对账只更新可观察状态并给出建议，不会自动删除 Worktree、分支或代码目录。

故障注入、100 个连续子任务生命周期、生产 Electron 看门狗和选定 E2E 已通过。真实 Electron 主进程持续运行 8.014 小时，未发生意外退出。

## 2. 统一失败模型

共享 `FailureEnvelope` 固定包含：

- `code`：稳定内部错误码。
- `stage`：authentication、network、worker、worktree、storage、recovery 或 unknown。
- `message`：有界原始摘要。
- `retryable`：是否适合原地重试。
- `userAction`：下一步可执行动作。
- `timestamp`：分类时间。

当前错误码：

`AUTHENTICATION_FAILED`、`REGION_RESTRICTED`、`NETWORK_UNREACHABLE`、`WORKER_EXITED`、`SESSION_EXTERNALLY_MODIFIED`、`WORKTREE_UNAVAILABLE`、`DISK_WRITE_FAILED`、`SQLITE_BUSY`、`SQLITE_CORRUPT`、`TIMEOUT`、`CANCELLED`、`UNKNOWN`。

IPC 未处理异常统一转换为上述错误模型，并写入脱敏审计。Worker 意外退出单独记录退出码、会话和工作区。外部旧 pi/CLI 不遵守租约协议时，产品无法阻止其直接写磁盘，因此新增空闲 JSONL 指纹：会话进入 idle 时建立基线，下次本产品写入前若发现其他进程修改则阻止写入并要求重新扫描；运行中的本 Worker 流式写入不参与该判断。

## 3. 审计与查询

审计存储仍位于产品 SQLite，不写入 Pi JSONL。查询条件包括：

- category、action、outcome；
- workspace、session；
- 起止时间和有界条数。

已覆盖或预留的类别包括会话租约/接管、安全、Worker、Worktree、编排、代理和恢复。导出只允许 Main 保存对话框选择目标文件，Renderer 无法传入任意写路径。导出 JSON/JSONL 前再次执行内容级脱敏。

敏感键会被替换为 `[REDACTED]`；字符串扫描覆盖 Bearer、常见 API Key、GitHub Token、`token=...`/`password=...` 形式和带用户名密码的 HTTP/SOCKS 代理 URL。

## 4. 诊断包

设置新增中英文“可靠性与诊断”页面，提供：

- SQLite 完整性、Worker 数、审计数和对账差异概览；
- 实际诊断负载预览；
- 包含项、明确排除项、预计压缩大小和脱敏次数；
- 脱敏 JSON 明细；
- 预览完成后才可导出的 `json.gz`；
- 审计筛选和 JSON/JSONL 导出；
- 元数据备份列表、创建和恢复；
- Git/磁盘/SQLite 差异及建议动作。

诊断包包含版本、平台/架构、Node/Electron 版本、安全配置白名单、Worker 状态、进程内存、数据库完整性、备份计数、对账结果和最近脱敏审计。

明确排除：

- Pi JSONL 对话正文；
- 完整 Prompt 和模型回复；
- API Key、OAuth Token；
- Cookie、Authorization Header；
- 代理用户名和密码；
- 环境变量值。

自动化诱饵测试验证上述密钥和值不会出现在序列化结果中。

## 5. SQLite 备份与恢复

数据库 Schema 版本进入 `user_version=4`。已有数据库进入迁移前，会执行 WAL checkpoint 和 `VACUUM INTO` 创建独立可读备份；最多保留 20 份。

恢复流程：

1. 只能选择产品备份目录中已登记的文件名，拒绝路径穿越。
2. 恢复前验证备份 `PRAGMA integrity_check`。
3. 自动创建 `pre-restore` 回滚备份。
4. 关闭当前数据库，把候选文件复制到临时路径并再次验证。
5. 原子置换主数据库，清理旧 WAL/SHM，再打开并执行最终完整性检查。
6. 任一步失败，关闭候选数据库并恢复原文件。
7. 写入恢复审计，明确 `piJsonlModified: false`。

Renderer 必须输入固定短语 `RESTORE_METADATA` 才能调用恢复。E2E 已验证正常备份可恢复；把备份覆盖为非 SQLite 内容后，恢复被拒绝，当前数据库完整性仍为 `ok`。

## 6. 状态对账和数据保护

对账聚合：

- SQLite 已登记但 Git/磁盘缺失的 Worktree；
- 受管目录内 Git 已登记但 SQLite 未登记的 Worktree；
- 子 Agent 关系引用但已缺失的工作区；
- 子 Agent 关系引用但已缺失的会话路径。

每项差异返回 severity、资源 ID、路径、说明和建议。系统不会因为对账结果自动删除目录、分支、会话或审计。

## 7. 性能与稳定性治理

运行快照记录 uptime、RSS、JavaScript heap、external memory、Worker 总数和活跃数。当前预警预算：

| 指标 | 预算 |
| --- | ---: |
| Main RSS 预警 | 1.5 GiB |
| JavaScript heap 预警 | 768 MiB |
| Worker 安全硬上限 | 16 |

自动化连续完成 100 个子 Agent 生命周期，最终 100 个关系均为 `complete`，Runtime 活跃槽为 0。短时生产 Electron 看门狗完成且无意外退出。

正式 8 小时命令：

```bash
npm run test:soak:m4
```

该命令使用独立临时 `userData`，每分钟输出心跳，主进程提前退出即失败，结束后清理临时数据。本次结果为 `elapsedHours=8.014128888888889`、`unexpectedExit=false`。

M4 结束时尚待采集的冷启动、会话切换、Composer、Main→UI 和取消百分位，
已在 M5 生产构建的 20 轮隔离性能门禁中关闭。最终证据见
`evidence/m5-performance.json`；该结果不代替真实 Provider 首次推理验收。

## 8. 故障注入矩阵

| 故障 | 证据 | 结果 |
| --- | --- | --- |
| Provider 401 | 统一失败模型单元测试 | `AUTHENTICATION_FAILED`，不可盲目重试 |
| 地区限制 | 统一失败模型单元测试 | `REGION_RESTRICTED`，提示检查 Provider 路由 |
| 网络断开/超时 | ECONNRESET/timeout 分类测试 | 可重试网络/超时状态 |
| Worker `exit(9)` | M3 编排隔离测试 + Worker 审计 | 目标 interrupted，其他任务继续 |
| 外部 JSONL 追加 | 空闲指纹变化注入 | 写前阻止并记录审计 |
| Worktree 缺失 | M2 对账测试 + M4 聚合 | 显示差异和建议，不自动删除 |
| 磁盘满 | ENOSPC 分类测试 | `DISK_WRITE_FAILED`，不可继续写 |
| SQLite locked | SQLITE_BUSY 分类测试 | 明确可重试 |
| SQLite 损坏备份 | 生产 Electron E2E 覆盖备份内容 | 恢复拒绝，活动库仍完整 |
| 应用重启 | M3 持久关系恢复测试 | running → interrupted，需显式恢复 |
| 100 个连续任务 | 编排生命周期压力测试 | 100 complete，0 活跃槽 |

## 9. 当前自动化结果

| 命令 | 结果 |
| --- | --- |
| `npm run typecheck` | Pass |
| `npm run lint` | Pass |
| `npm run test:unit` | Pass（M4 首轮全量：69 文件、264 项；新增目标测试继续通过） |
| `npm run build` | Pass |
| `npx playwright test e2e/settings.spec.ts` | Pass，5/5 |
| `node scripts/run-m4-soak.mjs --minutes=0.1` | Pass，无意外退出 |
| 100 个连续子 Agent 生命周期 | Pass，100 complete / 0 active |
| `npm run test:soak:m4` | Pass，8.014 小时，`unexpectedExit=false` |

## 10. Go/No-Go

- M4 功能实现：Complete。
- M4 自动化故障与恢复门禁：Pass。
- M4 8 小时退出门禁：Pass。
- M5 性能百分位与 M0 内存回归门禁：后续 Pass。
- 面向客户商业发布：No-Go；仍需许可证书面结论、签名/公证、干净设备、真实凭据模型调用、内部试运行和试点。
