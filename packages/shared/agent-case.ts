export type AgentCaseStatus = 'draft' | 'validated' | 'archived'

/**
 * A reusable Studio asset linked to the conversation that produced it.
 * Conversation bodies and credentials deliberately stay in their source stores.
 */
export interface AgentCase {
  id: string
  name: string
  summary?: string
  tags: string[]
  status: AgentCaseStatus
  workspacePath: string
  sourceSessionId: string
  sourceSessionFile: string
  modelId?: string
  thinkingLevel?: string
  createdAt: number
  updatedAt: number
}

export interface AgentCaseListRequest {
  workspacePath?: string
  includeArchived?: boolean
}

export interface AgentCaseListResponse {
  cases: AgentCase[]
}

export interface AgentCaseCreateRequest {
  name: string
  summary?: string
  tags?: string[]
  workspacePath: string
  sourceSessionId: string
  sourceSessionFile: string
  modelId?: string
  thinkingLevel?: string
}

export interface AgentCaseUpdateRequest {
  id: string
  name?: string
  summary?: string
  tags?: string[]
  status?: Exclude<AgentCaseStatus, 'archived'>
}

export interface AgentCaseArchiveRequest {
  id: string
}

export interface AgentCaseMutationResponse {
  agentCase: AgentCase
}
