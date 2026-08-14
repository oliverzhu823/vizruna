import type { RunContextSnapshot, RunResourceEvidence } from './app-events'
import type { AgentPiResourceSnapshot } from './agent-profile'

export type AgentRunHistoryStatus = 'running' | 'completed' | 'failed'

export interface AgentRunArtifact {
  kind: 'case' | 'file'
  id?: string
  name: string
  path?: string
}

export interface AgentRunHistoryItem {
  sessionId: string
  sessionFile: string
  workspacePath: string
  title: string
  /** Original first user task, kept separately from the shortened display title. */
  prompt?: string
  profileId: string
  versionId?: string
  versionNumber?: number
  modelId?: string
  thinkingLevel?: string
  status: AgentRunHistoryStatus
  failureReason?: string
  messageCount: number
  createdAt: number
  updatedAt: number
  artifacts: AgentRunArtifact[]
  caseId?: string
  runtimeEvidence?: {
    resourceEvidence?: RunResourceEvidence
    contextBefore?: RunContextSnapshot
    contextAfter?: RunContextSnapshot
    runId?: string
    capturedAt: number
  }
  capabilitySnapshot?: {
    tools?: string[]
    extensionTools?: string[]
    resourceSnapshot?: AgentPiResourceSnapshot
  }
  observability?: AgentRunObservability
  turns?: AgentRunTurnEvidence[]
}

export interface AgentRunTurnEvidence {
  runId: string
  turnId?: string
  status: 'running' | 'completed' | 'failed' | 'cancelled'
  startedAt: number
  endedAt?: number
  contextBefore?: RunContextSnapshot
  contextAfter?: RunContextSnapshot
  resourceEvidence?: RunResourceEvidence
  usage: { input: number; output: number; cacheRead: number; cacheWrite: number; cost: number }
  tools: Array<{ name: string; calls: number; failed: number }>
  compactions: { count: number; tokensSaved: number }
  files: string[]
  errors: string[]
}

export type AgentRunSignalCode =
  | 'context-high'
  | 'context-critical'
  | 'context-grew'
  | 'compacted'
  | 'tool-failures'

export interface AgentRunObservability {
  /** Timeline rows inspected from the active Pi branch. False means the oldest rows were omitted. */
  completeTimeline: boolean
  analyzedItems: number
  usage: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    cost: number
  }
  tools: {
    totalCalls: number
    failedCalls: number
    invoked: Array<{ name: string; calls: number; failed: number }>
    loadedNotInvoked: string[]
  }
  compactions: number
  context: {
    beforeTokens: number | null
    afterTokens: number | null
    deltaTokens: number | null
    percent: number | null
    contextWindow: number
  } | null
  health: 'healthy' | 'warning' | 'critical' | 'no-evidence'
  signals: AgentRunSignalCode[]
}

export interface AgentRunHistoryListRequest {
  profileId: string
  workspacePath: string
  limit?: number
}

export interface AgentRunHistoryListResponse {
  runs: AgentRunHistoryItem[]
}
