# M0 工程与合规基线报告

| 项目 | 内容 |
| --- | --- |
| 文档编号 | M0-EVIDENCE-001 |
| 版本 | v0.1 |
| 状态 | Internal engineering gate passed / commercial release blocked |
| 开始日期 | 2026-07-25 |
| 产品分支 | `product-main` |

## 1. 上游基线

| 项目 | 结果 |
| --- | --- |
| 唯一代码上游 | `https://github.com/justhil/pi-app.git` |
| Git remote | `upstream` |
| 固定提交 | `bcef920e3900a858b305c67c42a34e61779f977c` |
| 上游提交日期 | 2026-07-22 |
| Pi SDK | `@earendil-works/pi-coding-agent@0.80.7` |
| 参考项目 | `minghinmatthewlam/pi-gui@48ed3025868ddb9fd359cd1fc19b7ac48916cb39` |

当前上游主分支与评审基线一致，没有在启动开发时引入未评审的新提交。

## 2. 产品身份隔离

已实施：

- npm 包名：`vizruna`。
- 应用显示名：`Vizruna`。
- Electron App ID：`com.vizruna.desktop`。
- 用户数据目录：`Vizruna` 专用目录。
- electron-store：`vizruna`。
- Renderer 持久化键：`vizruna-ui:v1`。
- 虚拟只读资源协议：`vizruna://`。
- 产品更新源默认关闭；未配置公司仓库时不得回退到 `justhil/pi-app`。
- 产品包标记为 `private` 和 `UNLICENSED`，防止内部 Alpha 被误发布。

## 3. 构建环境

项目要求 Node.js `22.19.x`，并通过 `.nvmrc` 和 `.node-version` 固定。

本机初次安装时系统 Node.js 为 `25.6.1`。正式质量证据全部使用 Node.js `22.19.0`；Vitest 固定使用两个 Fork Worker，避免测试运行器因本机资源和 Node 主版本差异产生非确定行为。

## 4. 改造前基线结果

| 检查 | 结果 | 证据摘要 |
| --- | --- | --- |
| `npm ci` | 通过 | 968 个包安装完成，原版生产构建成功 |
| `npm run build` | 通过 | Main、Preload、Renderer 均生成产物 |
| `npm run typecheck` | 通过 | TypeScript 零错误 |
| `npm run lint` | 条件通过 | 零错误，1 个上游 unused eslint-disable 警告 |
| `npm run test:scripts` | 失败 | 111/112 通过；`ui-store.ts` 450 行，超过 400 行门禁 |
| `npm run test:unit` | 失败/未退出 | 并行运行出现测试隔离问题，需修复基线 |
| `npm audit` | 未通过发布门禁 | 1 low、2 moderate、6 high |

以上失败均在产品功能开发前确认，不能归因于后续 M1–M5。

## 5. 已采取的基线修复

- 将 Workspace/临时会话行为拆为独立 Zustand Slice，避免继续膨胀 `ui-store.ts`。
- 新增产品身份契约测试。
- 增加 `NOTICE.md` 和 `UPSTREAM.md`。
- 将开发启动包从上游忽略目录中纳入版本控制。
- 禁止产品自动从上游 pi-app Release 获取更新。
- 移除只为复制已入库字体而引入的 Geist/Next 依赖树，改为校验固定字体及其 OFL。
- 固定 Pi SDK `0.80.7`，并对其 shrinkwrap 内的两个兼容安全补丁执行安装后校验：
  `brace-expansion@5.0.8`、`protobufjs@7.6.5`。
- 通过根级精确依赖、`overrides`、lockfile 对齐和 postinstall 实际安装校验，
  同时消除 Pi SDK shrinkwrap 与开发工具链中的已知审计告警；新鲜
  `npm audit` 与 `npm audit --omit=dev` 均为零风险。
- 去除未配置产品仓库时的 Electron Builder 默认 GitHub 发布目标，打包不会上传或生成错误更新配置。
- 在固定上游提交的临时 Git Worktree 中以 Node.js `22.19.0`、隔离数据和
  20 次生产 Electron 冷启动建立性能基线：冷启动 P95 `1456.96 ms`，
  空闲进程工作集 P95 `475.50 MiB`。证据见
  `evidence/m0-upstream-performance.json`。

## 6. M0 最终工程证据

所有结果均在 Node.js `22.19.0` 下取得。

| 检查 | 结果 | 证据摘要 |
| --- | --- | --- |
| TypeScript | 通过 | Web 与 Node 两套 tsconfig 零错误 |
| ESLint | 通过 | 零错误、零警告 |
| 契约测试 | 通过 | 84 个文件，251 项测试 |
| 单元测试 | 通过 | 53 个文件，202 项测试 |
| Electron E2E | 通过 | 12/12，真实 Electron 43 窗口 |
| 生产构建 | 通过 | Main、Preload、Renderer |
| 完整与生产依赖审计 | 通过 | 两种口径均为 0 Critical / High / Moderate / Low |
| CycloneDX SBOM | 通过 | 306 个生产组件 |
| macOS arm64 打包 | 通过 | 未签名内部 DMG、ZIP、`.app` |
| 安装包运行冒烟 | 通过 | 标题、App ID、版本、数据目录和运行依赖均核验 |

内部构建产物：

- `dist/Vizruna-0.1.0-alpha.1-arm64.dmg`
  - SHA-256：`b1dd12e49b32c4fdcf8bbd9a35faebc25d34f36c3b7ea486699461e0f1155b5f`
- `dist/Vizruna-0.1.0-alpha.1-arm64.zip`
  - SHA-256：`52661944c905415c9fe214eaca4e226b9165e13e30301814d6868fd17b95221c`
- `dist/security/vizruna-0.1.0-alpha.1.cdx.json`
  - SHA-256：`47102583164e6297c5ae2bd007be1dc846da172ffbe029767bde16b980b2eaa7`

安装包运行时身份：

- `CFBundleIdentifier`：`com.vizruna.desktop`
- `app.getName()`：`Vizruna`
- 用户数据目录：`~/Library/Application Support/Vizruna`
- Pi SDK 运行时补丁：`brace-expansion@5.0.8`、`protobufjs@7.6.5`

## 7. 许可证状态

### pi-app

固定快照的 `package.json` 声明 MIT，但仓库没有独立 LICENSE 文件。

处理结论：

- 内部研发：条件允许继续。
- 商业分发：Blocked。
- 解除方式：取得作者书面确认、上游补充 LICENSE，或公司法务给出可记录的使用结论。

### pi-gui

仓库包含 MIT LICENSE。默认只重实现业务行为；如未来复制代码，必须逐项登记来源并保留 MIT 声明。

## 8. 剩余外部门禁与风险处置

- [x] Node 22.19.x 下类型、lint、契约、单元测试全部通过。
- [x] 生产与完整安装树均无已知 npm 审计风险。
- [x] Electron E2E 冒烟测试通过。
- [x] 生成并检查产品 SBOM。
- [x] 在 macOS Apple Silicon 创建未签名内部安装包并完成启动测试。
- [ ] 商业分发许可证门禁获得书面结论。
- [ ] Apple Developer ID 签名、公证和干净设备安装（M5 发布门禁）。
- [ ] 使用测试凭据完成一次真实 Provider 模型调用（需要受控凭据和网络环境）。

结论：M0 内部工程门禁通过，可以进入 M1；未签名产物仅供本机内部验证。
许可证、签名公证和真实 Provider 调用继续阻断任何商业或客户分发。
