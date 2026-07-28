import { z } from 'zod'

export const orchestrationStatusSchema = z.enum([
  'queued',
  'starting',
  'running',
  'waiting',
  'complete',
  'failed',
  'cancelled',
  'interrupted',
  'timed_out',
])

export type OrchestrationStatus = z.infer<typeof orchestrationStatusSchema>
export type OrchestrationEnvironment = 'worktree' | 'local'
export type VerificationStatus = 'unverified' | 'passed' | 'failed'

export interface AgentRelationship {
  id: string
  parentSessionFile: string
  childSessionId?: string
  childSessionFile?: string
  parentWorkerKey: string
  childWorkerKey?: string
  rootWorkspacePath: string
  childWorkspacePath: string
  worktreeId?: string
  environment: OrchestrationEnvironment
  name: string
  goal: string
  status: OrchestrationStatus
  depth: number
  sequence: number
  lastWorkerEventSequence: number
  model?: string
  thinkingLevel?: string
  timeoutMs: number
  lastSummary?: string
  lastOutput?: string
  pendingMessage?: string
  requiresInput: boolean
  verificationStatus: VerificationStatus
  error?: string
  createdAt: number
  updatedAt: number
  startedAt?: number
  completedAt?: number
}

export type OrchestrationEvidenceKind =
  | 'report'
  | 'command'
  | 'change'
  | 'review'
  | 'blocker'
  | 'acceptance'

export type OrchestrationEvidenceStatus =
  | 'reported'
  | 'running'
  | 'passed'
  | 'failed'
  | 'blocked'
  | 'accepted'
  | 'unverified'

export interface OrchestrationEvidence {
  id: string
  relationshipId: string
  kind: OrchestrationEvidenceKind
  status: OrchestrationEvidenceStatus
  title: string
  detail?: string
  command?: string
  exitCode?: number
  workspacePath?: string
  branchName?: string
  headSha?: string
  createdAt: number
}

export interface OrchestrationTaskSnapshot {
  relationship: AgentRelationship
  evidence: OrchestrationEvidence[]
}

export interface OrchestrationEvent {
  type: 'orchestration'
  seq: number
  workspaceId: string
  sessionId?: string
  sessionFile?: string
  timestamp: number
  relationship: AgentRelationship
}

export interface CreateChildAgentRequest {
  parentSessionFile: string
  rootWorkspacePath?: string
  name?: string
  goal: string
  environment?: OrchestrationEnvironment
  timeoutMs?: number
}

export interface SendChildMessageRequest {
  relationshipId: string
  text: string
}

export interface WaitForChildrenResult {
  relationships: AgentRelationship[]
  timedOut: boolean
}

const workerCreateChildSchema = z.object({
  method: z.literal('createChild'),
  goal: z.string().trim().min(1).max(20_000),
  name: z.string().trim().max(120).optional(),
  environment: z.enum(['worktree', 'local']).optional(),
  timeoutMs: z.number().int().min(1_000).max(24 * 60 * 60 * 1_000).optional(),
})

const workerListChildrenSchema = z.object({
  method: z.literal('listChildren'),
})

const workerReadChildSchema = z.object({
  method: z.literal('readChild'),
  relationshipId: z.string().uuid(),
  includeEvidence: z.boolean().optional(),
})

const workerSendMessageSchema = z.object({
  method: z.literal('sendMessage'),
  relationshipId: z.string().uuid(),
  text: z.string().trim().min(1).max(20_000),
})

const workerStopChildSchema = z.object({
  method: z.literal('stopChild'),
  relationshipId: z.string().uuid(),
})

const workerWaitChildrenSchema = z.object({
  method: z.literal('waitChildren'),
  relationshipIds: z.array(z.string().uuid()).max(32).optional(),
  timeoutMs: z.number().int().min(0).max(60_000).optional(),
})

export const orchestrationWorkerRequestSchema = z.discriminatedUnion('method', [
  workerCreateChildSchema,
  workerListChildrenSchema,
  workerReadChildSchema,
  workerSendMessageSchema,
  workerStopChildSchema,
  workerWaitChildrenSchema,
])

export type OrchestrationWorkerRequest = z.infer<typeof orchestrationWorkerRequestSchema>

export type OrchestrationWorkerResponse =
  | { ok: true; result: unknown }
  | { ok: false; code: string; error: string }

export const TERMINAL_ORCHESTRATION_STATUSES = new Set<OrchestrationStatus>([
  'complete',
  'failed',
  'cancelled',
  'interrupted',
])

export function isTerminalOrchestrationStatus(status: OrchestrationStatus): boolean {
  return TERMINAL_ORCHESTRATION_STATUSES.has(status)
}
