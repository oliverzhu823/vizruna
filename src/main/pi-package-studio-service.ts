import { createHash, randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { AgentProfile } from '@shared/agent-profile'
import { resolveAgentPiResourceSnapshot } from '@shared/agent-composer'
import {
  buildPiPackageStudioIssues,
  buildPiDeliveryReadiness,
  PI_PACKAGE_STUDIO_FILES,
  piPackageSlug,
  type PiPackageStudioExportRequest,
  type PiPackageStudioExportResponse,
  type PiPackageStudioPlan,
  type PiPackageStudioPreviewRequest,
} from '@shared/pi-package-studio'
import type { PiResourceCenterSnapshot } from '@shared/pi-resource-center'
import { auditRepository } from './audit/audit-repository'
import {
  profileAtAgentVersion,
  releaseAgentVersion,
  requireAgentVersion,
} from './agent-version-service'
import { sqliteIndex } from './sqlite-index'
import { collectPiResourceCenterSnapshot } from './pi-resource-center-service'
import { mutatePiPackage } from './pi-resource-manager'
import { getActiveSdkModule } from './ipc/sdk-session'

type PackageFiles = Record<(typeof PI_PACKAGE_STUDIO_FILES)[number], string>

function requireActiveProfile(profileId: string): AgentProfile {
  const profile = sqliteIndex.getAgentProfile(profileId)
  if (!profile) throw new Error('Agent configuration not found')
  if (profile.status !== 'active') throw new Error('Agent configuration is archived')
  return profile
}

function dependentPackages(planSnapshot: PiResourceCenterSnapshot, resourceSnapshot: PiPackageStudioPlan['resourceSnapshot']) {
  const ids = new Set([
    ...resourceSnapshot.selectedPackageIds,
    ...resourceSnapshot.resources.flatMap((resource) =>
      resource.packageId ? [resource.packageId] : [],
    ),
  ])
  return planSnapshot.packages
    .filter((pkg) => ids.has(pkg.id))
    .map((pkg) => ({
      id: pkg.id,
      source: pkg.source,
      name: pkg.name,
      version: pkg.version,
      scope: pkg.scope,
      installed: pkg.installed,
    }))
}

function effectiveTools(
  profile: AgentProfile,
  resourceSnapshot: PiPackageStudioPlan['resourceSnapshot'],
  catalog: PiResourceCenterSnapshot,
): string[] | undefined {
  if (profile.tools === undefined) return undefined
  if (resourceSnapshot.mode !== 'selected') return [...profile.tools]
  const extensionIds = new Set(
    resourceSnapshot.resources
      .filter((resource) => resource.kind === 'extensions')
      .map((resource) => resource.id),
  )
  const discovered = catalog.resources.extensions
    .filter((resource) => extensionIds.has(resource.id))
    .flatMap((resource) => resource.tools ?? [])
  const permitted = profile.extensionTools === undefined
    ? discovered
    : discovered.filter((tool) => profile.extensionTools?.includes(tool))
  return [...new Set([...profile.tools, ...permitted])]
}

export async function inspectFixedModel(modelId?: string): Promise<{
  found?: boolean
  authenticated?: boolean
}> {
  const ref = modelRef(modelId)
  if (!ref) return {}
  try {
    const sdk = await getActiveSdkModule()
    const runtime = await sdk.ModelRuntime.create({ allowModelNetwork: false })
    const found = Boolean(runtime.getModel(ref.provider, ref.modelId))
    return {
      found,
      authenticated: found ? Boolean(await runtime.checkAuth(ref.provider)) : false,
    }
  } catch {
    return { found: false, authenticated: false }
  }
}

export async function buildPiPackageStudioPlan(
  request: PiPackageStudioPreviewRequest,
  generatedAt = Date.now(),
): Promise<PiPackageStudioPlan> {
  const currentProfile = requireActiveProfile(request.profileId)
  const version = requireAgentVersion(request.versionId, currentProfile.id)
  const profile = profileAtAgentVersion(currentProfile, version)
  const catalog = await collectPiResourceCenterSnapshot({ workspaceId: request.workspaceId })
  const { resourceSnapshot } = resolveAgentPiResourceSnapshot(
    profile.resourceSelection,
    catalog,
    generatedAt,
  )
  const slug = piPackageSlug(profile.name, profile.id)
  const directoryName = `${slug}-${profile.id.replace(/-/g, '').slice(0, 8)}`
  const issues = buildPiPackageStudioIssues({
    profile,
    resourceSnapshot,
    packages: catalog.packages,
    projectTrusted: catalog.runtime.projectTrusted,
    versionStatus: version.status,
  })
  const dependencies = dependentPackages(catalog, resourceSnapshot)
  const model = await inspectFixedModel(profile.modelId)
  const delivery = buildPiDeliveryReadiness({
    versionStatus: version.status,
    sdkVersion: catalog.runtime.sdkVersion,
    modelId: profile.modelId,
    modelFound: model.found,
    modelAuthenticated: model.authenticated,
    toolsInherited: profile.tools === undefined,
    resourcesInherited: resourceSnapshot.mode === 'inherit',
    projectContextInherited: resourceSnapshot.projectContext === 'inherit',
    dependencyPackages: dependencies,
    missingPackageCount: resourceSnapshot.missingPackageIds.length,
    externalResourceCount: resourceSnapshot.resources.filter((resource) => resource.origin === 'top-level').length,
    missingResourceCount: resourceSnapshot.missingResourceIds.length,
    disabledResourceCount: resourceSnapshot.disabledResourceIds.length,
  })
  return {
    generatedAt,
    workspacePath: catalog.workspacePath,
    sdkVersion: catalog.runtime.sdkVersion,
    profile: {
      id: profile.id,
      name: profile.name,
      description: profile.description,
      updatedAt: profile.updatedAt,
    },
    version: {
      id: version.id,
      number: version.number,
      digest: version.digest,
      status: version.status,
      validation: version.validation,
      createdAt: version.createdAt,
    },
    packageName: `@vizruna/${slug}-${profile.id.replace(/-/g, '').slice(0, 8)}`,
    packageVersion: `0.${version.number}.0`,
    directoryName: `${directoryName}-v${version.number}`,
    files: [...PI_PACKAGE_STUDIO_FILES],
    installable: !issues.some((issue) => issue.severity === 'error'),
    portable: !issues.some((issue) =>
      [
        'inherit-resources',
        'inherit-model',
        'inherit-thinking',
        'inherit-tools',
        'project-context-external',
        'external-package-dependencies',
        'external-resource-dependencies',
      ].includes(issue.code),
    ),
    issues,
    delivery,
    dependencies: {
      packages: dependencies,
      resources: resourceSnapshot.resources.map((resource) => ({ ...resource })),
    },
    effectiveTools: effectiveTools(profile, resourceSnapshot, catalog),
    resourceSnapshot,
  }
}

function modelRef(modelId?: string): { provider: string; modelId: string } | null {
  const value = String(modelId || '').trim()
  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1) return null
  return { provider: value.slice(0, separator), modelId: value.slice(separator + 1) }
}

