import type {
  ConversationConfigBinding,
  ConversationConfigSelection,
  ConversationRuntimeSnapshot,
  SessionPromptBinding,
  SystemPromptPreset,
  SystemPromptSnapshot,
} from '@shared/system-prompt-preset'
import { conversationBindingFromAgent } from '@shared/system-prompt-preset'
import {
  getSessionAgentBinding,
  requireActiveAgentProfileSnapshot,
  saveSessionAgentBinding,
} from './agent-profile-service'
import { sqliteIndex } from './sqlite-index'

export function snapshotSystemPromptPreset(
  preset: SystemPromptPreset,
  capturedAt = Date.now(),
): SystemPromptSnapshot {
  return {
    source: 'preset',
    presetId: preset.id,
    name: preset.name,
    description: preset.description,
    systemPrompt: preset.systemPrompt,
    promptMode: preset.promptMode,
    capturedAt,
  }
}

export function requireActiveSystemPromptSnapshot(presetId: string): SystemPromptSnapshot {
  const preset = sqliteIndex.getSystemPromptPreset(presetId)
  if (!preset) throw new Error('System prompt not found')
  if (preset.status !== 'active') throw new Error('System prompt is archived')
  return snapshotSystemPromptPreset(preset)
}

export function resolveConversationConfigSnapshot(
  selection?: ConversationConfigSelection,
): ConversationRuntimeSnapshot | undefined {
  if (!selection) return undefined
  if (selection.kind === 'agent') {
    return requireActiveAgentProfileSnapshot(selection.profileId)
  }
  if (selection.kind === 'prompt') {
    return requireActiveSystemPromptSnapshot(selection.presetId)
  }
  return {
    source: 'temporary',
    name: selection.name,
    systemPrompt: selection.systemPrompt,
    promptMode: selection.promptMode,
    capturedAt: Date.now(),
  }
}

function saveSessionPromptBinding(input: {
  sessionId: string
  sessionFile: string
  snapshot: SystemPromptSnapshot
}): SessionPromptBinding {
  const binding: SessionPromptBinding = {
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    presetId: input.snapshot.presetId,
    snapshot: input.snapshot,
    createdAt: Date.now(),
  }
  if (!sqliteIndex.bindSessionPrompt(binding)) {
    throw new Error('System prompt conversation binding store is unavailable')
  }
  return binding
}

export function saveConversationConfigBinding(input: {
  sessionId: string
  sessionFile: string
  snapshot: ConversationRuntimeSnapshot
}): ConversationConfigBinding {
  if ('profileId' in input.snapshot) {
    return conversationBindingFromAgent(
      saveSessionAgentBinding({
        sessionId: input.sessionId,
        sessionFile: input.sessionFile,
        snapshot: input.snapshot,
      }),
    )
  }
  const binding = saveSessionPromptBinding({
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    snapshot: input.snapshot,
  })
  return {
    kind: 'prompt',
    sessionId: binding.sessionId,
    sessionFile: binding.sessionFile,
    snapshot: binding.snapshot,
    createdAt: binding.createdAt,
  }
}

export function getConversationConfigBinding(options: {
  sessionId?: string
  sessionFile?: string
}): ConversationConfigBinding | null {
  const agentBinding = getSessionAgentBinding(options)
  if (agentBinding) return conversationBindingFromAgent(agentBinding)
  const promptBinding = sqliteIndex.getSessionPromptBinding(options)
  if (!promptBinding) return null
  return {
    kind: 'prompt',
    sessionId: promptBinding.sessionId,
    sessionFile: promptBinding.sessionFile,
    snapshot: promptBinding.snapshot,
    createdAt: promptBinding.createdAt,
  }
}

export function inheritConversationConfigBinding(input: {
  sourceSessionFile: string
  sessionId?: string
  sessionFile?: string
}): ConversationConfigBinding | undefined {
  if (!input.sessionId || !input.sessionFile) return undefined
  const source = getConversationConfigBinding({ sessionFile: input.sourceSessionFile })
  if (!source) return undefined
  return saveConversationConfigBinding({
    sessionId: input.sessionId,
    sessionFile: input.sessionFile,
    snapshot: source.snapshot,
  })
}
