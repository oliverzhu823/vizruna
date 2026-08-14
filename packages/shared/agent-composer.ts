import type {
  AgentEffectiveConfigWarning,
  AgentPiResourceSelection,
  AgentPiResourceSnapshot,
  AgentResolvedPiResource,
} from './agent-profile'
import type {
  PiResourceCenterItem,
  PiResourceCenterSnapshot,
} from './pi-resource-center'

export const DEFAULT_AGENT_PI_RESOURCE_SELECTION: AgentPiResourceSelection = {
  mode: 'inherit',
  packageIds: [],
  resourceIds: [],
  projectContext: 'inherit',
}

export function normalizeAgentPiResourceSelection(
  selection?: AgentPiResourceSelection,
): AgentPiResourceSelection {
  return {
    mode: selection?.mode === 'selected' ? 'selected' : 'inherit',
    packageIds: [...new Set(selection?.packageIds ?? [])],
    resourceIds: [...new Set(selection?.resourceIds ?? [])],
    projectContext: selection?.projectContext === 'none' ? 'none' : 'inherit',
  }
}

function runtimeResource(item: PiResourceCenterItem): AgentResolvedPiResource | null {
  if (item.kind === 'themes') return null
  return {
    id: item.id,
    kind: item.kind,
    name: item.name,
    path: item.path,
    source: item.source,
    scope: item.scope,
    origin: item.origin,
    packageId: item.packageId,
  }
}

export function resolveAgentPiResourceSnapshot(
  selectionInput: AgentPiResourceSelection | undefined,
  catalog: PiResourceCenterSnapshot,
  capturedAt = Date.now(),
): { resourceSnapshot: AgentPiResourceSnapshot; warnings: AgentEffectiveConfigWarning[] } {
  const selection = normalizeAgentPiResourceSelection(selectionInput)
  const packagesById = new Map(catalog.packages.map((pkg) => [pkg.id, pkg]))
  const resourceRows = [
    ...catalog.resources.extensions,
    ...catalog.resources.skills,
    ...catalog.resources.prompts,
  ]
  const resourcesById = new Map(resourceRows.map((resource) => [resource.id, resource]))
  const selectedPackageIds = new Set(selection.packageIds)
  const selectedResourceIds = new Set(selection.resourceIds)
  const missingPackageIds = selection.packageIds.filter((id) => !packagesById.has(id))
  const missingResourceIds = selection.resourceIds.filter((id) => !resourcesById.has(id))
  const disabledResourceIds = selection.resourceIds.filter(
    (id) => resourcesById.get(id)?.enabled === false,
  )

  const resources = resourceRows
    .filter((resource) => {
      if (!resource.enabled) return false
      if (selection.mode === 'inherit') return true
      return (
        selectedResourceIds.has(resource.id) ||
        Boolean(resource.packageId && selectedPackageIds.has(resource.packageId))
      )
    })
    .map(runtimeResource)
    .filter((resource): resource is AgentResolvedPiResource => resource !== null)

  const warnings: AgentEffectiveConfigWarning[] = []
  if (selection.projectContext === 'inherit' && !catalog.runtime.projectTrusted) {
    warnings.push({ code: 'project-untrusted' })
  }
  if (
    selection.mode === 'selected' &&
    selection.packageIds.length === 0 &&
    selection.resourceIds.length === 0
  ) {
    warnings.push({ code: 'empty-selection' })
  }
  const unavailablePackages = selection.packageIds.filter(
    (id) => !packagesById.get(id)?.installed,
  )
  if (unavailablePackages.length > 0) {
    warnings.push({ code: 'package-missing', ids: unavailablePackages })
  }
  if (missingResourceIds.length > 0) {
    warnings.push({ code: 'resource-missing', ids: missingResourceIds })
  }
  if (disabledResourceIds.length > 0) {
    warnings.push({ code: 'resource-disabled', ids: disabledResourceIds })
  }

  return {
    resourceSnapshot: {
      workspacePath: catalog.workspacePath,
      sdkVersion: catalog.runtime.sdkVersion,
      mode: selection.mode,
      projectContext: selection.projectContext,
      selectedPackageIds: [...selection.packageIds],
      selectedResourceIds: [...selection.resourceIds],
      resources,
      missingPackageIds,
      missingResourceIds,
      disabledResourceIds,
      capturedAt,
    },
    warnings,
  }
}
