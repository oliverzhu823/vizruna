import type { AgentProfile, AgentProfilePreviewResponse, AgentResolvedPiResource } from './agent-profile'

export type AgentCapabilityGroup = 'tools' | 'packages' | 'extensions' | 'skills' | 'prompts' | 'context'
export type AgentCapabilityStatus = 'ready' | 'inherited' | 'blocked'

export interface AgentCapabilityItem {
  id: string
  group: AgentCapabilityGroup
  name: string
  status: AgentCapabilityStatus
  source?: string
  scope?: 'user' | 'project' | 'temporary'
  packageId?: string
  details?: string[]
}

export interface AgentCapabilityManifest {
  groups: Record<AgentCapabilityGroup, AgentCapabilityItem[]>
  totals: { ready: number; inherited: number; blocked: number }
  canRun: boolean
}

const GROUPS: AgentCapabilityGroup[] = ['tools', 'packages', 'extensions', 'skills', 'prompts', 'context']

function emptyGroups(): AgentCapabilityManifest['groups'] {
  return { tools: [], packages: [], extensions: [], skills: [], prompts: [], context: [] }
}

function resourceItem(resource: AgentResolvedPiResource, details?: string[]): AgentCapabilityItem {
  return {
    id: resource.id,
    group: resource.kind,
    name: resource.name,
    status: 'ready',
    source: resource.source,
    scope: resource.scope,
    packageId: resource.packageId,
    ...(details?.length ? { details } : {}),
  }
}

export function buildAgentCapabilityManifest(
  profile: AgentProfile,
  preview: AgentProfilePreviewResponse,
): AgentCapabilityManifest {
  const groups = emptyGroups()
  const catalogResources = Object.values(preview.catalog?.resources ?? {}).flat()
  const catalogById = new Map(catalogResources.map((resource) => [resource.id, resource]))
  const packageById = new Map((preview.catalog?.packages ?? []).map((pkg) => [pkg.id, pkg]))

  if (profile.tools === undefined) {
    groups.tools.push({ id: 'tools:inherit', group: 'tools', name: 'inherit', status: 'inherited' })
  } else {
    groups.tools.push(...profile.tools.map((name) => ({ id: `tool:${name}`, group: 'tools' as const, name, status: 'ready' as const })))
  }

  for (const packageId of preview.resourceSnapshot.selectedPackageIds) {
    const pkg = packageById.get(packageId)
    const missing = preview.resourceSnapshot.missingPackageIds.includes(packageId)
    groups.packages.push({
      id: packageId,
      group: 'packages',
      name: pkg?.name || packageId,
      status: missing ? 'blocked' : 'ready',
      source: pkg?.source,
      scope: pkg?.scope,
    })
  }

  for (const resource of preview.resourceSnapshot.resources) {
    const catalog = catalogById.get(resource.id)
    groups[resource.kind].push(resourceItem(resource, resource.kind === 'extensions' ? catalog?.tools : undefined))
  }

  for (const resourceId of preview.resourceSnapshot.missingResourceIds) {
    const catalog = catalogById.get(resourceId)
    const group = catalog?.kind === 'themes' || !catalog ? 'extensions' : catalog.kind
    groups[group].push({ id: resourceId, group, name: catalog?.name || resourceId, status: 'blocked', source: catalog?.source, scope: catalog?.scope, packageId: catalog?.packageId })
  }
  for (const resourceId of preview.resourceSnapshot.disabledResourceIds) {
    if (groups.extensions.concat(groups.skills, groups.prompts).some((item) => item.id === resourceId)) continue
    const catalog = catalogById.get(resourceId)
    const group = catalog?.kind === 'themes' || !catalog ? 'extensions' : catalog.kind
    groups[group].push({ id: resourceId, group, name: catalog?.name || resourceId, status: 'blocked', source: catalog?.source, scope: catalog?.scope, packageId: catalog?.packageId })
  }

  if (preview.resourceSnapshot.mode === 'inherit' && preview.resourceSnapshot.resources.length === 0) {
    groups.packages.push({ id: 'packages:inherit', group: 'packages', name: 'inherit', status: 'inherited' })
  }
  groups.context.push({
    id: 'project-context',
    group: 'context',
    name: preview.resourceSnapshot.projectContext,
    status: preview.warnings.some((warning) => warning.code === 'project-untrusted')
      ? 'blocked'
      : preview.resourceSnapshot.projectContext === 'inherit' ? 'inherited' : 'ready',
    source: preview.resourceSnapshot.workspacePath,
    scope: 'project',
  })

  const items = GROUPS.flatMap((group) => groups[group])
  const totals = {
    ready: items.filter((item) => item.status === 'ready').length,
    inherited: items.filter((item) => item.status === 'inherited').length,
    blocked: items.filter((item) => item.status === 'blocked').length,
  }
  return { groups, totals, canRun: totals.blocked === 0 }
}
