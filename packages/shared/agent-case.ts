export type AgentCaseStatus = 'draft' | 'validated' | 'archived'

export interface AgentCasePackageProvenance {
  id: string
  source: string
  name: string
  version?: string
  scope: 'user' | 'project'
  role: 'agent-package' | 'resource-dependency'
}

export interface AgentCaseProvenance {
  capturedAt: number
  piRuntimeVersion: string
  agent?: {
    profileId: string
    name: string
    versionId?: string
    versionNumber?: number
    profileUpdatedAt?: number
    snapshotCapturedAt: number
    snapshotDigest: string
  }
  packages: AgentCasePackageProvenance[]
}

export type AgentCaseVerificationCheckCode =
  | 'provenance-present'
  | 'source-session-present'
  | 'pi-runtime-version'
  | 'agent-bound'
  | 'agent-profile-version'
  | 'package-installed'
  | 'package-version'

export interface AgentCaseVerificationCheck {
  code: AgentCaseVerificationCheckCode
  status: 'passed' | 'warning' | 'failed'
  label?: string
  expected?: string
  actual?: string
}

export interface AgentCaseVerification {
  checkedAt: number
  reproducible: boolean
  checks: AgentCaseVerificationCheck[]
}

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
  provenance?: AgentCaseProvenance
  lastVerification?: AgentCaseVerification
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

export interface AgentCaseVerifyRequest {
  id: string
}

export interface AgentCaseVerifyResponse {
  agentCase: AgentCase
  verification: AgentCaseVerification
}

export interface AgentCaseMutationResponse {
  agentCase: AgentCase
}
