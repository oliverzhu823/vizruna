import type { AuditEventRecord, AuditOutcome } from './audit-events'
import type { ManagedWorktree } from './managed-worktree'

export type FailureCode =
  | 'AUTHENTICATION_FAILED'
  | 'OAUTH_CALLBACK_FAILED'
  | 'REGION_RESTRICTED'
  | 'NETWORK_UNREACHABLE'
  | 'WORKER_EXITED'
  | 'SESSION_EXTERNALLY_MODIFIED'
  | 'WORKTREE_UNAVAILABLE'
  | 'DISK_WRITE_FAILED'
  | 'SQLITE_BUSY'
  | 'SQLITE_CORRUPT'
  | 'TIMEOUT'
  | 'CANCELLED'
  | 'UNKNOWN'

export type FailureStage =
  | 'authentication'
  | 'network'
  | 'worker'
  | 'worktree'
  | 'storage'
  | 'recovery'
  | 'unknown'

export interface FailureEnvelope {
  code: FailureCode
  stage: FailureStage
  message: string
  retryable: boolean
  userAction: string
  timestamp: number
}

export interface AuditQuery {
  category?: string
  action?: string
  outcome?: AuditOutcome
  workspaceId?: string
  sessionFile?: string
  from?: number
  to?: number
  limit?: number
}

export interface AuditQueryResult {
  events: AuditEventRecord[]
  total: number
}

export interface AuditExportRequest {
  query?: AuditQuery
  format: 'json' | 'jsonl'
}

export interface FileExportResult {
  cancelled: boolean
  path?: string
  bytes?: number
}

export interface DatabaseIntegrity {
  available: boolean
  ok: boolean
  message: string
  databasePath?: string
}

export interface MetadataBackup {
  id: string
  fileName: string
  path: string
  createdAt: number
  bytes: number
  schemaVersion: number
  integrity: 'ok' | 'unknown'
  reason: 'manual' | 'migration' | 'pre-restore'
}

export interface MetadataRestoreRequest {
  backupId: string
  confirmation: 'RESTORE_METADATA'
}

export interface WorkerDiagnosticSnapshot {
  poolSize: number
  foregroundPoolKey: string | null
  workers: Array<{
    poolKey: string
    cwd: string
    sessionBound: boolean
    running: boolean
    stopping: boolean
  }>
}

export interface ReconciliationIssue {
  kind:
    | 'missing-worktree-directory'
    | 'unregistered-git-worktree'
    | 'missing-child-workspace'
    | 'missing-child-session'
  severity: 'warning' | 'error'
  resourceId: string
  path?: string
  message: string
  suggestion: string
}

export interface ReconciliationSnapshot {
  generatedAt: number
  issues: ReconciliationIssue[]
  worktrees: ManagedWorktree[]
  note: string
}

export interface PerformanceSnapshot {
  capturedAt: number
  uptimeSeconds: number
  rssBytes: number
  heapUsedBytes: number
  externalBytes: number
  workerCount: number
  activeWorkerCount: number
  budgets: {
    rssWarningBytes: number
    heapWarningBytes: number
    workerHardCap: number
  }
  warnings: string[]
}

export interface ReliabilitySnapshot {
  generatedAt: number
  integrity: DatabaseIntegrity
  auditEventCount: number
  backupCount: number
  performance: PerformanceSnapshot
  workers: WorkerDiagnosticSnapshot
  reconciliation: ReconciliationSnapshot
  recentFailures: FailureEnvelope[]
}

export interface DiagnosticsPreview {
  generatedAt: number
  packageFormat: 'json.gz'
  includedSections: string[]
  excludedData: string[]
  estimatedBytes: number
  redactionCount: number
  snapshot: Record<string, unknown>
}
