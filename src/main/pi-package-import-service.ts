import { createHash, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, realpathSync, statSync } from 'node:fs'
import { isAbsolute, join, relative, resolve } from 'node:path'
import { z } from 'zod'
import type { AgentProfile, AgentResolvedPiResource } from '@shared/agent-profile'
import {
  agentVersionConfigFromProfile,
  serializeAgentVersionConfig,
  type AgentVersion,
} from '@shared/agent-version'
import {
  buildPiDeliveryReadiness,
  PI_PACKAGE_STUDIO_FILES,
  type PiPackageImportApplyRequest,
  type PiPackageImportApplyResponse,
  type PiPackageImportPlan,
  type PiPackageImportPreviewRequest,
  type PiPackageStudioDependencyPackage,
} from '@shared/pi-package-studio'
import { auditRepository } from './audit/audit-repository'
import { ensureAgentVersion } from './agent-version-service'
import { collectPiResourceCenterSnapshot } from './pi-resource-center-service'
import { mutatePiPackage } from './pi-resource-manager'
import { sqliteIndex } from './sqlite-index'
import { getTrustedWorkspaceRoot } from './trusted-workspace'
import { inspectFixedModel } from './pi-package-studio-service'

const MAX_PACKAGE_FILE_BYTES = 2 * 1024 * 1024

type ImportedMetadata = {
  schemaVersion: number
  sdkVersion: string
  profile: AgentProfile & { resourceSnapshot?: unknown; effectiveTools?: unknown }
  version: AgentVersion
  dependencies?: {
    packages?: PiPackageStudioDependencyPackage[]
    resources?: AgentResolvedPiResource[]
  }
}

const importedMetadataSchema = z.object({
  schemaVersion: z.number().int(),
  sdkVersion: z.string().min(1).max(100),
  profile: z.object({
    id: z.string().uuid(),
    name: z.string().min(1).max(120),
    description: z.string().max(2_000).optional(),
    systemPrompt: z.string().min(1).max(200_000),
    promptMode: z.enum(['append', 'replace']),
    modelId: z.string().max(500).optional(),
    thinkingLevel: z.string().max(50).optional(),
    tools: z.array(z.string().min(1).max(120)).max(64).optional(),
    extensionTools: z.array(z.string().min(1).max(120)).max(512).optional(),
    resourceSelection: z.object({
      mode: z.enum(['inherit', 'selected']),
      packageIds: z.array(z.string().max(4_000)).max(512),
      resourceIds: z.array(z.string().max(4_000)).max(512),
      projectContext: z.enum(['inherit', 'none']),
    }).optional(),
    providerRequirements: z.object({
      reasoning: z.boolean(),
      imageInput: z.boolean(),
      minContextWindow: z.number().int().positive().max(10_000_000).optional(),
    }).optional(),
    status: z.enum(['active', 'archived']),
    createdAt: z.number(),
    updatedAt: z.number(),
  }).passthrough(),
  version: z.object({
    id: z.string().uuid(),
    profileId: z.string().uuid(),
    number: z.number().int().positive(),
    digest: z.string().regex(/^[a-f0-9]{64}$/i),
    config: z.record(z.string(), z.unknown()),
    status: z.enum(['candidate', 'validated', 'released']),
    validation: z.record(z.string(), z.unknown()).optional(),
    releasedAt: z.number().optional(),
    createdAt: z.number(),
  }),
  dependencies: z.object({
    packages: z.array(z.object({
      id: z.string().max(4_000), source: z.string().min(1).max(4_000), name: z.string().max(500),
      version: z.string().max(200).optional(), scope: z.enum(['user', 'project']), installed: z.boolean(),
    })).max(512).optional(),
    resources: z.array(z.object({
      id: z.string().max(4_000), kind: z.enum(['extensions', 'skills', 'prompts']), name: z.string().max(500),
      path: z.string().max(4_000), source: z.string().max(4_000), scope: z.enum(['user', 'project', 'temporary']),
      origin: z.enum(['package', 'top-level']), packageId: z.string().max(4_000).optional(),
    })).max(2_000).optional(),
  }).optional(),
}).passthrough()