function renderExtension(profile: AgentProfile, plan: PiPackageStudioPlan): string {
  const configuration = {
    name: profile.name,
    model: modelRef(profile.modelId),
    thinkingLevel: profile.thinkingLevel ?? null,
    tools: plan.effectiveTools ?? null,
    promptMode: profile.promptMode,
    systemPrompt: profile.systemPrompt,
  }
  return `import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

const CONFIG = ${JSON.stringify(configuration, null, 2)} as const;

export default function vizrunaAgentProfile(pi: ExtensionAPI) {
  let configured = false;

  pi.on("before_agent_start", async (event, ctx) => {
    if (!configured) {
      configured = true;
      if (CONFIG.model) {
        const model = ctx.modelRegistry.find(CONFIG.model.provider, CONFIG.model.modelId);
        if (model) {
          const applied = await pi.setModel(model);
          if (!applied) ctx.ui.notify(\`Vizruna Agent: model authentication unavailable for \${CONFIG.model.provider}/\${CONFIG.model.modelId}\`, "warning");
        } else {
          ctx.ui.notify(\`Vizruna Agent: model not found: \${CONFIG.model.provider}/\${CONFIG.model.modelId}\`, "warning");
        }
      }
      if (CONFIG.thinkingLevel) pi.setThinkingLevel(CONFIG.thinkingLevel);
      if (CONFIG.tools) {
        const available = new Set(pi.getAllTools().map((tool) => tool.name));
        pi.setActiveTools(CONFIG.tools.filter((tool) => available.has(tool)));
      }
    }
    return {
      systemPrompt: CONFIG.promptMode === "replace"
        ? CONFIG.systemPrompt
        : \`${'${event.systemPrompt}'}\\n\\n\${CONFIG.systemPrompt}\`,
    };
  });
}
`
}

