# Vizruna-web 实施说明

文档状态：Release candidate
启动日期：2026-08-02
产品名称：`Vizruna-web`

## 1. 目标

Vizruna-web 不是云端服务，也不是削减功能的演示页面。它把现有 Vizruna 的桌面窗口
替换为本机浏览器界面，同时继续使用同一套 Pi Runtime、会话、模型授权、Agent 配置、
案例库、文件、终端、Review、Worktree 和多 Agent 能力。

用户最终只需要启动一个本地命令，浏览器会自动打开随机端口上的 Vizruna-web。服务
不监听局域网地址，项目文件、OAuth/API Key 和会话数据不上传到 Vizruna 服务器。

## 2. 当前实现

当前代码已经具备以下真实闭环：

- `npm run build:web` 构建纯 Node Vizruna-web 后台、Node 子进程 Pi Worker 和现有
  React Renderer。
- `npm run start:web` 启动后台，并自动打开默认浏览器。
- 浏览器 RPC 复用现有 IPC 白名单、Zod 输入校验、错误分类和审计逻辑。
- SSE 传递消息流、思考、工具调用、文件、运行状态、终端、OAuth、扩展问答、编排和
  SDK 安装进度事件。
- Desktop 和 Vizruna-web 使用同一个 Vizruna 产品数据目录，因此已有会话索引、设置、
  Agent 配置和案例不需要导入；Pi 原生会话及凭据仍使用 Pi 的原始数据位置。
- 浏览器拖入的文件会上传到本机 Vizruna 临时目录，最大 16 MB，七天后自动清理；
  点击“添加文件”仍可使用本机文件选择框。

真实验收已经完成：打开项目、创建 Pi 会话、调用 `zai-coding-cn/glm-5.2`、接收流式
结果并读回 `VIZRUNA_WEB_OK`；测试会话随后已经删除。内嵌终端也已创建、写入、读取
并关闭，返回 `VIZRUNA_TERMINAL_OK`。

## 3. 本地安全边界

以下要求是代码约束，不是部署建议：

1. HTTP 服务只绑定 `127.0.0.1`，端口默认由操作系统随机分配。
2. 启动时生成 256-bit 一次性随机凭证，通过 URL fragment 交给首次打开的页面；
   fragment 不会进入 HTTP 请求或服务日志，成功兑换后同一凭证立即失效。
3. 页面用一次性凭证换取本次进程有效的 HttpOnly、SameSite=Strict Cookie，并立即
   从地址栏移除 fragment。
4. API 只接受精确的 `127.0.0.1:端口` Host；拒绝跨 Origin、`Sec-Fetch-Site:
   cross-site` 和缺少专用 CSRF 请求头的 RPC。
5. 所有 RPC 必须属于共享白名单并已经注册处理器；请求体最大 24 MB。
6. 静态页面使用 CSP、`frame-ancestors 'none'`、`X-Frame-Options: DENY`、
   `nosniff` 和 no-referrer。
7. Desktop 与 Vizruna-web 共享 Electron `userData` 单实例锁，避免两套外壳同时写入
   产品数据库；Pi 会话本身继续使用已有的会话租约保护。
8. API Key 与 OAuth 凭据只由本机后台及 Pi Runtime 读取，不写入浏览器 localStorage。

自动化测试覆盖精确 Host、跨站拒绝、Cookie 异常输入和凭证精确比较；独立浏览器
E2E 已验证未授权/跨站拒绝、启动令牌交换、页面品牌、核心 RPC 与 Web 更新提示。
运行时验收确认未授权健康检查返回 401、伪造 Origin 返回 403。

## 4. 架构

```text
Browser / React Renderer
        │
        ├── POST /api/rpc  ── 命令、查询、终端输入
        └── GET  /api/events ─ 流式事件（SSE）
        │
Vizruna-web local runtime
        │
        ├── 现有 IPC handlers / Zod / audit
        ├── Node child-process Pi Workers
        ├── terminal / filesystem / git / review
        └── SQLite + Vizruna/Pi 本地数据
```

