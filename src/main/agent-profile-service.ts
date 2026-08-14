import type {
  AgentProfile,
  AgentPiResourceSnapshot,
  AgentProfileSnapshot,
  SessionAgentBinding,
} from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'
import { resolveAgentPiResourceSnapshot } from '@shared/agent-composer'
import {
  evaluateAgentProviderRequirements,
  hasAgentProviderRequirements,
} from '@shared/agent-provider-requirements'
import { getActiveSdkModule } from './ipc/sdk-session'
import { collectPiResourceCenterSnapshot } from './pi-resource-center-service'
import { sqliteIndex } from './sqlite-index'
import {
  ensureAgentVersion,
  profileAtAgentVersion,
  requireAgentVersion,
} from './agent-version-service'

export function snapshotAgentProfile(
  profile: AgentProfile,
  capturedAt = Date.now(),
  resourceSnapshot?: AgentPiResourceSnapshot,
  version?: AgentVersion,
): AgentProfileSnapshot {
  return {
    profileId: profile.id,
    versionId: version?.id,
    versionNumber: version?.number,
    versionDigest: version?.digest,
    name: profile.name,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    promptMode: profile.promptMode,
    modelId: profile.modelId,
    thinkingLevel: profile.thinkingLevel,
    tools: profile.tools ? [...profile.tools] : profile.tools,
    extensionTools: profile.extensionTools
      ? [...profile.extensionTools]
      : profile.extensionTools,
    providerRequirements: profile.providerRequirements
      ? { ...profile.providerRequirements }
      : undefined,
    resourceSnapshot: resourceSnapshot
      ? {
          ...resourceSnapshot,
          selectedPackageIds: [...resourceSnapshot.selectedPackageIds],
          selectedResourceIds: [...resourceSnapshot.selectedResourceIds],
          resources: resourceSnapshot.resources.map((resource) => ({ ...resource })),
          missingPackageIds: [...resourceSnapshot.missingPackageIds],
          missingResourceIds: [...resourceSnapshot.missingResourceIds],
          disabledResourceIds: [...resourceSnapshot.disabledResourceIds],
        }
      : undefined,
    capturedAt,
  }
}

export function requireActiveAgentProfileSnapshot(profileId: string): AgentProfileSnapshot {
  const profile = sqliteIndex.getAgentProfile(profileId)
  if (!profile) throw new Error('Agent configuration not found')
  if (profile.status !== 'active') throw new Error('Agent configuration is archived')
  const version = ensureAgentVersion(profile)
  return snapshotAgentProfile(profileAtAgentVersion(profile, version), Date.now(), undefined, version)
}

export async function resolveActiveAgentProfileSnapshot(
  profileId: string,
  workspaceId?: string,
  versionId?: string,
): Promise<AgentProfileSnapshot> {
  const currentProfile = sqliteIndex.getAgentProfile(profileId)
  if (!currentProfile) throw new Error('Agent configuration not found')
  if (currentProfile.status !== 'active') throw new Error('Agent configuration is archived')
  const version = versionId
    ? requireAgentVersion(versionId, profileId)
    : ensureAgentVersion(currentProfile)
  const profile = profileAtAgentVersion(currentProfile, version)
  if (hasAgentProviderRequirements(profile.providerRequirements)) {
    const sdk = await getActiveSdkModule()
    const runtime = await sdk.ModelRuntime.create({ allowModelNetwork: false })
    const models = await runtime.getAvailable()
    const issues = evaluateAgentProviderRequirements(
      profile.modelId,
      models.map((model) => ({
        id: model.id,
        provider: model.provider,
        reasoning: model.reasoning === true,
        input: model.input?.length ? [...model.input] : ['text'],
        contextWindow: model.contextWindow || 0,
      })),
      profile.providerRequirements,
    )
    if (issues.length > 0) {
      throw new Error(`AGENT_PROVIDER_REQUIREMENTS_UNMET:${issues.join(',')}`)
    }
  }
  const capturedAt = Date.now()
  const catalog = await collectPiResourceCenterSnapshot({ workspaceId })
  const { resourceSnapshot, warnings } = resolveAgentPiResourceSnapshot(
    profile.resourceSelection,
    catalog,
    capturedAt,
  )
  const hardResourceWarnings = warnings.filter((warning) => (
    warning.code === 'package-missing' ||
    warning.code === 'resource-missing' ||
    warning.code === 'resource-disabled'
  ))
  if (hardResourceWarnings.length > 0) {
    throw new Error(`AGENT_PI_RESOURCES_UNMET:${hardResourceWarnings.map((warning) => warning.code).join(',')}`)
  }
  return snapshotAgentProfile(profile, capturedAt, resourceSnapshot, version)
}

export function saveSessionAgentBinding(input: {
  sessionId: string
  sessionFile: string
  snapshot: AgentProfileSnapshot
}): SessionAgentBinding {
  const binding: SessionAgentBinding = {
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    profileId: input.snapshot.profileId,
    snapshot: input.snapshot,
    createdAt: Date.now(),
  }
  if (!sqliteIndex.bindSessionAgent(binding)) {
    throw new Error('Agent conversation binding store is unavailable')
  }
  return binding
}

export function getSessionAgentBinding(options: {
  sessionId?: string
  sessionFile?: string
}): SessionAgentBinding | null {
  return sqliteIndex.getSessionAgentBinding(options)
}

/** Forks and clones keep the source conversation's fixed Agent snapshot. */
export function inheritSessionAgentBinding(input: {
  sourceSessionFile: string
  sessionId?: string
  sessionFile?: string
}): SessionAgentBinding | undefined {
  if (!input.sessionId || !input.sessionFile) return undefined
  const source = getSessionAgentBinding({ sessionFile: input.sourceSessionFile })
  if (!source) return undefined
  return saveSessionAgentBinding({
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    snapshot: source.snapshot,
  })
}