function dependencyMarkdown(plan: PiPackageStudioPlan): string {
  const packages = plan.dependencies.packages.length
    ? plan.dependencies.packages.map((pkg) => `- \`${pkg.source}\`${pkg.version ? ` (${pkg.version})` : ''}`).join('\n')
    : '- None / 无'
  const resources = plan.dependencies.resources.filter((resource) => resource.origin === 'top-level')
  const topLevel = resources.length
    ? resources.map((resource) => `- \`${resource.path}\``).join('\n')
    : '- None / 无'
  return `## External Pi dependencies / 外部 Pi 依赖

This generated package intentionally does not copy third-party Pi resources. Install or provide these dependencies separately.

此生成包不会静默复制第三方 Pi 资源；请单独安装或提供以下依赖。

### Packages

${packages}

### Top-level resources / 顶层资源

${topLevel}`
}

function deliveryChecklistMarkdown(plan: PiPackageStudioPlan): string {
  const status = plan.delivery.status === 'ready'
    ? 'READY / 已就绪'
    : plan.delivery.status === 'needs-setup'
      ? 'SETUP REQUIRED / 需要准备环境'
      : 'BLOCKED / 当前环境存在阻断'
  const rows = plan.delivery.checks.map((check) => (
    `| ${check.code} | ${check.status} | ${check.value || (check.count != null ? String(check.count) : '—')} |`
  )).join('\n')
  return `# Agent Delivery Checklist / Agent 交付清单

**Status / 状态:** ${status}

**Agent version / Agent 版本:** v${plan.version.number} (${plan.version.digest.slice(0, 12)})

**Pi Runtime checked / 已检查 Pi Runtime:** ${plan.sdkVersion}

| Check / 检查项 | Result / 结果 | Required value / 所需值 |
| --- | --- | --- |
${rows}

## Before running on another machine / 在另一台电脑运行前

1. Install a compatible Pi Runtime and this Package.
2. Install every external Pi Package and top-level resource listed in the generated README.
3. Configure the required model and sign in to its Provider locally.
4. Supply the target project's own context files when this Agent inherits project context.
5. Run the Agent's fixed evaluation tasks again in the target environment before production use.

1. 安装兼容的 Pi Runtime 和本 Package。
2. 安装 README 中列出的全部外部 Pi Package 与顶层资源。
3. 配置所需模型，并在目标电脑本地完成 Provider 登录。
4. 如果 Agent 继承项目上下文，请在目标项目中提供对应上下文文件。
5. 正式使用前，在目标环境重新运行 Agent 的固定评测任务。

## Credential boundary / 凭据边界

This delivery contains no API keys, OAuth tokens, proxy passwords, or other credentials. Provider authorization must be completed separately on the target machine.

本交付物不包含 API Key、OAuth Token、代理密码或其他凭据；必须在目标电脑单独完成 Provider 授权。
`
}

