export type AuditOutcome = 'success' | 'blocked' | 'failed'

export interface AuditEventInput {
  category:
    | 'session-lease'
    | 'security'
    | 'operation'
    | 'worker'
    | 'worktree'
    | 'orchestration'
    | 'proxy'
    | 'recovery'
  action: string
  outcome: AuditOutcome
  actor?: string
  workspaceId?: string
  sessionFile?: string
  details?: Record<string, unknown>
  timestamp?: number
}

export interface AuditEventRecord extends AuditEventInput {
  id: string
  timestamp: number
}