function activeWorkspace(requested?: string): string {
  const trusted = getTrustedWorkspaceRoot()
  if (!trusted) throw new Error('No active trusted workspace')
  const workspace = realpathSync(resolve(trusted))
  if (requested && realpathSync(resolve(requested)) !== workspace) {
    throw new Error('Requested workspace is not the active trusted workspace')
  }
  return workspace
}

function packageDirectory(workspace: string, input: string): string {
  const candidate = resolve(workspace, input.trim())
  if (!existsSync(candidate) || !statSync(candidate).isDirectory()) {
    throw new Error('Pi Package directory does not exist')
  }
  const canonical = realpathSync(candidate)
  const fromWorkspace = relative(workspace, canonical)
  if (fromWorkspace === '..' || fromWorkspace.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(fromWorkspace)) {
    throw new Error('Pi Package imports must stay inside the active trusted workspace')
  }
  return canonical
}

function readPackageFile(packagePath: string, relativePath: string): string {
  const path = join(packagePath, relativePath)
  if (!existsSync(path) || !statSync(path).isFile()) throw new Error(`Missing package file: ${relativePath}`)
  if (statSync(path).size > MAX_PACKAGE_FILE_BYTES) throw new Error(`Package file is too large: ${relativePath}`)
  return readFileSync(path, 'utf8')
}

function parseArtifact(packagePath: string): {
  manifest: Record<string, unknown>
  metadata: ImportedMetadata
  errors: string[]
} {
  for (const file of PI_PACKAGE_STUDIO_FILES) readPackageFile(packagePath, file)
  const manifest = JSON.parse(readPackageFile(packagePath, 'package.json')) as Record<string, unknown>
  const metadataResult = importedMetadataSchema.safeParse(JSON.parse(readPackageFile(packagePath, 'vizruna-agent.json')))
  if (!metadataResult.success) throw new Error('Vizruna package metadata schema is invalid')
  const metadata = metadataResult.data as unknown as ImportedMetadata
  const errors: string[] = []
  const vizruna = manifest.vizruna as Record<string, unknown> | undefined
  const pi = manifest.pi as { extensions?: unknown } | undefined
  if (metadata.schemaVersion !== 1) errors.push('unsupported-schema')
  if (!metadata.profile?.id || !metadata.profile.name || !metadata.profile.systemPrompt) errors.push('profile-invalid')
  if (!metadata.version?.id || !metadata.version.digest || !metadata.version.number) errors.push('version-invalid')
  if (metadata.version?.profileId !== metadata.profile?.id) errors.push('profile-version-mismatch')
  if (vizruna?.profileId !== metadata.profile?.id || vizruna?.versionId !== metadata.version?.id) errors.push('manifest-identity-mismatch')
  if (!Array.isArray(pi?.extensions) || !pi.extensions.includes('./extensions/agent-profile.ts')) errors.push('extension-missing')
  if (metadata.profile?.promptMode !== 'append' && metadata.profile?.promptMode !== 'replace') errors.push('prompt-mode-invalid')
  if (metadata.profile) {
    const digest = createHash('sha256')
      .update(serializeAgentVersionConfig(agentVersionConfigFromProfile(metadata.profile)))
      .digest('hex')
    if (digest !== metadata.version?.digest) errors.push('digest-mismatch')
  }
  return { manifest, metadata, errors }
}

function localIdentity(metadata: ImportedMetadata): PiPackageImportPlan['identityStatus'] {
  const imported = sqliteIndex.listAgentProfiles({ includeArchived: true }).find((profile) =>
    profile.importProvenance?.sourceProfileId === metadata.profile.id
    && profile.importProvenance.sourceVersionId === metadata.version.id
    && profile.importProvenance.sourceVersionDigest === metadata.version.digest)
  if (imported) return 'already-imported'
  const sameSourceIdentity = sqliteIndex.listAgentProfiles({ includeArchived: true }).some((profile) =>
    profile.importProvenance?.sourceProfileId === metadata.profile.id
    && profile.importProvenance.sourceVersionId === metadata.version.id)
  if (sameSourceIdentity) return 'conflict'
  return 'new'
}

function currentResourceMatch(
  catalog: Awaited<ReturnType<typeof collectPiResourceCenterSnapshot>>,
  dependency: AgentResolvedPiResource,
) {
  const resources = dependency.kind === 'extensions'
    ? catalog.resources.extensions
    : dependency.kind === 'skills'
      ? catalog.resources.skills
      : catalog.resources.prompts
  return resources.find((resource) => resource.name === dependency.name && resource.kind === dependency.kind)
}

