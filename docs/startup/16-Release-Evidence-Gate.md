# Vizruna v0.1 正式发布证据门禁

| 项目 | 内容 |
| --- | --- |
| 文档编号 | RELEASE-EVIDENCE-GATE-001 |
| 版本 | v0.1 |
| 状态 | Ready — external evidence required |
| 适用范围 | macOS Apple Silicon 正式 v0.1 |

## 1. 目的

仓库自动化绿色、未签名应用能启动、代理端口可访问，都不能单独证明产品可以
正式发布。本门禁把需要负责人、凭据、设备和真实用户完成的证据收敛到一个
本地 JSON 清单，并由脚本做一致性检查。

严格检查以下内容：

1. 候选版本和 40 位 Git commit 与当前工作树一致。
2. 证据文件不包含 API Key、密码、Token、Authorization、Cookie、代理认证
   URL 或私钥。
3. 安全/法务已经对冻结的 `pi-app` 与 `pi-gui` 快照、行为重实现边界、
   随包 `NOTICE.md`/MIT 正文、第三方依赖清单和 SBOM 做发布批次复核；
   `pi-app` 的上游 MIT 许可与作者确认已经留档。
4. Developer ID 签名、公证、票据装订和 Gatekeeper 全部通过。
5. 独立干净设备完成下载校验、安装、核心流程、升级和卸载。
6. 国际 Provider 通过显式 Profile、中国 Provider 通过 direct 各取得一次
   真实模型回复。
7. 内部试运行覆盖至少七个不同日历日，没有数据丢失、凭据泄漏、代理误路由
   或开放 S0/S1；真实 Provider Agent 启动至少 20 次、成功率不低于 95%，
   并实际观察到 4 Agent 并发、UI 可交互且无状态串线。
8. 完成一次由测试人和复核人分别确认的真实异常恢复演练。
9. 3–5 名真实用户完成 A–E 场景，并覆盖业务/产品、软件工程和 IT/实施角色。
10. 工程、测试、产品、安全/法务四个角色分别给出 Go 签署。

任一字段缺失、候选 commit 变化或证据含疑似密钥，结果均为 **No-Go**。
校验器同时拒绝时间倒置的证据：签名候选不得早于候选冻结记录，干净设备、
真实 Provider、七天试运行和试点必须针对该候选执行，最终签署不得早于任何
一项验收；升级来源版本也不得等于候选版本。

## 2. 初始化本地证据

候选提交冻结后运行：

```bash
npm run release:evidence:init
```

默认创建：

```text
release-evidence/0.1.0-alpha.1.json
```

`release-evidence/` 已加入 `.gitignore`，文件权限默认为 `0600`。其中可能包含
人员姓名、设备和内部证据引用，不应提交到公开仓库。

若需指定受控目录：

```bash
npm run release:evidence:init -- \
  --file=/受控目录/pi-enterprise-v0.1-evidence.json
```

初始化命令默认拒绝覆盖已有文件。只有明确确认旧文件不再需要时，才可附加
`--force`；覆盖前应在受控位置归档旧证据。

## 3. 证据填写原则

### 3.1 只保存引用和哈希

JSON 中可以保存：

- 工单、审计事件、截图、测试记录或内部文档的引用。
- 模型回复内容的 SHA-256。
- DMG 和 ZIP 的 SHA-256；App 本体通过代码签名、Gatekeeper 和票据结果验证。
- Apple Team ID、Notary Request ID 和签名候选的 GitHub Actions Run ID。

许可证记录必须绑定启动包中的两个冻结快照：

- `justhil/pi-app`：
  `bcef920e3900a858b305c67c42a34e61779f977c`
- `minghinmatthewlam/pi-gui`：
  `48ed3025868ddb9fd359cd1fc19b7ac48916cb39`

`piGui.useMode` 固定为 `behavior-reimplementation` 且
`copiedSourceFiles` 必须为 0；若未来实际复制源码，必须先修改来源策略、保留
许可证和版权信息并重新进行法务评审，不能虚填 0 通过门禁。

JSON 中禁止保存：

- API Key、OAuth Token、代理密码和 Cookie。
- `Authorization` 请求头。
- 带用户名或密码的代理 URL。
- 模型完整回复、客户项目内容或完整诊断包。

模型回复可在受控位置保存后计算哈希：

```bash
shasum -a 256 /受控目录/真实回复记录.txt
```

只把哈希和受控记录编号填入 JSON。

### 3.2 真实 Provider

国际记录必须满足：

- `category: "international"`
- `routeMode: "profile"`
- `proxyProtocol` 为 HTTP、HTTPS、SOCKS5 或 SOCKS5H
- `modelReplyObserved: true`
- `inferenceSent: true`

中国记录必须满足：

