import type {
  AgentProfileSnapshot,
  AgentPromptMode,
  SessionAgentBinding,
} from './agent-profile'

export type SystemPromptPresetStatus = 'active' | 'archived'

export interface SystemPromptPreset {
  id: string
  name: string
  description?: string
  systemPrompt: string
  promptMode: AgentPromptMode
  status: SystemPromptPresetStatus
  createdAt: number
  updatedAt: number
}

export interface SystemPromptSnapshot {
  source: 'preset' | 'temporary'
  presetId?: string
  name: string
  description?: string
  systemPrompt: string
  promptMode: AgentPromptMode
  capturedAt: number
}

export type ConversationRuntimeSnapshot = AgentProfileSnapshot | SystemPromptSnapshot

export interface SessionPromptBinding {
  sessionId: string
  sessionFile: string
  presetId?: string
  snapshot: SystemPromptSnapshot
  createdAt: number
}

export type ConversationConfigBinding =
  | {
      kind: 'agent'
      sessionId: string
      sessionFile: string
      snapshot: AgentProfileSnapshot
      createdAt: number
    }
  | {
      kind: 'prompt'
      sessionId: string
      sessionFile: string
      snapshot: SystemPromptSnapshot
      createdAt: number
    }

export type ConversationConfigSelection =
  | { kind: 'agent'; profileId: string }
  | { kind: 'prompt'; presetId: string }
  | {
      kind: 'temporaryPrompt'
      name: string
      systemPrompt: string
      promptMode: AgentPromptMode
    }

export interface SystemPromptPresetListRequest {
  includeArchived?: boolean
}

export interface SystemPromptPresetListResponse {
  presets: SystemPromptPreset[]
}

export interface SystemPromptPresetCreateRequest {
  name: string
  description?: string
  systemPrompt: string
  promptMode: AgentPromptMode
}

export interface SystemPromptPresetUpdateRequest {
  id: string
  name?: string
  description?: string
  systemPrompt?: string
  promptMode?: AgentPromptMode
}

export interface SystemPromptPresetArchiveRequest {
  id: string
}

export interface SystemPromptPresetMutationResponse {
  preset: SystemPromptPreset
}

export interface ConversationConfigBindingGetRequest {
  sessionId?: string
  sessionFile?: string
}

export interface ConversationConfigBindingGetResponse {
  binding: ConversationConfigBinding | null
}

export function conversationBindingFromAgent(
  binding: SessionAgentBinding,
): ConversationConfigBinding {
  return {
    kind: 'agent',
    sessionId: binding.sessionId,
    sessionFile: binding.sessionFile,
    snapshot: binding.snapshot,
    createdAt: binding.createdAt,
  }
}
