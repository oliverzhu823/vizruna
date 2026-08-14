import type { AgentProfile, AgentPiResourceSnapshot } from './agent-profile'
import type { AgentVersion } from './agent-version'
import type { PiResourceCenterPackage } from './pi-resource-center'

export type PiPackageStudioIssueSeverity = 'warning' | 'error'

export type PiPackageStudioIssueCode =
  | 'project-untrusted'
  | 'inherit-resources'
  | 'inherit-model'
  | 'inherit-thinking'
  | 'inherit-tools'
  | 'project-context-external'
  | 'external-package-dependencies'
  | 'external-resource-dependencies'
  | 'package-missing'
  | 'resource-missing'
  | 'resource-disabled'
  | 'replace-system-prompt'
  | 'version-unvalidated'

export interface PiPackageStudioIssue {
  code: PiPackageStudioIssueCode
  severity: PiPackageStudioIssueSeverity
  count?: number
  ids?: string[]
}

export interface PiPackageStudioDependencyPackage {
  id: string
  source: string
  name: string
  version?: string
  scope: 'user' | 'project'
  installed: boolean
}

export type PiDeliveryReadinessStatus = 'ready' | 'needs-setup' | 'blocked'
export type PiDeliveryCheckStatus = 'ready' | 'action' | 'blocked'
export type PiDeliveryCheckCode =
  | 'validation'
  | 'runtime'
  | 'model'
  | 'provider-auth'
  | 'pi-packages'
  | 'pi-resources'
  | 'project-context'
  | 'tool-policy'

export interface PiDeliveryCheck {
  code: PiDeliveryCheckCode
  status: PiDeliveryCheckStatus
  value?: string
  count?: number
}

export interface PiDeliveryReadiness {
  status: PiDeliveryReadinessStatus
  checks: PiDeliveryCheck[]
  /** Explicit reminder: authentication material is never part of a delivery artifact. */
  credentialsIncluded: false
}

export interface PiPackageStudioPlan {
  generatedAt: number
  workspacePath: string
  sdkVersion: string
  profile: Pick<AgentProfile, 'id' | 'name' | 'description' | 'updatedAt'>
  version: Pick<AgentVersion, 'id' | 'number' | 'digest' | 'status' | 'validation' | 'createdAt'>
  packageName: string
  packageVersion: string
  directoryName: string
  files: string[]
  installable: boolean
  portable: boolean
  issues: PiPackageStudioIssue[]
  delivery: PiDeliveryReadiness
  dependencies: {
    packages: PiPackageStudioDependencyPackage[]
    resources: AgentPiResourceSnapshot['resources']
  }
  effectiveTools?: string[]
  resourceSnapshot: AgentPiResourceSnapshot
}

export interface PiPackageStudioPreviewRequest {
  profileId: string
  versionId: string
  workspaceId?: string
}

export interface PiPackageStudioPreviewResponse {
  plan: PiPackageStudioPlan
}

export interface PiPackageStudioExportRequest extends PiPackageStudioPreviewRequest {
  install: boolean
  confirmed: true
}

export interface PiPackageStudioExportResponse {
  ok: true
  plan: PiPackageStudioPlan
  packagePath: string
  packageSource: string
  installed: boolean
  workerReload: 'reloaded' | 'deferred' | 'not-running'
}

export type PiPackageImportIdentityStatus = 'new' | 'already-imported' | 'conflict'

export interface PiPackageImportPlan {
  inspectedAt: number
  workspacePath: string
  packagePath: string
  packageName: string
  packageVersion: string
  sdkVersionAtExport: string
  artifactValid: boolean
  artifactErrors: string[]
  profile: Pick<AgentProfile, 'id' | 'name' | 'description' | 'modelId' | 'thinkingLevel'>
  version: Pick<AgentVersion, 'id' | 'number' | 'digest' | 'status' | 'createdAt'>
  identityStatus: PiPackageImportIdentityStatus
  /** Imported external evidence never bypasses local evaluation. */
  localVersionStatus: 'candidate'
  readiness: PiDeliveryReadiness
  missingPackageSources: string[]
  canApply: boolean
  credentialsIncluded: false
}

export interface PiPackageImportPreviewRequest {
  workspaceId?: string
  packagePath: string
}

export interface PiPackageImportPreviewResponse {
  plan: PiPackageImportPlan
}

export interface PiPackageImportApplyRequest extends PiPackageImportPreviewRequest {
  installAgentPackage: boolean
  installDependencies: boolean
  importConfiguration: boolean
  confirmed: true
}

export interface PiPackageImportApplyResponse {
  ok: true
  plan: PiPackageImportPlan
  profile?: AgentProfile
  version?: AgentVersion
  installedSources: string[]
  workerReload: 'reloaded' | 'deferred' | 'not-running'
}

export const PI_PACKAGE_STUDIO_FILES = [
  'package.json',
  'README.md',
  'DELIVERY_CHECKLIST.md',
  'vizruna-agent.json',
  'extensions/agent-profile.ts',
] as const