- `category: "china"`
- `routeMode: "direct"`
- `noProxyEffective: true`
- `modelReplyObserved: true`
- `inferenceSent: true`

两条记录都需要路由审计事件、回复哈希、测试人和证据引用。非鉴权 `HEAD`
诊断、回环代理测试或模型列表加载不能填写为真实推理通过。

### 3.3 七天内部试运行

`trial.days` 至少包含七个不同日期，每天至少完成一个真实任务。每天记录：

- 完成任务数和崩溃次数。
- 数据丢失、凭据泄漏和代理误路由次数。
- 开放 S0/S1 数量。
- 当天关联问题编号。

试运行起止时间至少跨越七个日历日。不能在最后一天一次性补填七条相同日期
或重复日期记录。

`trial.concurrency` 还必须记录：

- 使用真实 Provider 推理，不得用确定性测试替身代替。
- 至少 20 次 Agent 启动，成功率不低于 95%。
- 至少一次达到 4 个 Agent 同时运行。
- 并发期间主界面保持可交互，状态串线次数为 0。
- 对应性能/录屏/审计记录的受控证据引用。

### 3.4 试点与独立复核

- 试点人数为 3–5 人，编号限定为 `P-01`–`P-05` 且不得重复。
- 不能全部是项目开发者。
- 至少各有一名业务/产品、软件工程、IT/实施用户。
- 每人必须完成安装、双路由、代码证据、Worktree/Agent、恢复五个场景。
- 发布构建人与发布复核人、干净设备测试人与复核人、恢复演练测试人与复核人
  不能是同一人。
- S2 可以保留，但每项都必须有负责人、规避方案和目标版本；S0/S1 必须为零。

## 4. 查看当前状态

生成报告但允许 No-Go：

```bash
npm run release:evidence:status
```

输出：

```text
dist/release-evidence/<version>-release-gate.json
dist/release-evidence/<version>-release-gate.md
```

报告只包含候选身份、门禁状态和缺失项，不复制模型回复或凭据。

## 5. 正式硬门禁

在创建正式 Tag 前运行：

```bash
npm run release:evidence:check
```

只有输出 `decision=go` 且退出码为 0，才允许进入最终 Go/No-Go 签署。该命令
检查证据中的 commit 是否等于当前 `git rev-parse HEAD`；候选发生任何提交后，
旧证据会自动失效，必须针对新提交重新确认。

推荐最终顺序：

1. 冻结候选 commit。
2. 完成许可证复核，通过 `Build macOS Release Candidate` 工作流对冻结提交
   运行完整质量/E2E/依赖门禁并生成一次正式签名公证产物，记录
   `candidateRunId` 和两个哈希。
3. 完成独立干净设备 G8。
4. 完成双 Provider 真实推理。
5. 连续执行七天内部试运行和异常恢复演练。
6. 执行 3–5 人试点并关闭 S0/S1。
7. 四方签署。
8. `npm run release:evidence:check`。
9. 把通过证据绑定的 40 位 commit、候选 Run ID、DMG 哈希和 ZIP 哈希分别写入
   GitHub `v0.1-release` 受保护环境变量 `RELEASE_EVIDENCE_COMMIT`、
   `RELEASE_CANDIDATE_RUN_ID`、`RELEASE_DMG_SHA256`、`RELEASE_ZIP_SHA256`，
   由授权复核人批准该环境。
10. 产品负责人最终 Go 后，才创建 `v0.1.0` Tag。

在第 9 步完成后、创建 Tag 前，还必须运行
`npm run release:readiness:check -- --repo=公司OWNER/仓库名`，证明公司仓库、
环境保护和候选 Artifact 与本证据一致。

Release workflow 会检查环境变量是否精确等于 Tag commit、候选 Run 是否成功
且来自相同 commit、下载产物的两个哈希是否相同，并检查 Tag 版本是否等于
`package.json`。它不会在批准后重新构建，因此正式发布与干净设备、试运行和
试点验收的是同一份字节。v0.1 只发布签名公证的 macOS arm64 产物；
Windows/Linux 只保留在质量工作流做兼容性构建，不进入正式 Release。
候选 Artifact 保留 30 天；过期或候选 commit 变化后必须重新构建并重新验收。

## 6. 当前状态

当前仓库 remote 只指向 `justhil/pi-app` 上游，尚未配置公司控制的发布仓库；
当前机器也没有有效 Developer ID Application identity、公证或测试 Provider
凭据。许可证书面结论、干净设备、七天试运行、恢复演练、真实试点和四方签署
也尚未提供。因此当前严格结果仍是 **No-Go**。本工具只保证证据字段完整、
一致且不携带常见凭据，不能代替负责人对证据真实性和法律结论的判断。