export async function previewPiPackageImport(
  request: PiPackageImportPreviewRequest,
  inspectedAt = Date.now(),
): Promise<PiPackageImportPlan> {
  const workspacePath = activeWorkspace(request.workspaceId)
  const path = packageDirectory(workspacePath, request.packagePath)
  const { manifest, metadata, errors } = parseArtifact(path)
  const catalog = await collectPiResourceCenterSnapshot({ workspaceId: workspacePath })
  const declaredPackages = metadata.dependencies?.packages ?? []
  const dependencies = declaredPackages.map((dependency) => {
    const installed = catalog.packages.some((pkg) => pkg.source === dependency.source && pkg.installed)
    return { ...dependency, installed }
  })
  const externalResources = (metadata.dependencies?.resources ?? []).filter((resource) => resource.origin === 'top-level')
  const resourceMatches = externalResources.map((resource) => currentResourceMatch(catalog, resource))
  const model = await inspectFixedModel(metadata.profile.modelId)
  const readiness = buildPiDeliveryReadiness({
    versionStatus: 'candidate',
    sdkVersion: catalog.runtime.sdkVersion,
    modelId: metadata.profile.modelId,
    modelFound: model.found,
    modelAuthenticated: model.authenticated,
    toolsInherited: metadata.profile.tools === undefined,
    resourcesInherited: metadata.profile.resourceSelection?.mode === 'inherit',
    projectContextInherited: metadata.profile.resourceSelection?.projectContext === 'inherit',
    dependencyPackages: dependencies,
    missingPackageCount: 0,
    externalResourceCount: externalResources.length,
    missingResourceCount: resourceMatches.filter((resource) => !resource).length,
    disabledResourceCount: resourceMatches.filter((resource) => resource && !resource.enabled).length,
  })
  const identityStatus = localIdentity(metadata)
  return {
    inspectedAt,
    workspacePath,
    packagePath: path,
    packageName: String(manifest.name || ''),
    packageVersion: String(manifest.version || ''),
    sdkVersionAtExport: metadata.sdkVersion,
    artifactValid: errors.length === 0,
    artifactErrors: errors,
    profile: {
      id: metadata.profile.id,
      name: metadata.profile.name,
      description: metadata.profile.description,
      modelId: metadata.profile.modelId,
      thinkingLevel: metadata.profile.thinkingLevel,
    },
    version: {
      id: metadata.version.id,
      number: metadata.version.number,
      digest: metadata.version.digest,
      status: metadata.version.status,
      createdAt: metadata.version.createdAt,
    },
    identityStatus,
    localVersionStatus: 'candidate',
    readiness,
    missingPackageSources: dependencies.filter((dependency) => !dependency.installed).map((dependency) => dependency.source),
    canApply: errors.length === 0 && identityStatus !== 'conflict',
    credentialsIncluded: false,
  }
}

function remapResourceSelection(
  metadata: ImportedMetadata,
  catalog: Awaited<ReturnType<typeof collectPiResourceCenterSnapshot>>,
): AgentProfile['resourceSelection'] {
  const selection = metadata.profile.resourceSelection
  if (!selection || selection.mode === 'inherit') return selection
  const dependencies = metadata.dependencies?.packages ?? []
  const packageIds = selection.packageIds.flatMap((sourceId) => {
    const dependency = dependencies.find((entry) => entry.id === sourceId)
    const local = dependency && catalog.packages.find((entry) => entry.source === dependency.source && entry.installed)
    return local ? [local.id] : []
  })
  const declaredResources = metadata.dependencies?.resources ?? []
  const allResources = [
    ...catalog.resources.extensions,
    ...catalog.resources.skills,
    ...catalog.resources.prompts,
  ]
  const resourceIds = selection.resourceIds.flatMap((sourceId) => {
    const dependency = declaredResources.find((entry) => entry.id === sourceId)
    if (!dependency) return []
    const sourcePackage = dependency.packageId && dependencies.find((entry) => entry.id === dependency.packageId)
    const localPackageId = sourcePackage
      ? catalog.packages.find((entry) => entry.source === sourcePackage.source && entry.installed)?.id
      : undefined
    const local = allResources.find((entry) =>
      entry.kind === dependency.kind
      && entry.name === dependency.name
      && (dependency.origin !== 'package' || entry.packageId === localPackageId))
    return local ? [local.id] : []
  })
  return { ...selection, packageIds, resourceIds }
}

