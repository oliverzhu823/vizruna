export type AgentPromptMode = 'append' | 'replace'
export type AgentProfileStatus = 'active' | 'archived'

/**
 * A reusable, user-managed Agent configuration.
 *
 * `undefined` model/thinking/tools means "inherit the current conversation
 * defaults". An empty tools array deliberately creates a tool-less Agent.
 */
export interface AgentProfile {
  id: string
  name: string
  description?: string
  systemPrompt: string
  promptMode: AgentPromptMode
  modelId?: string
  thinkingLevel?: string
  tools?: string[]
  status: AgentProfileStatus
  createdAt: number
  updatedAt: number
}

/**
 * Immutable runtime copy captured when a conversation is created.
 * Later profile edits must not alter an existing conversation.
 */
export interface AgentProfileSnapshot {
  profileId: string
  name: string
  description?: string
  systemPrompt: string
  promptMode: AgentPromptMode
  modelId?: string
  thinkingLevel?: string
  tools?: string[]
  capturedAt: number
}

export interface SessionAgentBinding {
  sessionId: string
  sessionFile: string
  profileId: string
  snapshot: AgentProfileSnapshot
  createdAt: number
}

export interface AgentProfileListRequest {
  includeArchived?: boolean
}

export interface AgentProfileListResponse {
  profiles: AgentProfile[]
}

export interface AgentProfileCreateRequest {
  name: string
  description?: string
  systemPrompt: string
  promptMode: AgentPromptMode
  modelId?: string
  thinkingLevel?: string
  tools?: string[]
}

export interface AgentProfileUpdateRequest {
  id: string
  name?: string
  description?: string
  systemPrompt?: string
  promptMode?: AgentPromptMode
  modelId?: string | null
  thinkingLevel?: string | null
  tools?: string[] | null
}

export interface AgentProfileArchiveRequest {
  id: string
}

export interface AgentProfileMutationResponse {
  profile: AgentProfile
}

export interface SessionAgentBindingGetRequest {
  sessionId?: string
  sessionFile?: string
}

export interface SessionAgentBindingGetResponse {
  binding: SessionAgentBinding | null
}
