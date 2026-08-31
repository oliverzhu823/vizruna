# Vizruna 纯 Node Web 与 npx 分发说明

文档状态：Engineering passed；npm Alpha published and registry install verified

实施日期：2026-08-31

当前版本：`0.1.0-alpha.7`

## 1. 用户结果

Vizruna Local Web 已于 2026-08-31 首次发布，并在 `0.1.0-alpha.7` 修复 npm 包的
Pi Worker 直接依赖清单。用户只需安装
Node.js 22.19.0 或更高版本并执行：

```bash
npx --yes vizruna@alpha
```

零参数 CLI 默认启动本机 Web UI；浏览器自动打开。它不是云服务，也不安装 macOS
`.app`，因此不需要 Apple 开发者证书、签名、公证或 Gatekeeper 绕过。终端关闭或按
`Control+C` 后，本次 Web 服务退出。

## 2. 包内结构

发布脚本生成独立的 `dist/npm`，而不是直接发布整个开发仓库：

- `out/node-web`：预构建的纯 Node Web Host；
- `out/renderer`：预构建 React UI、字体与图片；
- `out/main`：稳定 CLI、Headless Runtime、RPC 与 Node Worker；
- `bin/vizruna.mjs`：npm 可执行入口；
- `NOTICE.md`、`THIRD_PARTY_LICENSES` 与生产依赖清单；
- Pi 0.84.4、SQLite 和终端所需的最小运行依赖。

候选 tarball 约 4.4 MB，解包后的 Vizruna 自身约 16.9 MB。首次 npm 安装还会安装
Pi 和原生运行依赖。包不包含 Electron，也不在用户机器上重新构建 React 页面。

## 3. 运行边界

```text
Browser / React Renderer
          │  authenticated HTTP RPC + SSE
Pure Node Local Web Host
          ├── existing validated Main handlers
          ├── Node child-process Pi Workers
          ├── terminal / filesystem / git / review
          └── SQLite + Vizruna/Pi user data

Optional automation clients
          │  RPC v1
Independent Headless Runtime
```

平台兼容层只实现 Local Web 真正需要的 Electron 接口：系统默认浏览器/文件打开、应用
路径、单实例锁、Node Worker 与本机敏感值加密。系统文件框在 Web UI 中由路径选择界面
替代；原生系统通知当前降级为不发送，不影响 Agent 运行和页面内状态。

## 4. 本地安全与数据升级

- HTTP 与 Runtime RPC 只监听 `127.0.0.1`，不接受局域网访问。
- 每次 Web 启动创建新的 256-bit 一次性令牌；兑换后使用 HttpOnly、SameSite Cookie。
- Host、Origin、CSRF 请求头、RPC 白名单、请求大小和静态资源 CSP 均有服务端约束。
- Runtime 状态输出不返回内部 Bearer Token。
- Vizruna 用户数据保存在 npm 缓存和包目录之外；更新或清理 npx 缓存不会删除会话、
  Agent 配置、案例或设置。Pi 登录凭据继续位于 Pi 原生用户目录。
- Node Web 本机密钥与敏感文件使用仅当前操作系统用户可读权限。这是本地应用边界，
  不抵御已经取得同一操作系统账号权限的恶意程序。

## 5. 自动验收

```bash
npm run package:npm:test
```

该命令会重新构建产品、生成 npm tarball、创建全新临时项目并安装 tarball，然后验证：

1. postinstall 能在干净 npm 依赖树中解析并校验 Pi 安全依赖；
2. `vizruna doctor --json` 通过；
3. 独立 Runtime 可启动、返回无 Token 的公开状态并干净停止；
4. 零参数 `vizruna` 真正启动预构建 Web Host；
5. 未授权 API 返回 401，一次性启动令牌能换取 HttpOnly 会话；
6. 授权健康检查返回 Vizruna-web，Renderer 首页可以读取；
7. Web 进程收到终止信号后完成清理退出。
8. 干净安装后的真实 Pi Worker 能加载 SDK 并完成一次会话初始化。

仓库浏览器 E2E 还会验证项目打开、核心 RPC、Node Pi Worker 与 `node-pty` 终端闭环。

## 6. Alpha 发布结果与后续门禁

首次 npm Alpha 已发布，公开 Registry 干净安装、`doctor`、Web 启动、鉴权、首页读取和
进程退出均已通过。对外安装命令固定使用 `vizruna@alpha`。

npm 在包的首次发布中自动把唯一版本同时绑定到 `alpha` 和 `latest`；在完成有效 2FA
网页授权后，Registry 仍以 HTTP 400 拒绝删除 `latest`。因此当前裸命令 `npx vizruna`
也会解析到 Alpha，但文档和对外分享必须继续显式使用 `@alpha`，避免把测试版误认为稳定版。

稳定版发布前还需：

1. 决定 Vizruna 自有代码的许可证；当前 `package.json` 是 `UNLICENSED`，上游 MIT
   许可只解决上游代码使用权，不会自动替 Vizruna 选择许可证；
2. 保持 npm 账号、2FA 与 `vizruna` 包名可用；
3. 更新版本号和 CHANGELOG，重跑完整仓库门禁与 `package:npm:test`；
4. 将后续发布迁移到 npm Trusted Publishing/provenance，并在另一台干净设备运行真实
   Provider/OAuth 冒烟；
5. 稳定版通过后把安装命令从 `@alpha` 切换为 `@latest`。

源码 ZIP 和 Git 克隆方式继续作为可审计回退，不与 npx 用户数据冲突。
