# Vizruna macOS 发布手册

本文档是 v0.1 Apple Silicon 试点版的可复现发布流程。任何一步失败都视为发布失败，禁止把未签名包重命名为正式包。

## 1. 发布角色

| 角色 | 职责 |
| --- | --- |
| 发布负责人 | 版本、Tag、证书、构建和发布记录 |
| 测试负责人 | G1–G8 证据、干净设备、升级与卸载 |
| 产品负责人 | 发布说明、试点范围、Go/No-Go |
| 安全/法务 | 凭据、SBOM、许可证和分发边界 |

发布负责人和测试负责人不得由同一份未经复核的日志同时代替。

## 2. 前置条件

- macOS Apple Silicon。
- Node.js 22.19.x 和 npm。
- Xcode Command Line Tools，且 `xcrun notarytool --version` 成功。
- 候选代码已推送到公司控制的 GitHub 发布仓库；不得在只指向
  `justhil/pi-app` 上游的 remote 上配置公司 Secrets 或创建公司 Release。
- 有效的 `Developer ID Application` 证书。
- Apple 公证凭据。
- 版本对应的 `CHANGELOG.md` 条目。
- 安全/法务已对 `NOTICE.md`、`THIRD_PARTY_DEPENDENCIES.md` 和 CycloneDX SBOM 完成书面复核，并解除 `justhil/pi-app` 源码许可证阻断。当前仓库尚未取得该结论，因此此项仍是硬门禁。

检查本地签名身份：

```bash
security find-identity -v -p codesigning
```

输出必须包含有效 `Developer ID Application:`，或使用 CI 的 `CSC_LINK` 证书包。

## 3. 凭据配置

### 3.1 CI 正式路径

GitHub Actions 的 `Build macOS Release Candidate` 工作流使用受保护环境
`v0.1-candidate`，并固定使用 Apple Silicon `macos-15` runner，其中配置：

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

Secrets 只放在受保护的 CI 环境中，不写入仓库、`.env`、Issue 或构建日志。
该工作流只生成候选 Artifact，不创建 Release。环境应配置独立审批人，防止
未经授权的分支消耗签名和公证凭据。

### 3.2 本地额外支持路径

本地预检还支持：

- App Store Connect API Key：`APPLE_API_KEY`、`APPLE_API_KEY_ID`、`APPLE_API_ISSUER`
- notarytool Keychain Profile：`APPLE_KEYCHAIN_PROFILE`，可选 `APPLE_KEYCHAIN`

证书可以来自登录钥匙串，或 `CSC_LINK` + `CSC_KEY_PASSWORD`。

## 4. 候选版本准备

1. 工作树必须干净，提交号已冻结。
2. 更新 `package.json` 版本和 `CHANGELOG.md`。
3. 运行完整质量链：

   ```bash
   npm ci
   npm run verify
   npm run test:e2e
   ```

4. 在具有测试网络的机器运行真实非推理路由 E2E：

   ```bash
   PI_REAL_NETWORK=1 \
   PI_TEST_PROXY_URL=http://127.0.0.1:10808 \
   npx playwright test e2e/provider-routing-network.spec.ts
   ```

5. 使用测试 Provider 凭据人工完成：
   - 国际 Provider 经显式 Profile 的一次真实模型回复。
   - 中国 Provider 在 direct 模式的一次真实模型回复。

不得把非鉴权 `HEAD` 检查记录为“真实模型调用已通过”。

6. 候选提交冻结后初始化正式发布证据：

   ```bash
   npm run release:evidence:init
   npm run release:evidence:status
   ```

   逐步填写许可证、正式产物、干净设备、双 Provider、七天试运行、恢复演练、
   试点和签署记录。证据文件默认位于被 Git 忽略的 `release-evidence/`，只能
   保存引用和哈希，不能保存 Key、Token、密码或模型完整回复。字段说明见
   `16-Release-Evidence-Gate.md`。

## 5. 构建正式候选产物

在 GitHub Actions 选择冻结候选提交，手动运行
`Build macOS Release Candidate`。工作流先在同一个 commit 上运行完整
`npm run verify`、桌面 E2E、完整及生产依赖审计，再运行：

```bash
npm run package:mac:release
```

该命令依次执行：

1. 平台、架构、证书和公证凭据预检。
2. 图标生成。
3. Electron 生产构建。
4. `electron-builder --mac --arm64`。
5. Hardened Runtime 和嵌套代码签名。
6. 应用与最终 DMG 公证、票据装订。
7. `codesign`、`spctl`、`stapler` 硬门禁。

成功后记录 Actions Run ID、commit、DMG/ZIP SHA-256，并下载名为
`pi-desktop-mac-candidate-<Run ID>` 的 Artifact。后续干净设备、试运行和
试点必须使用这份候选包；正式 Tag 工作流会按 Run ID 下载并复核同一份字节，
不会重新构建。候选 Artifact 保留 30 天；若过期或候选 commit 变化，必须重新
构建并重做依赖该二进制的验收，不得换包沿用旧证据。

本地也可运行上述命令诊断签名环境，但本地产物不能直接替代正式候选
Artifact，否则最终发布无法证明与验收包完全相同。

预期目录：

- `dist/mac-arm64/Vizruna.app`
- `dist/Vizruna-<version>-arm64.dmg`
- `dist/Vizruna-<version>-arm64.zip`

### 5.1 公开 Alpha/Beta/RC

公开预发布版也属于对外分发，不得使用 `npm run package` 生成的本地开发包，更不得
通过手工上传绕过签名门禁。预发布 Tag（`v*-alpha.*`、`v*-beta.*`、`v*-rc.*`）由
`.github/workflows/prerelease.yml` 在 `v0.1-candidate` 受保护环境中自动执行：