function importedProfile(
  metadata: ImportedMetadata,
  catalog: Awaited<ReturnType<typeof collectPiResourceCenterSnapshot>>,
  packageName: string,
  packageVersion: string,
  now: number,
): AgentProfile {
  return {
    id: randomUUID(),
    name: metadata.profile.name,
    description: metadata.profile.description,
    systemPrompt: metadata.profile.systemPrompt,
    promptMode: metadata.profile.promptMode,
    modelId: metadata.profile.modelId,
    thinkingLevel: metadata.profile.thinkingLevel,
    tools: metadata.profile.tools,
    extensionTools: metadata.profile.extensionTools,
    resourceSelection: remapResourceSelection(metadata, catalog),
    providerRequirements: metadata.profile.providerRequirements,
    importProvenance: {
      packageName,
      packageVersion,
      sourceProfileId: metadata.profile.id,
      sourceVersionId: metadata.version.id,
      sourceVersionNumber: metadata.version.number,
      sourceVersionDigest: metadata.version.digest,
      sourceVersionStatus: metadata.version.status,
      importedAt: now,
    },
    status: 'active',
    createdAt: now,
    updatedAt: now,
  }
}

export async function applyPiPackageImport(
  request: PiPackageImportApplyRequest,
): Promise<PiPackageImportApplyResponse> {
  const plan = await previewPiPackageImport(request)
  if (!plan.canApply) throw new Error('Pi Package import contains blocking identity or integrity issues')
  const { metadata } = parseArtifact(plan.packagePath)
  const installedSources: string[] = []
  let workerReload: PiPackageImportApplyResponse['workerReload'] = 'not-running'
  if (request.installDependencies) {
    for (const source of plan.missingPackageSources) {
      const scope = metadata.dependencies?.packages?.find((dependency) => dependency.source === source)?.scope ?? 'project'
      const result = await mutatePiPackage({ workspaceId: plan.workspacePath, action: 'install', source, scope, confirmed: true })
      installedSources.push(source)
      workerReload = result.workerReload
    }
  }
  if (request.installAgentPackage) {
    const result = await mutatePiPackage({ workspaceId: plan.workspacePath, action: 'install', source: plan.packagePath, scope: 'project', confirmed: true })
    installedSources.push(plan.packagePath)
    workerReload = result.workerReload
  }
  let profile: AgentProfile | undefined
  let version: AgentVersion | undefined
  if (request.importConfiguration) {
    if (plan.identityStatus === 'already-imported') {
      profile = sqliteIndex.listAgentProfiles({ includeArchived: true }).find((entry) =>
        entry.importProvenance?.sourceVersionId === metadata.version.id
        && entry.importProvenance.sourceVersionDigest === metadata.version.digest)
      version = profile ? sqliteIndex.getLatestAgentVersion(profile.id) ?? undefined : undefined
    } else {
      const now = Date.now()
      const catalog = await collectPiResourceCenterSnapshot({ workspaceId: plan.workspacePath })
      profile = importedProfile(metadata, catalog, plan.packageName, plan.packageVersion, now)
      if (!sqliteIndex.saveAgentProfile(profile)) {
        throw new Error('Imported Agent configuration could not be stored')
      }
      version = ensureAgentVersion(profile, now)
    }
  }
  auditRepository.write({
    category: 'operation',
    action: 'pi.package-studio.import',
    outcome: 'success',
    workspaceId: plan.workspacePath,
    details: {
      packagePath: plan.packagePath,
      profileId: metadata.profile.id,
      sourceVersionId: metadata.version.id,
      importedAsCandidate: Boolean(request.importConfiguration),
      installedDependencyCount: request.installDependencies ? plan.missingPackageSources.length : 0,
      installedAgentPackage: request.installAgentPackage,
    },
  })
  return { ok: true, plan: await previewPiPackageImport(request), profile, version, installedSources, workerReload }
}

export const piPackageImportTestApi = { packageDirectory, parseArtifact, localIdentity }
