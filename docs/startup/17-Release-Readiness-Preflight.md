# Vizruna 正式发布准备预检

| 项目 | 内容 |
| --- | --- |
| 文档编号 | RELEASE-READINESS-001 |
| 版本 | v0.1 |
| 状态 | Ready — company repository required |
| 性质 | 只读预检，不创建仓库、不写 GitHub 配置、不读取 Secret 值 |

## 1. 目的

正式证据完整，并不代表 GitHub 发布基础设施已经配置正确。本预检在创建 Tag
以前，以只读方式核对本地候选、公司仓库、受保护环境、签名 Secret 名称、发布
变量、候选 Run 和不可变 Artifact。

它与证据门禁分工如下：

- `release:evidence:check`：证明人、设备、测试和审批证据完整。
- `release:readiness:check`：证明这些证据已正确绑定到可执行的发布基础设施。
- GitHub `release.yml`：在 Tag 触发后再次强制核对 commit、Run 和两个哈希。

三层均通过才允许正式发布。

## 2. 使用方式

候选开发阶段可随时查看缺项，No-Go 不返回失败码：

```bash
npm run release:readiness:status
```

公司仓库尚未设为默认 remote 时，显式指定：

```bash
npm run release:readiness:status -- \
  --repo=公司OWNER/vizruna
```

正式创建 Tag 前运行严格检查：

```bash
npm run release:readiness:check -- \
  --repo=公司OWNER/vizruna
```

严格检查为 No-Go 时退出码为 1。报告默认写入：

```text
dist/release-readiness/formal-release-readiness.json
dist/release-readiness/formal-release-readiness.md
```

报告权限为 `0600`。报告不保存 Apple 凭据、API Key 或 GitHub Token，也不输出
Secret 值；它只读取环境 Secret 的名称。

## 3. 十项检查

| 检查 | Go 条件 |
| --- | --- |
| 冻结候选 | 工作树干净、版本为 `0.1.0`、CHANGELOG 完整、两个工作流已跟踪 |
| 正式证据 | 本地证据存在、严格结果 Go，并含候选 Run/DMG/ZIP 绑定 |
| 公司仓库 | remote 指向可访问、未归档且非 `justhil/pi-app` 的公司仓库 |
| 仓库权限 | GitHub CLI 已登录，当前账号对公司仓库具有 push 权限 |
| 候选提交 | 当前 40 位 commit 和两个发布工作流已经存在于公司仓库 |
| 候选环境 | `v0.1-candidate` 有独立复核、禁止自审并限制部署分支 |
| 签名配置 | 候选环境包含五个必需 Secret 名称 |
| 发布环境 | `v0.1-release` 有独立复核、禁止自审并限制部署分支 |
| 发布绑定 | 四个变量与当前 commit 和严格证据完全一致 |
| 候选产物 | 指定 Run 来源正确、手工触发、成功、commit 相同且 Artifact 未过期；该 Run 已内置 verify、桌面 E2E 和双依赖审计 |

## 4. GitHub 环境要求

### 4.1 `v0.1-candidate`

必需 Secret：

- `MAC_CSC_LINK`
- `MAC_CSC_KEY_PASSWORD`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`
- `APPLE_TEAM_ID`

环境必须至少有一名 required reviewer，启用 prevent self-review，并限制允许部署
的分支。不同 GitHub 套餐对私有仓库的环境保护能力不同；若当前套餐不能满足
独立审批，正式发布保持 No-Go，不能通过移除检查绕过。

### 4.2 `v0.1-release`

正式证据 Go 后才填写：

- `RELEASE_EVIDENCE_COMMIT`
- `RELEASE_CANDIDATE_RUN_ID`
- `RELEASE_DMG_SHA256`
- `RELEASE_ZIP_SHA256`

这四项是普通环境 Variable，不是 Secret。预检会读取其值进行相等性验证，但
生成的报告不会复制值。该环境同样需要独立复核、禁止自审和部署分支限制。

GitHub 官方 REST API 允许只读获取环境保护规则、环境 Secret 名称和环境
Variable；本工具通过已登录的 GitHub CLI 调用这些接口。

## 5. 推荐执行顺序

1. 在公司 OWNER 下建立发布仓库并添加 `origin` 或 `company` remote。
2. 推送冻结候选 commit。
3. 配置 `v0.1-candidate` 环境、审批规则和 Apple Secrets。
4. 手工运行 `Build macOS Release Candidate`。
5. 用该 Artifact 完成全部外部证据并运行 `release:evidence:check`。
6. 把证据中的四项绑定写入 `v0.1-release`。
7. 运行 `release:readiness:check`。
8. 全部 Go 后创建与 `package.json` 一致的 Tag。

## 6. 当前实测状态

当前本机只配置了 `justhil/pi-app` 上游 remote，版本仍为
`0.1.0-alpha.1`，正式证据文件、公司环境、候选 Run 和 Artifact 均不存在。
因此真实只读预检结果为 **No-Go**，与完成度审计一致。

参考：

- [GitHub deployment environment API](https://docs.github.com/en/rest/deployments/environments)
- [GitHub Actions environment secrets API](https://docs.github.com/en/rest/actions/secrets)
- [GitHub Actions environment variables API](https://docs.github.com/en/rest/actions/variables)
