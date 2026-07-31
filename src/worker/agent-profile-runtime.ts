import type { ConversationRuntimeSnapshot } from '@shared/system-prompt-preset'

export type AgentPromptLoaderOverrides = {
  systemPromptOverride?: () => string
  appendSystemPromptOverride?: (base: string[]) => string[]
}

/**
 * Translate the persisted Agent snapshot into Pi's native prompt hooks.
 * Keeping this pure makes the two supported prompt modes independently testable.
 */
export function buildAgentPromptLoaderOverrides(
  profile: ConversationRuntimeSnapshot | null,
): AgentPromptLoaderOverrides {
  if (!profile) return {}
  if (profile.promptMode === 'replace') {
    return { systemPromptOverride: () => profile.systemPrompt }
  }
  return {
    appendSystemPromptOverride: (base) => [...base, profile.systemPrompt],
  }
}

export function buildAgentToolsOverride(
  profile: ConversationRuntimeSnapshot | null,
): { tools?: string[] } {
  return !profile || !('tools' in profile) || profile.tools === undefined
    ? {}
    : { tools: [...profile.tools] }
}
