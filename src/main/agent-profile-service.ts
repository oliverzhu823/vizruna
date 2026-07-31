import type {
  AgentProfile,
  AgentProfileSnapshot,
  SessionAgentBinding,
} from '@shared/agent-profile'
import { sqliteIndex } from './sqlite-index'

export function snapshotAgentProfile(
  profile: AgentProfile,
  capturedAt = Date.now(),
): AgentProfileSnapshot {
  return {
    profileId: profile.id,
    name: profile.name,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    promptMode: profile.promptMode,
    modelId: profile.modelId,
    thinkingLevel: profile.thinkingLevel,
    tools: profile.tools ? [...profile.tools] : profile.tools,
    capturedAt,
  }
}

export function requireActiveAgentProfileSnapshot(profileId: string): AgentProfileSnapshot {
  const profile = sqliteIndex.getAgentProfile(profileId)
  if (!profile) throw new Error('Agent configuration not found')
  if (profile.status !== 'active') throw new Error('Agent configuration is archived')
  return snapshotAgentProfile(profile)
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