export function renderPiPackageFiles(
  profile: AgentProfile,
  plan: PiPackageStudioPlan,
): PackageFiles {
  const metadata = {
    schemaVersion: 1,
    generator: 'Vizruna Pi Package Studio',
    generatedAt: plan.generatedAt,
    sdkVersion: plan.sdkVersion,
    profile: {
      ...profile,
      resourceSnapshot: plan.resourceSnapshot,
      effectiveTools: plan.effectiveTools,
    },
    version: plan.version,
    delivery: plan.delivery,
    dependencies: plan.dependencies,
    issues: plan.issues,
  }
  const packageJson = {
    name: plan.packageName,
    version: plan.packageVersion,
    description: profile.description || `Pi Agent package generated from ${profile.name}`,
    private: true,
    type: 'module',
    license: 'UNLICENSED',
    keywords: ['pi-package', 'vizruna-agent'],
    peerDependencies: {
      '@earendil-works/pi-coding-agent': '*',
    },
    pi: {
      extensions: ['./extensions/agent-profile.ts'],
    },
    vizruna: {
      schemaVersion: 1,
      profileId: profile.id,
      versionId: plan.version.id,
      versionNumber: plan.version.number,
      versionDigest: plan.version.digest,
      profileUpdatedAt: profile.updatedAt,
      generatedAt: plan.generatedAt,
      sdkVersion: plan.sdkVersion,
      metadataFile: './vizruna-agent.json',
    },
  }
  const readme = `# ${profile.name}

${profile.description || 'A Pi Agent configuration generated by Vizruna.'}

This is a standard local Pi Package. Install it with Vizruna Package Studio or \`pi install /absolute/path/to/package\`.

这是一个标准的本地 Pi Package。可通过 Vizruna Package Studio 安装，或执行 \`pi install /绝对路径/到/package\`。

- Prompt mode: \`${profile.promptMode}\`
- Model: \`${profile.modelId || 'inherit'}\`
- Thinking: \`${profile.thinkingLevel || 'inherit'}\`
- Pi Runtime at export: \`${plan.sdkVersion}\`
- Agent version: \`v${plan.version.number}\` (\`${plan.version.digest.slice(0, 12)}\`)
- Generated: \`${new Date(plan.generatedAt).toISOString()}\`

${dependencyMarkdown(plan)}

## Generated files / 生成文件

- \`extensions/agent-profile.ts\`: Pi-native lifecycle adapter
- \`vizruna-agent.json\`: immutable export metadata and dependency evidence
- \`package.json\`: Pi Package manifest

Do not store API keys or OAuth credentials in this package. Vizruna does not export them.

请勿在此包中保存 API Key 或 OAuth 凭据；Vizruna 不会导出这些内容。
`
  return {
    'package.json': `${JSON.stringify(packageJson, null, 2)}\n`,
    'README.md': readme,
    'DELIVERY_CHECKLIST.md': deliveryChecklistMarkdown(plan),
    'vizruna-agent.json': `${JSON.stringify(metadata, null, 2)}\n`,
    'extensions/agent-profile.ts': renderExtension(profile, plan),
  }
}

function validatePackageFiles(files: PackageFiles, plan: PiPackageStudioPlan): void {
  const manifest = JSON.parse(files['package.json']) as Record<string, unknown>
  const metadata = JSON.parse(files['vizruna-agent.json']) as {
    version?: PiPackageStudioPlan['version']
    delivery?: PiPackageStudioPlan['delivery']
  }
  const pi = manifest.pi as { extensions?: string[] } | undefined
  const vizruna = manifest.vizruna as { profileId?: string; versionId?: string } | undefined
  if (manifest.name !== plan.packageName || manifest.version !== plan.packageVersion) {
    throw new Error('Generated Pi package manifest identity is invalid')
  }
  if (!pi?.extensions?.includes('./extensions/agent-profile.ts')) {
    throw new Error('Generated Pi package does not declare its Agent extension')
  }
  if (vizruna?.profileId !== plan.profile.id) {
    throw new Error('Generated Pi package ownership metadata is invalid')
  }
  if (vizruna.versionId !== plan.version.id) {
    throw new Error('Generated Pi package Agent version metadata is invalid')
  }
  if (JSON.stringify(metadata.version) !== JSON.stringify(plan.version)) {
    throw new Error('Generated Pi package validation evidence is invalid')
  }
  if (JSON.stringify(metadata.delivery) !== JSON.stringify(plan.delivery)) {
    throw new Error('Generated Pi package delivery evidence is invalid')
  }
  if (!files['DELIVERY_CHECKLIST.md'].includes(plan.version.digest.slice(0, 12))) {
    throw new Error('Generated Pi package delivery checklist identity is invalid')
  }
  for (const path of PI_PACKAGE_STUDIO_FILES) {
    if (!files[path]?.trim()) throw new Error(`Generated Pi package file is empty: ${path}`)
  }
}

