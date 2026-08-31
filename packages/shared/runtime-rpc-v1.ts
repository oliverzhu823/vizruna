export const VIZRUNA_RUNTIME_RPC_VERSION = '1.0' as const
export const VIZRUNA_RUNTIME_API_PREFIX = '/api/v1' as const

export type RuntimePermissionMode = 'observe' | 'collaborate' | 'autonomous'
export type RuntimeRunStatus =
  | 'queued'
  | 'starting'
  | 'running'
  | 'waiting_approval'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface RuntimeCapabilityManifest {
  rpcVersion: typeof VIZRUNA_RUNTIME_RPC_VERSION
  productVersion: string
  piRuntimeVersion: string
  capabilities: string[]
  permissionModes: RuntimePermissionMode[]
}

export interface RuntimeRunStartRequest {
  workspacePath: string
  prompt: string
  agentId?: string
  agentVersionId?: string
  modelId?: string
  thinkingLevel?: string
  permissionMode?: RuntimePermissionMode
  approvedTools?: string[]
}

export interface RuntimePermissionDecision {
  mode: RuntimePermissionMode
  requestedTools: string[]
  allowedTools: string[]
  deniedTools: string[]
  approvedTools: string[]
}

export interface RuntimeRunRecord {
  id: string
  workspacePath: string
  prompt: string
  agentId?: string
  agentVersionId?: string
  agentName?: string
  modelId?: string
  thinkingLevel?: string
  piRuntimeVersion: string
  status: RuntimeRunStatus
  permission: RuntimePermissionDecision
  sessionId?: string
  sessionFile?: string
  outputText?: string
  error?: string
  createdAt: number
  startedAt?: number
  completedAt?: number
  updatedAt: number
  metrics: {
    inputTokens: number
    outputTokens: number
    cacheReadTokens: number
    cacheWriteTokens: number
    cost: number
    toolCalls: number
    failedToolCalls: number
  }
  tools: Array<{
    id: string
    name: string
    status: 'running' | 'completed' | 'failed'
    startedAt: number
    completedAt?: number
  }>
  artifacts: string[]
}

export interface RuntimeEventEnvelopeV1 {
  id: number
  timestamp: number
  type: string
  runId?: string
  data: Record<string, unknown>
}

export interface RuntimeRpcRequestV1 {
  id: string
  method: string
  params?: unknown
}

export interface RuntimeRpcSuccessV1 {
  id: string
  ok: true
  result: unknown
}

export interface RuntimeRpcFailureV1 {
  id: string
  ok: false
  error: {
    code: string
    message: string
    details?: unknown
  }
}

export type RuntimeRpcResponseV1 = RuntimeRpcSuccessV1 | RuntimeRpcFailureV1

export interface RuntimeEvidenceBundleV1 {
  schemaVersion: 1
  exportedAt: number
  run: Omit<RuntimeRunRecord, 'prompt' | 'outputText'> & {
    prompt?: string
    outputText?: string
  }
  events: RuntimeEventEnvelopeV1[]
  redactions: string[]
}

export interface RuntimeEvaluationRecordV1 {
  id: string
  suiteId: string
  suiteName: string
  agentId: string
  agentVersionId?: string
  workspacePath: string
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  items: Array<{
    scenarioId: string
    scenarioName: string
    runId?: string
    status: RuntimeRunStatus
    error?: string
  }>
  createdAt: number
  startedAt?: number
  completedAt?: number
}
