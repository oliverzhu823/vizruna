# Vizruna K0–K6：Headless Runtime、RPC 与 CLI 实施说明

| 项目 | 内容 |
| --- | --- |
| 文档编号 | RFC-002 / IMPLEMENTATION-025 |
| 日期 | 2026-08-31 |
| 状态 | Engineering candidate，尚未提交或发布 |
| Pi Runtime | `@earendil-works/pi-coding-agent@0.84.4` |
| RPC | Vizruna Runtime RPC `1.0` |

## 1. 本轮结果

K0–K6 已形成一条可以独立运行的技术链路：

```text
Vizruna-web（兼容入口） ─┐
Vizruna CLI ────────────┼─→ 127.0.0.1 / RPC v1 → Node Headless Runtime → Pi 0.84.4
未来客户系统 ───────────┘                              ↓
                                            Run / Event / Evidence / Evaluation
```

这不是更换 Pi 底座。Pi 仍然负责模型、Provider、会话、工具、Skills、Extensions、Prompts
和 Packages；Vizruna Runtime 负责稳定调用边界、权限、运行状态、证据和评测编排。

现有 Vizruna-web 暂时保留 Electron 无窗口宿主作为完整 GUI 的兼容适配层，避免一次升级
破坏 OAuth、终端、文件和既有会话。新增 CLI 与 RPC 已经走纯 Node Runtime。后续只需让
GUI 的 Agent 运行逐项切换到 RPC v1，不再重写 Runtime。

## 2. K0–K6 完成矩阵

| 阶段 | 交付 | 工程状态 |
| --- | --- | --- |
| K0 基线冻结 | 旧会话兼容抽检、完整验证基线、脏工作区保护 | 完成 |
| K1 Pi 内核 | Pi `0.84.1 → 0.84.4`、模型持久化适配、SBOM/打包契约 | 完成；真实 Provider 人工冒烟待做 |
| K2 一键入口 | `vizruna doctor`、启动器接入、首次构建、Runtime 启停 | 完成 |
| K3 Headless Runtime | 无 Electron 的 Agent 执行、同库 Agent/Version、持久 Run/Event | 完成 |
| K4 RPC v1 | 能力协商、Agent、Run、SSE/断点事件、Evidence、Evaluation | 完成 |
| K5 权限策略 | observe/collaborate/autonomous、真实工具白名单、审计 | 完成 |
| K6 CLI 与评测 | Agent 运行、状态/停止、证据导出、固定任务串行评测 | 完成 |

## 3. 数据与安全边界

- 服务只绑定 `127.0.0.1`，拒绝错误 Host 和跨站 Origin。
- RPC 使用 256-bit 随机 Bearer Token；浏览器接入可换取 `HttpOnly + SameSite=Strict` Cookie。
- Cookie RPC 额外要求 CSRF Header；Token、server state 和运行数据文件权限为 `0600`。
- Runtime 状态位于 `~/Library/Application Support/Vizruna/headless-runtime`；可通过
  `VIZRUNA_USER_DATA_PATH` 隔离测试或客户实例。
- Event 使用递增游标写入 append-only JSONL；SSE 支持 `Last-Event-ID` 续接。
- Evidence 默认不包含 Prompt 和完整输出；只有 `--include-content` 明确授权后才包含。
- 隐藏思考、凭据和 Token 不进入证据包。

权限模式不是 UI 标签，而是传给 Pi Session 的实际工具白名单：

| 模式 | 默认行为 |
| --- | --- |
| observe | 只开放 read/find/grep/ls |
| collaborate | 开放读取和 edit/write；bash/powershell 需显式批准 |
| autonomous | 开放 Agent 配置所请求的工具；调用者承担项目边界与副作用风险 |

## 4. CLI

```bash
node scripts/vizruna.mjs doctor
node scripts/vizruna.mjs runtime start|status|stop
node scripts/vizruna.mjs web
node scripts/vizruna.mjs agent list --json
node scripts/vizruna.mjs run [agent-id] --workspace PATH --prompt TEXT \
  --permission collaborate --approve bash --wait
node scripts/vizruna.mjs status RUN_ID
node scripts/vizruna.mjs stop RUN_ID
node scripts/vizruna.mjs evidence export RUN_ID --output evidence.json
node scripts/vizruna.mjs evaluation run SUITE_ID --permission collaborate
node scripts/vizruna.mjs evaluation status EVALUATION_ID
```

安装为 npm bin 后可省略 `node scripts/vizruna.mjs`，直接使用 `vizruna`。

## 5. RPC v1

- `GET /api/v1/health`：版本和能力协商。
- `GET /api/v1/events?after=N`：SSE 事件续接。
- `POST /api/v1/rpc`：统一请求信封 `{ id, method, params }`。
- 正式方法：`runtime.info`、`agent.list`、`run.start/list/status/stop/events`、
  `permission.explain`、`evidence.export`、`evaluation.run/status`、`runtime.shutdown`。

RPC v1 的共享类型位于 `packages/shared/runtime-rpc-v1.ts`。内部 Main IPC 不属于稳定接口，
不得直接作为客户集成协议。

## 6. 发布前剩余人工门禁

工程实现完成不等于现在可以公开发布。本轮之后仍需：

1. 分别用 OpenAI Codex OAuth、GLM API 跑一次真实 Headless Run。
2. 用一个包含 Skill、Extension、Prompt 和 Package 的真实 Agent 验证资源加载。
3. 在现有 Vizruna-web 手动回归登录、聊天、终端、Review 和 Agent Studio。
4. 验证一次运行中止、Runtime 重启后状态读取、SSE 断线续接和 Evidence 脱敏。
5. 通过完整 `npm run verify`、Local Web E2E 和生产依赖审计后，才决定版本号与提交。

## 7. 下一步（不属于本轮假完成）

现有 GUI 仍使用兼容 Main IPC 执行大部分会话功能。下一轮应增加 Renderer RPC Adapter，
先迁移后台回归和新 Agent Run，再迁移普通对话；OAuth、终端和文件平台能力继续保留在
平台适配层。只有 GUI 的 Agent 执行完全切换并通过等价测试后，才能删除旧执行路径。