当前用户版后台已经迁移为纯 Node.js：构建时通过平台兼容层保留原有 Main handler
边界，Pi Worker 由 Node `child_process.fork` 承载，OAuth/文件打开调用系统默认应用，
浏览器 RPC 与 React Renderer 无需重写。Electron 只保留在冻结的 Desktop 源码与开发
依赖中，不进入 npx 用户运行链路。因此 Local Web 不再受 `.app` 签名、公证或 macOS
Gatekeeper 安装限制影响。

系统文件选择器在浏览器形态下由内置路径选择界面替代；系统通知兼容层当前不发送原生
桌面通知。敏感配置文件和本机加密密钥以仅当前用户可读权限保存，Pi OAuth/API 配置继续
使用 Pi 原生目录。它们防止其他系统用户直接读取，但不承诺抵御已经取得当前操作系统
账号权限的恶意程序。

## 5. 发布状态与后续工作

- Vizruna-web 是当前唯一维护和发布的用户产品。预发布工作流只生成版本化源码 ZIP、
  SHA-256、SBOM 和构建来源证明，不再构建或上传 DMG、`.app` 或桌面 ZIP；桌面源码
  暂时冻结保留，供共享后台能力和回退参考。
- 主 README 已将 Vizruna-web 设为推荐入口，当前 Alpha 可通过克隆仓库、`npm ci`、
  `npm run start:web` 使用；macOS 也可双击 `Start-Vizruna-web.command`，首次自动安装
  依赖并在后续启动时重建页面。
- Git 启动器仅允许官方 origin、干净 main 和 fast-forward 三项同时满足时自动更新；
  其他状态无条件保留本地目录。ZIP 用户覆盖代码目录时，外部产品数据不受影响。
- 独立 E2E 启动夹具已完成，使用隔离用户目录执行认证、安全和 UI 回归。
- 浏览器 RPC 已覆盖 OAuth 状态、Review、Worktree、多 Agent、语音状态、可靠性快照
  和诊断预览。隔离数据目录中的真实 `openai-codex` 流程已验证登录方式选择、取消和
  弹窗关闭事件能立即到达浏览器；测试没有输入或保存任何账号凭据。
- 打开项目默认使用 Vizruna-web 内置路径对话框，路径在后台确认真实存在且为目录后才
  切换；系统文件夹选择器作为可选入口保留，消除多 Electron 进程下的窗口层级依赖。
- 诊断包与脱敏审计日志在 Vizruna-web 中由后台生成到一次性临时目录，再作为浏览器
  下载返回并立即清理。
- 诊断包与审计日志的浏览器下载已经纳入 E2E；浏览器安全上下文、`getUserMedia` 和
  `MediaRecorder` 能力也已验证。OAuth 最终账号确认和麦克风授权属于必须由使用者
  明确同意的系统权限，不能在自动测试中代替使用者授权。
- npm 包结构已经冻结为 `vizruna`：包含预构建的 Node Web Host、Renderer、Runtime/CLI、
  第三方声明和 Pi 运行依赖；零参数命令直接启动 Web，目标公开命令为
  `npx --yes vizruna@alpha`；稳定版发布后再切换为 `latest`。
- Git 克隆版的官方来源、干净分支和 fast-forward 安全更新已完成；ZIP 版通过覆盖源码
  目录升级且保留外部用户数据。Vizruna-web 不下载或引导安装 DMG。

`npm run package:npm:test` 会生成 tarball，在全新临时项目中安装它，并实际验证 CLI
诊断、独立 Runtime 启停、Web 未授权拒绝、一次性令牌交换、授权健康检查、Renderer
加载和干净退出。工程链路已经完成；在 npm 启动包正式发布前，`npm run start:web`
和 Release 源码包仍是公开 Alpha 的启动方式。