export function buildPiDeliveryReadiness(input: {
  versionStatus: AgentVersion['status']
  sdkVersion: string
  modelId?: string
  modelFound?: boolean
  modelAuthenticated?: boolean
  toolsInherited: boolean
  resourcesInherited: boolean
  projectContextInherited: boolean
  dependencyPackages: PiPackageStudioDependencyPackage[]
  missingPackageCount: number
  externalResourceCount: number
  missingResourceCount: number
  disabledResourceCount: number
}): PiDeliveryReadiness {
  const checks: PiDeliveryCheck[] = [
    {
      code: 'validation',
      status: input.versionStatus === 'validated' || input.versionStatus === 'released' ? 'ready' : 'blocked',
      value: input.versionStatus,
    },
    { code: 'runtime', status: input.sdkVersion ? 'ready' : 'blocked', value: input.sdkVersion },
  ]
  if (!input.modelId) {
    checks.push({ code: 'model', status: 'action', value: 'inherit' })
    checks.push({ code: 'provider-auth', status: 'action', value: 'inherit' })
  } else if (!input.modelFound) {
    checks.push({ code: 'model', status: 'blocked', value: input.modelId })
    checks.push({ code: 'provider-auth', status: 'action', value: input.modelId.split('/')[0] })
  } else {
    checks.push({ code: 'model', status: 'ready', value: input.modelId })
    checks.push({
      code: 'provider-auth',
      status: input.modelAuthenticated ? 'ready' : 'action',
      value: input.modelId.split('/')[0],
    })
  }
  const missingPackages = input.missingPackageCount
    + input.dependencyPackages.filter((pkg) => !pkg.installed).length
  checks.push({
    code: 'pi-packages',
    status: missingPackages > 0 ? 'blocked' : input.dependencyPackages.length > 0 ? 'action' : 'ready',
    count: input.dependencyPackages.length,
  })
  checks.push({
    code: 'pi-resources',
    status: input.missingResourceCount > 0 || input.disabledResourceCount > 0
      ? 'blocked'
      : input.resourcesInherited || input.externalResourceCount > 0
        ? 'action'
        : 'ready',
    count: input.externalResourceCount,
  })
  checks.push({
    code: 'project-context',
    status: input.projectContextInherited ? 'action' : 'ready',
  })
  checks.push({ code: 'tool-policy', status: input.toolsInherited ? 'action' : 'ready' })
  return {
    status: checks.some((check) => check.status === 'blocked')
      ? 'blocked'
      : checks.some((check) => check.status === 'action')
        ? 'needs-setup'
        : 'ready',
    checks,
    credentialsIncluded: false,
  }
}

export function piPackageSlug(name: string, profileId: string): string {
  const ascii = name
    .normalize('NFKD')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 42)
  return ascii || `agent-${profileId.replace(/-/g, '').slice(0, 8)}`
}

export function buildPiPackageStudioIssues(input: {
  profile: AgentProfile
  resourceSnapshot: AgentPiResourceSnapshot
  packages: PiResourceCenterPackage[]
  projectTrusted: boolean
  versionStatus?: AgentVersion['status']
}): PiPackageStudioIssue[] {
  const { profile, resourceSnapshot } = input
  const issues: PiPackageStudioIssue[] = []
  if (input.versionStatus !== 'validated' && input.versionStatus !== 'released') {
    issues.push({ code: 'version-unvalidated', severity: 'error' })
  }
  const dependencyPackageIds = new Set([
    ...resourceSnapshot.selectedPackageIds,
    ...resourceSnapshot.resources.flatMap((resource) =>
      resource.packageId ? [resource.packageId] : [],
    ),
  ])
  const selectedPackages = input.packages.filter((pkg) => dependencyPackageIds.has(pkg.id))
  const topLevelResources = resourceSnapshot.resources.filter(
    (resource) => resource.origin === 'top-level',
  )
  if (!input.projectTrusted) issues.push({ code: 'project-untrusted', severity: 'error' })
  if (resourceSnapshot.mode === 'inherit') {
    issues.push({ code: 'inherit-resources', severity: 'warning' })
  }
  if (!profile.modelId) issues.push({ code: 'inherit-model', severity: 'warning' })
  if (!profile.thinkingLevel) issues.push({ code: 'inherit-thinking', severity: 'warning' })
  if (profile.tools === undefined) issues.push({ code: 'inherit-tools', severity: 'warning' })
  if (resourceSnapshot.projectContext === 'inherit') {
    issues.push({ code: 'project-context-external', severity: 'warning' })
  }
  if (selectedPackages.length > 0) {
    issues.push({
      code: 'external-package-dependencies',
      severity: 'warning',
      count: selectedPackages.length,
      ids: selectedPackages.map((pkg) => pkg.id),
    })
  }
  if (topLevelResources.length > 0) {
    issues.push({
      code: 'external-resource-dependencies',
      severity: 'warning',
      count: topLevelResources.length,
      ids: topLevelResources.map((resource) => resource.id),
    })
  }
  const missingPackages = [...dependencyPackageIds].filter(
    (id) => !input.packages.find((pkg) => pkg.id === id)?.installed,
  )
  if (missingPackages.length > 0) {
    issues.push({
      code: 'package-missing',
      severity: 'error',
      count: missingPackages.length,
      ids: missingPackages,
    })
  }
  if (resourceSnapshot.missingResourceIds.length > 0) {
    issues.push({
      code: 'resource-missing',
      severity: 'error',
      count: resourceSnapshot.missingResourceIds.length,
      ids: [...resourceSnapshot.missingResourceIds],
    })
  }
  if (resourceSnapshot.disabledResourceIds.length > 0) {
    issues.push({
      code: 'resource-disabled',
      severity: 'error',
      count: resourceSnapshot.disabledResourceIds.length,
      ids: [...resourceSnapshot.disabledResourceIds],
    })
  }
  if (profile.promptMode === 'replace') {
    issues.push({ code: 'replace-system-prompt', severity: 'warning' })
  }
  return issues
}