1. 完整质量检查与桌面 E2E。
2. `npm run package:mac:release`。
3. Developer ID 签名、Apple 公证、票据装订和 Gatekeeper 验证。
4. 生成 SBOM、SHA-256 和构建来源证明。
5. 仅在全部通过后创建 GitHub Prerelease。

凭据缺失或任何签名检查失败时，工作流必须失败且不得创建 Release。看到“已损坏”
提示时，应撤下问题产物并修复发布流程，不能把 `xattr` 绕过命令当作公共安装步骤。

## 6. 独立验证

构建脚本已自动运行；测试负责人还应独立运行：

```bash
npm run verify:mac:release
```

检查：

- `codesign --verify --deep --strict` 成功。
- Authority 是 `Developer ID Application`。
- TeamIdentifier 存在。
- `.app` 的 Gatekeeper assess 成功。
- `.app` 和 DMG 的 notarization ticket 均有效。
- DMG 的 Gatekeeper open assess 成功。
- ZIP 存在且来自同一次构建。

生成 SHA-256：

```bash
shasum -a 256 dist/*.dmg dist/*.zip
```

将提交号、版本、哈希、证书 Team ID、公证 Request ID 和验证日志写入发布记录。不得记录密码、API Key 或代理凭据。

## 7. 干净设备 G8

在未安装 Node.js、开发版应用和本仓库的受支持 Apple Silicon Mac 上：

1. 下载 DMG，按发布哈希校验。
2. 双击 DMG 并拖入“应用程序”。
3. 正常双击启动，不使用 `xattr -d`、右键绕过或关闭 Gatekeeper。
4. 切换中文和英文。
5. 配置测试 Provider。
6. 打开 Git 测试项目。
7. 完成一次 Agent 回复、一次文件修改和一次 Review。
8. 创建并安全回收一个 Worktree。
9. 退出并重启，确认会话、配置和任务状态可恢复。
10. 导出诊断包并检查敏感信息。

保留设备型号、macOS 版本、步骤、截图、时间和结果。

## 8. 升级验证

v0.1 使用手动 DMG 升级，不发布自动更新元数据。

1. 在旧试点版创建会话、Provider 路由、代理 Profile、Worktree 登记和 SQLite 元数据备份。
2. 完全退出旧应用。
3. 用新 DMG 覆盖“应用程序”中的旧 `.app`。
4. 启动新版本。
5. 验证以下内容保留：
   - Pi JSONL 会话。
   - 模型认证。
   - Provider 路由和安全存储中的代理密码。
   - 产品 SQLite 元数据。
   - Worktree 目录与登记。
6. 检查启动迁移前备份已产生，且诊断页无阻断级对账问题。

若升级失败：

- 退出应用。
- 保留 `~/Library/Application Support/Vizruna` 原目录。
- 从发布归档重装上一签名版本。
- 仅通过应用内登记的完整备份执行 SQLite 恢复。
- 不回滚或覆盖 `~/.pi/agent` JSONL。

## 9. 卸载验证

1. 退出应用并确认无 Agent Worker。
2. 将 `/Applications/Vizruna.app` 移到废纸篓。
3. 验证项目、`~/.pi/agent`、`~/.vizruna/worktrees` 和产品 userData 均仍存在。
4. 如业务明确要求彻底清理，先导出诊断和元数据备份，再逐一确认：
   - 是否保留 Pi 会话/认证。
   - 是否保留或合并各 Worktree。
   - 是否保留审计和元数据。

发布程序不得默认递归删除用户项目、Pi JSONL 或 Worktree。

## 10. Tag 与发布

只有 G1–G8 全部通过且产品负责人 Go 后：

1. 运行 `npm run release:evidence:check`，必须输出 `decision=go` 且退出码为 0。
2. 在 GitHub `v0.1-release` 受保护环境中，把
   - `RELEASE_EVIDENCE_COMMIT` 设置为证据通过的 40 位 commit。
   - `RELEASE_CANDIDATE_RUN_ID` 设置为证据中 `candidateRunId`。
   - `RELEASE_DMG_SHA256`、`RELEASE_ZIP_SHA256` 设置为证据中的两个哈希。
   由独立复核人逐项比对后批准环境。
3. 创建与 `package.json` 版本完全一致的 `v*` Tag。
4. Release workflow 检查候选 Run 成功且 commit 相同，下载该 Run 的 macOS
   arm64 Artifact，并逐字节复核两个 SHA-256。
5. Release job 生成 SBOM、SHA256SUMS 和构建来源证明。
6. 发布说明必须来自当前版本 `CHANGELOG.md`，不能只有链接占位。

创建 Tag 前还必须运行：

```bash
npm run release:readiness:check -- --repo=公司OWNER/仓库名
```

它只读核对公司 remote、GitHub 权限、环境保护、Secret 名称、四个批准变量、
候选 Run 和 Artifact；任何一项失败均不得创建 Tag。详见
`17-Release-Readiness-Preflight.md`。

当前正式支持范围仍是 macOS arm64。Windows/Linux 只在质量工作流中做兼容性
构建，不进入 v0.1 Release；必须等各自平台验收后另行立项开放。

## 11. 发布记录模板

```text
版本：
Git commit：
构建时间：
构建负责人：
测试负责人：
Developer ID Team：
Notary request：
DMG SHA-256：
ZIP SHA-256：
G1–G8：
真实 Provider 代理/直连：
干净安装设备：
升级来源版本：
开放问题：
Go/No-Go 决策人和时间：
```