function assertManagedTarget(packagePath: string, profileId: string): void {
  if (!existsSync(packagePath)) return
  const metadataPath = join(packagePath, 'vizruna-agent.json')
  if (!existsSync(metadataPath)) {
    throw new Error('Package target already exists and is not managed by Vizruna')
  }
  const metadata = JSON.parse(readFileSync(metadataPath, 'utf8')) as {
    profile?: { id?: string }
  }
  if (metadata.profile?.id !== profileId) {
    throw new Error('Package target belongs to another Vizruna Agent configuration')
  }
}

function atomicWrite(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${randomUUID()}`
  writeFileSync(temporary, content, { encoding: 'utf8', mode: 0o600 })
  renameSync(temporary, path)
}

function persistPackage(packagePath: string, files: PackageFiles, plan: PiPackageStudioPlan): void {
  assertManagedTarget(packagePath, plan.profile.id)
  for (const relativePath of PI_PACKAGE_STUDIO_FILES) {
    atomicWrite(join(packagePath, relativePath), files[relativePath])
  }
  const persisted = Object.fromEntries(
    PI_PACKAGE_STUDIO_FILES.map((relativePath) => [
      relativePath,
      readFileSync(join(packagePath, relativePath), 'utf8'),
    ]),
  ) as PackageFiles
  validatePackageFiles(persisted, plan)
}

export async function exportPiPackage(
  request: PiPackageStudioExportRequest,
): Promise<PiPackageStudioExportResponse> {
  const plan = await buildPiPackageStudioPlan(request)
  if (!plan.installable) throw new Error('Pi Package Studio validation contains blocking issues')
  const currentProfile = requireActiveProfile(request.profileId)
  const version = requireAgentVersion(request.versionId, currentProfile.id)
  const profile = profileAtAgentVersion(currentProfile, version)
  const files = renderPiPackageFiles(profile, plan)
  validatePackageFiles(files, plan)
  const packageRoot = resolve(plan.workspacePath, '.vizruna', 'pi-packages')
  const packagePath = resolve(packageRoot, plan.directoryName)
  if (!packagePath.startsWith(`${packageRoot}/`)) throw new Error('Invalid Pi package export path')
  persistPackage(packagePath, files, plan)
  const releasedVersion = releaseAgentVersion(version)
  const releasedPlan: PiPackageStudioPlan = {
    ...plan,
    version: {
      id: releasedVersion.id,
      number: releasedVersion.number,
      digest: releasedVersion.digest,
      status: releasedVersion.status,
      validation: releasedVersion.validation,
      createdAt: releasedVersion.createdAt,
    },
  }
  const digest = createHash('sha256')
    .update(PI_PACKAGE_STUDIO_FILES.map((path) => files[path]).join('\n'))
    .digest('hex')
  let workerReload: PiPackageStudioExportResponse['workerReload'] = 'not-running'
  let installed = false
  if (request.install) {
    const mutation = await mutatePiPackage({
      workspaceId: plan.workspacePath,
      action: 'install',
      source: packagePath,
      scope: 'project',
      confirmed: true,
    })
    installed = true
    workerReload = mutation.workerReload
  }
  auditRepository.write({
    category: 'operation',
    action: request.install ? 'pi.package-studio.export-install' : 'pi.package-studio.export',
    outcome: 'success',
    workspaceId: plan.workspacePath,
    details: {
      profileId: profile.id,
      versionId: version.id,
      versionNumber: version.number,
      packageName: plan.packageName,
      packagePath,
      installed,
      digest,
    },
  })
  return {
    ok: true,
    plan: releasedPlan,
    packagePath,
    packageSource: packagePath,
    installed,
    workerReload,
  }
}

export const piPackageStudioTestApi = {
  modelRef,
  validatePackageFiles,
}
