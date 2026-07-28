import { createRequire } from 'module'
import { app } from 'electron'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from 'node:fs'
import { basename, join } from 'path'
import { PRODUCT_PACKAGE_NAME } from '@shared/product-identity'
import type { ManagedWorktree } from '@shared/managed-worktree'
import type { AuditEventRecord } from '@shared/audit-events'
import type {
  AgentRelationship,
  OrchestrationEvidence,
} from '@shared/orchestration'
import type {
  AuditQuery,
  AuditQueryResult,
  DatabaseIntegrity,
  MetadataBackup,
} from '@shared/reliability'

let nativeRequire: ReturnType<typeof createRequire> | null = null
function requireNative<T = unknown>(id: string): T {
  if (!nativeRequire) nativeRequire = createRequire(import.meta.url)
  return nativeRequire(id) as T
}

type SqliteRunResult = { changes?: number | bigint }
type SqliteStatement = {
  run: (...args: unknown[]) => SqliteRunResult
  all: (...args: unknown[]) => unknown[]
  get: (...args: unknown[]) => unknown
}
type SqliteDb = {
  pragma: (s: string) => unknown
  exec: (s: string) => void
  prepare: (sql: string) => SqliteStatement
  close: () => void
}

let DatabaseCtor: (new (path: string) => SqliteDb) | null = null
let db: SqliteDb | null = null
let loadFailed = false
const SCHEMA_VERSION = 4
const MAX_BACKUPS = 20

function databasePath(): string {
  return join(app.getPath('userData'), `${PRODUCT_PACKAGE_NAME}-index.db`)
}

function backupDirectory(): string {
  return join(app.getPath('userData'), 'metadata-backups')
}

function safeBackupReason(value: MetadataBackup['reason']): MetadataBackup['reason'] {
  return value === 'migration' || value === 'pre-restore' ? value : 'manual'
}

function schemaVersion(d: SqliteDb): number {
  const row = d.prepare('PRAGMA user_version').get() as
    | { user_version?: unknown }
    | undefined
  return Math.max(0, Number(row?.user_version ?? 0))
}

function backupFileName(reason: MetadataBackup['reason'], createdAt: number, version: number): string {
  return `${PRODUCT_PACKAGE_NAME}-${safeBackupReason(reason)}-${createdAt}-v${version}.db`
}

function pruneBackups(): void {
  const directory = backupDirectory()
  if (!existsSync(directory)) return
  const files = readdirSync(directory)
    .filter((file) => file.endsWith('.db'))
    .map((file) => ({ file, mtime: statSync(join(directory, file)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime)
  for (const stale of files.slice(MAX_BACKUPS)) {
    rmSync(join(directory, stale.file), { force: true })
  }
}

function createBackupFromDb(
  d: SqliteDb,
  reason: MetadataBackup['reason'],
): MetadataBackup {
  const version = schemaVersion(d)
  const directory = backupDirectory()
  mkdirSync(directory, { recursive: true })
  let createdAt = Date.now()
  let fileName = backupFileName(reason, createdAt, version)
  let path = join(directory, fileName)
  while (existsSync(path)) {
    createdAt += 1
    fileName = backupFileName(reason, createdAt, version)
    path = join(directory, fileName)
  }
  d.exec('PRAGMA wal_checkpoint(FULL)')
  d.prepare('VACUUM INTO ?').run(path)
  const integrity = integrityForDbPath(path)
  if (!integrity.ok) {
    rmSync(path, { force: true })
    throw new Error(`Metadata backup integrity check failed: ${integrity.message}`)
  }
  pruneBackups()
  return {
    id: fileName,
    fileName,
    path,
    createdAt,
    bytes: statSync(path).size,
    schemaVersion: version,
    integrity: 'ok',
    reason: safeBackupReason(reason),
  }
}

function integrityForDbPath(path: string): DatabaseIntegrity {
  const Ctor = loadBetterSqlite()
  if (!Ctor) {
    return { available: false, ok: false, message: 'better-sqlite3 unavailable' }
  }
  let candidate: SqliteDb | null = null
  try {
    candidate = new Ctor(path)
    const rows = candidate.prepare('PRAGMA integrity_check').all() as Array<
      Record<string, unknown>
    >
    const messages = rows.map((row) => String(Object.values(row)[0] ?? 'unknown'))
    const ok = messages.length === 1 && messages[0].toLowerCase() === 'ok'
    return {
      available: true,
      ok,
      message: messages.join('; ').slice(0, 2_000),
      databasePath: path,
    }
  } catch (error) {
    return {
      available: true,
      ok: false,
      message: (error as Error).message,
      databasePath: path,
    }
  } finally {
    candidate?.close()
  }
}

function loadBetterSqlite(): (new (path: string) => SqliteDb) | null {
  if (loadFailed) return null
  if (DatabaseCtor) return DatabaseCtor
  try {
    const pkg = requireNative<{ default?: unknown } & (new (path: string) => SqliteDb)>('better-sqlite3')
    DatabaseCtor = (pkg.default || pkg) as new (path: string) => SqliteDb
    return DatabaseCtor
  } catch (e) {
    loadFailed = true
    DatabaseCtor = null
    db = null
    console.warn(
      '[sqlite-index] better-sqlite3 unavailable; index disabled. Run: npx @electron/rebuild -f -w better-sqlite3',
      (e as Error).message,
    )
    return null
  }
}

function getDb(): SqliteDb | null {
  try {
    const Ctor = loadBetterSqlite()
    if (!Ctor) return null
    if (!db) {
      const dbPath = databasePath()
      const existed = existsSync(dbPath) && statSync(dbPath).size > 0
      db = new Ctor(dbPath)
      db.pragma('journal_mode = WAL')
      const previousVersion = schemaVersion(db)
      if (existed && previousVersion < SCHEMA_VERSION) {
        createBackupFromDb(db, 'migration')
      }
      initSchema(db)
    }
    return db
  } catch (e) {
    loadFailed = true
    db = null
    console.warn('[sqlite-index] open db failed; index disabled:', (e as Error).message)
    return null
  }
}

function initSchema(d: SqliteDb): void {
  d.exec(`
    CREATE TABLE IF NOT EXISTS workspace_index (
      workspace_id TEXT PRIMARY KEY,
      name TEXT,
      path TEXT UNIQUE,
      last_opened INTEGER
    );
    CREATE TABLE IF NOT EXISTS session_index (
      session_id TEXT PRIMARY KEY,
      workspace_id TEXT,
      title TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      model_id TEXT
    );
    CREATE TABLE IF NOT EXISTS run_index (
      run_id TEXT PRIMARY KEY,
      session_id TEXT,
      workspace_id TEXT,
      status TEXT,
      model TEXT,
      started_at INTEGER,
      ended_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS turn_index (
      turn_id TEXT PRIMARY KEY,
      run_id TEXT,
      session_id TEXT,
      started_at INTEGER,
      ended_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS file_change_index (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id TEXT,
      turn_id TEXT,
      path TEXT,
      source TEXT,
      change_type TEXT,
      timestamp INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_file_change_session ON file_change_index(session_id);
    CREATE INDEX IF NOT EXISTS idx_file_change_turn ON file_change_index(turn_id);
    CREATE TABLE IF NOT EXISTS extension_discovery (
      extension_id TEXT PRIMARY KEY,
      source TEXT,
      registered_tools TEXT,
      registered_commands TEXT,
      load_error TEXT,
      discovered_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS audit_event (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      action TEXT NOT NULL,
      outcome TEXT NOT NULL,
      actor TEXT,
      workspace_id TEXT,
      session_file TEXT,
      details_json TEXT,
      timestamp INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_audit_timestamp ON audit_event(timestamp);
    CREATE INDEX IF NOT EXISTS idx_audit_session ON audit_event(session_file, timestamp);
    CREATE TABLE IF NOT EXISTS managed_worktree (
      id TEXT PRIMARY KEY,
      root_workspace_path TEXT NOT NULL,
      worktree_path TEXT UNIQUE NOT NULL,
      branch_name TEXT NOT NULL,
      base_ref TEXT NOT NULL,
      base_commit TEXT NOT NULL,
      status TEXT NOT NULL,
      created_by_session TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      last_error TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_worktree_root_status
      ON managed_worktree(root_workspace_path, status, updated_at);
    CREATE TABLE IF NOT EXISTS agent_relationship (
      id TEXT PRIMARY KEY,
      parent_session_file TEXT NOT NULL,
      child_session_id TEXT,
      child_session_file TEXT,
      parent_worker_key TEXT NOT NULL,
      child_worker_key TEXT,
      root_workspace_path TEXT NOT NULL,
      child_workspace_path TEXT NOT NULL,
      worktree_id TEXT,
      environment TEXT NOT NULL,
      name TEXT NOT NULL,
      goal TEXT NOT NULL,
      status TEXT NOT NULL,
      depth INTEGER NOT NULL,
      sequence INTEGER NOT NULL,
      last_worker_event_sequence INTEGER NOT NULL DEFAULT 0,
      model TEXT,
      thinking_level TEXT,
      timeout_ms INTEGER NOT NULL,
      last_summary TEXT,
      last_output TEXT,
      pending_message TEXT,
      requires_input INTEGER NOT NULL DEFAULT 0,
      verification_status TEXT NOT NULL DEFAULT 'unverified',
      error TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_agent_relationship_parent
      ON agent_relationship(parent_session_file, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_relationship_child
      ON agent_relationship(child_session_file);
    CREATE INDEX IF NOT EXISTS idx_agent_relationship_root_status
      ON agent_relationship(root_workspace_path, status, updated_at);
    CREATE TABLE IF NOT EXISTS orchestration_evidence (
      id TEXT PRIMARY KEY,
      relationship_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      detail TEXT,
      command TEXT,
      exit_code INTEGER,
      workspace_path TEXT,
      branch_name TEXT,
      head_sha TEXT,
      created_at INTEGER NOT NULL,
      FOREIGN KEY(relationship_id) REFERENCES agent_relationship(id)
    );
    CREATE INDEX IF NOT EXISTS idx_orchestration_evidence_relationship
      ON orchestration_evidence(relationship_id, created_at);
  `)
  try {
    d.exec(
      'ALTER TABLE agent_relationship ADD COLUMN last_worker_event_sequence INTEGER NOT NULL DEFAULT 0',
    )
  } catch {
    // Existing and new databases both converge on the same column.
  }
  try {
    d.exec('ALTER TABLE agent_relationship ADD COLUMN child_session_id TEXT')
  } catch {
    // Existing and new databases both converge on the same column.
  }
  d.pragma(`user_version = ${SCHEMA_VERSION}`)
}

function mapAuditEventRow(row: unknown): AuditEventRecord | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  let details: Record<string, unknown> = {}
  try {
    const parsed = JSON.parse(String(value.details_json || '{}')) as unknown
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      details = parsed as Record<string, unknown>
    }
  } catch {
    details = { parseError: true }
  }
  return {
    id: String(value.id || ''),
    category: String(value.category || 'operation') as AuditEventRecord['category'],
    action: String(value.action || ''),
    outcome: String(value.outcome || 'failed') as AuditEventRecord['outcome'],
    actor: value.actor ? String(value.actor) : undefined,
    workspaceId: value.workspace_id ? String(value.workspace_id) : undefined,
    sessionFile: value.session_file ? String(value.session_file) : undefined,
    details,
    timestamp: Number(value.timestamp || 0),
  }
}

function mapManagedWorktreeRow(row: unknown): ManagedWorktree | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  return {
    id: String(value.id || ''),
    rootWorkspacePath: String(value.root_workspace_path || ''),
    worktreePath: String(value.worktree_path || ''),
    branchName: String(value.branch_name || ''),
    baseRef: String(value.base_ref || ''),
    baseCommit: String(value.base_commit || ''),
    status: String(value.status || 'error') as ManagedWorktree['status'],
    createdBySession: value.created_by_session
      ? String(value.created_by_session)
      : undefined,
    createdAt: Number(value.created_at || 0),
    updatedAt: Number(value.updated_at || 0),
    lastError: value.last_error ? String(value.last_error) : undefined,
  }
}

function mapAgentRelationshipRow(row: unknown): AgentRelationship | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  return {
    id: String(value.id || ''),
    parentSessionFile: String(value.parent_session_file || ''),
    childSessionId: value.child_session_id
      ? String(value.child_session_id)
      : undefined,
    childSessionFile: value.child_session_file
      ? String(value.child_session_file)
      : undefined,
    parentWorkerKey: String(value.parent_worker_key || ''),
    childWorkerKey: value.child_worker_key
      ? String(value.child_worker_key)
      : undefined,
    rootWorkspacePath: String(value.root_workspace_path || ''),
    childWorkspacePath: String(value.child_workspace_path || ''),
    worktreeId: value.worktree_id ? String(value.worktree_id) : undefined,
    environment: String(value.environment || 'worktree') as AgentRelationship['environment'],
    name: String(value.name || ''),
    goal: String(value.goal || ''),
    status: String(value.status || 'failed') as AgentRelationship['status'],
    depth: Number(value.depth || 0),
    sequence: Number(value.sequence || 0),
    lastWorkerEventSequence: Number(value.last_worker_event_sequence || 0),
    model: value.model ? String(value.model) : undefined,
    thinkingLevel: value.thinking_level ? String(value.thinking_level) : undefined,
    timeoutMs: Number(value.timeout_ms || 0),
    lastSummary: value.last_summary ? String(value.last_summary) : undefined,
    lastOutput: value.last_output ? String(value.last_output) : undefined,
    pendingMessage: value.pending_message ? String(value.pending_message) : undefined,
    requiresInput: Number(value.requires_input || 0) === 1,
    verificationStatus: String(
      value.verification_status || 'unverified',
    ) as AgentRelationship['verificationStatus'],
    error: value.error ? String(value.error) : undefined,
    createdAt: Number(value.created_at || 0),
    updatedAt: Number(value.updated_at || 0),
    startedAt: value.started_at == null ? undefined : Number(value.started_at),
    completedAt: value.completed_at == null ? undefined : Number(value.completed_at),
  }
}

function mapOrchestrationEvidenceRow(row: unknown): OrchestrationEvidence | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  return {
    id: String(value.id || ''),
    relationshipId: String(value.relationship_id || ''),
    kind: String(value.kind || 'report') as OrchestrationEvidence['kind'],
    status: String(value.status || 'unverified') as OrchestrationEvidence['status'],
    title: String(value.title || ''),
    detail: value.detail ? String(value.detail) : undefined,
    command: value.command ? String(value.command) : undefined,
    exitCode: value.exit_code == null ? undefined : Number(value.exit_code),
    workspacePath: value.workspace_path ? String(value.workspace_path) : undefined,
    branchName: value.branch_name ? String(value.branch_name) : undefined,
    headSha: value.head_sha ? String(value.head_sha) : undefined,
    createdAt: Number(value.created_at || 0),
  }
}

export const sqliteIndex = {
  upsertWorkspace(workspaceId: string, name: string, path: string): void {
    const d = getDb()
    if (!d) return
    d.prepare(
      'INSERT OR REPLACE INTO workspace_index (workspace_id, name, path, last_opened) VALUES (?, ?, ?, ?)',
    ).run(workspaceId, name, path, Date.now())
  },

  upsertSession(sessionId: string, workspaceId: string, title: string, modelId: string): void {
    const d = getDb()
    if (!d) return
    d.prepare(
      'INSERT OR REPLACE INTO session_index (session_id, workspace_id, title, created_at, updated_at, model_id) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(sessionId, workspaceId, title, Date.now(), Date.now(), modelId)
  },

  addFileChange(sessionId: string, turnId: string, path: string, source: string, changeType: string): void {
    const d = getDb()
    if (!d) return
    d.prepare(
      'INSERT INTO file_change_index (session_id, turn_id, path, source, change_type, timestamp) VALUES (?, ?, ?, ?, ?, ?)',
    ).run(sessionId, turnId, path, source, changeType, Date.now())
  },

  getFileChangesBySession(sessionId: string): unknown[] {
    const d = getDb()
    if (!d) return []
    return d.prepare(
      'SELECT * FROM file_change_index WHERE session_id = ? ORDER BY timestamp DESC',
    ).all(sessionId)
  },

  getFileChangesByTurn(turnId: string): unknown[] {
    const d = getDb()
    if (!d) return []
    return d.prepare(
      'SELECT * FROM file_change_index WHERE turn_id = ? ORDER BY timestamp DESC',
    ).all(turnId)
  },

  addAuditEvent(event: {
    id: string
    category: string
    action: string
    outcome: string
    actor?: string
    workspaceId?: string
    sessionFile?: string
    details?: Record<string, unknown>
    timestamp: number
  }): void {
    const d = getDb()
    if (!d) return
    d.prepare(
      `INSERT INTO audit_event
        (id, category, action, outcome, actor, workspace_id, session_file, details_json, timestamp)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      event.id,
      event.category,
      event.action,
      event.outcome,
      event.actor ?? null,
      event.workspaceId ?? null,
      event.sessionFile ?? null,
      JSON.stringify(event.details ?? {}),
      event.timestamp,
    )
  },

  getAuditEvents(limit = 500): unknown[] {
    const d = getDb()
    if (!d) return []
    const safeLimit = Math.max(1, Math.min(10_000, Math.trunc(limit)))
    return d.prepare(
      'SELECT * FROM audit_event ORDER BY timestamp DESC LIMIT ?',
    ).all(safeLimit)
  },

  queryAuditEvents(query: AuditQuery = {}): AuditQueryResult {
    const d = getDb()
    if (!d) return { events: [], total: 0 }
    const clauses: string[] = []
    const args: unknown[] = []
    if (query.category) {
      clauses.push('category = ?')
      args.push(query.category)
    }
    if (query.action) {
      clauses.push('action LIKE ?')
      args.push(`%${query.action}%`)
    }
    if (query.outcome) {
      clauses.push('outcome = ?')
      args.push(query.outcome)
    }
    if (query.workspaceId) {
      clauses.push('workspace_id = ?')
      args.push(query.workspaceId)
    }
    if (query.sessionFile) {
      clauses.push('session_file = ?')
      args.push(query.sessionFile)
    }
    if (Number.isFinite(query.from)) {
      clauses.push('timestamp >= ?')
      args.push(query.from)
    }
    if (Number.isFinite(query.to)) {
      clauses.push('timestamp <= ?')
      args.push(query.to)
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    const limit = Math.max(1, Math.min(10_000, Math.trunc(query.limit ?? 500)))
    const events = d
      .prepare(`SELECT * FROM audit_event${where} ORDER BY timestamp DESC LIMIT ?`)
      .all(...args, limit)
      .map(mapAuditEventRow)
      .filter((event): event is AuditEventRecord => event != null)
    const countRow = d
      .prepare(`SELECT COUNT(*) AS count FROM audit_event${where}`)
      .get(...args) as { count?: unknown } | undefined
    return { events, total: Number(countRow?.count ?? events.length) }
  },

  upsertManagedWorktree(worktree: ManagedWorktree): void {
    const d = getDb()
    if (!d) return
    d.prepare(
      `INSERT INTO managed_worktree
        (id, root_workspace_path, worktree_path, branch_name, base_ref, base_commit,
         status, created_by_session, created_at, updated_at, last_error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         root_workspace_path = excluded.root_workspace_path,
         worktree_path = excluded.worktree_path,
         branch_name = excluded.branch_name,
         base_ref = excluded.base_ref,
         base_commit = excluded.base_commit,
         status = excluded.status,
         created_by_session = excluded.created_by_session,
         updated_at = excluded.updated_at,
         last_error = excluded.last_error`,
    ).run(
      worktree.id,
      worktree.rootWorkspacePath,
      worktree.worktreePath,
      worktree.branchName,
      worktree.baseRef,
      worktree.baseCommit,
      worktree.status,
      worktree.createdBySession ?? null,
      worktree.createdAt,
      worktree.updatedAt,
      worktree.lastError ?? null,
    )
  },

  getManagedWorktree(id: string): ManagedWorktree | null {
    const d = getDb()
    if (!d) return null
    return mapManagedWorktreeRow(
      d.prepare('SELECT * FROM managed_worktree WHERE id = ?').get(id),
    )
  },

  listManagedWorktrees(options?: {
    rootWorkspacePath?: string
    includeRemoved?: boolean
  }): ManagedWorktree[] {
    const d = getDb()
    if (!d) return []
    const clauses: string[] = []
    const args: unknown[] = []
    if (options?.rootWorkspacePath) {
      clauses.push('root_workspace_path = ?')
      args.push(options.rootWorkspacePath)
    }
    if (options?.includeRemoved !== true) clauses.push("status != 'removed'")
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    return d
      .prepare(`SELECT * FROM managed_worktree${where} ORDER BY created_at DESC`)
      .all(...args)
      .map(mapManagedWorktreeRow)
      .filter((row): row is ManagedWorktree => row != null)
  },

  upsertAgentRelationship(relationship: AgentRelationship): void {
    const d = getDb()
    if (!d) return
    d.prepare(
      `INSERT INTO agent_relationship
        (id, parent_session_file, child_session_id, child_session_file, parent_worker_key, child_worker_key,
         root_workspace_path, child_workspace_path, worktree_id, environment, name, goal,
         status, depth, sequence, last_worker_event_sequence, model, thinking_level, timeout_ms, last_summary,
         last_output, pending_message, requires_input, verification_status, error,
         created_at, updated_at, started_at, completed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         child_session_id = excluded.child_session_id,
         child_session_file = excluded.child_session_file,
         child_worker_key = excluded.child_worker_key,
         child_workspace_path = excluded.child_workspace_path,
         worktree_id = excluded.worktree_id,
         status = excluded.status,
         sequence = excluded.sequence,
         last_worker_event_sequence = excluded.last_worker_event_sequence,
         model = excluded.model,
         thinking_level = excluded.thinking_level,
         timeout_ms = excluded.timeout_ms,
         last_summary = excluded.last_summary,
         last_output = excluded.last_output,
         pending_message = excluded.pending_message,
         requires_input = excluded.requires_input,
         verification_status = excluded.verification_status,
         error = excluded.error,
         updated_at = excluded.updated_at,
         started_at = excluded.started_at,
         completed_at = excluded.completed_at`,
    ).run(
      relationship.id,
      relationship.parentSessionFile,
      relationship.childSessionId ?? null,
      relationship.childSessionFile ?? null,
      relationship.parentWorkerKey,
      relationship.childWorkerKey ?? null,
      relationship.rootWorkspacePath,
      relationship.childWorkspacePath,
      relationship.worktreeId ?? null,
      relationship.environment,
      relationship.name,
      relationship.goal,
      relationship.status,
      relationship.depth,
      relationship.sequence,
      relationship.lastWorkerEventSequence,
      relationship.model ?? null,
      relationship.thinkingLevel ?? null,
      relationship.timeoutMs,
      relationship.lastSummary ?? null,
      relationship.lastOutput ?? null,
      relationship.pendingMessage ?? null,
      relationship.requiresInput ? 1 : 0,
      relationship.verificationStatus,
      relationship.error ?? null,
      relationship.createdAt,
      relationship.updatedAt,
      relationship.startedAt ?? null,
      relationship.completedAt ?? null,
    )
  },

  getAgentRelationship(id: string): AgentRelationship | null {
    const d = getDb()
    if (!d) return null
    return mapAgentRelationshipRow(
      d.prepare('SELECT * FROM agent_relationship WHERE id = ?').get(id),
    )
  },

  getAgentRelationshipByChildSession(
    childSessionFile: string,
  ): AgentRelationship | null {
    const d = getDb()
    if (!d) return null
    return mapAgentRelationshipRow(
      d
        .prepare('SELECT * FROM agent_relationship WHERE child_session_file = ?')
        .get(childSessionFile),
    )
  },

  listAgentRelationships(options?: {
    parentSessionFile?: string
    rootWorkspacePath?: string
  }): AgentRelationship[] {
    const d = getDb()
    if (!d) return []
    const clauses: string[] = []
    const args: unknown[] = []
    if (options?.parentSessionFile) {
      clauses.push('parent_session_file = ?')
      args.push(options.parentSessionFile)
    }
    if (options?.rootWorkspacePath) {
      clauses.push('root_workspace_path = ?')
      args.push(options.rootWorkspacePath)
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    return d
      .prepare(`SELECT * FROM agent_relationship${where} ORDER BY created_at ASC`)
      .all(...args)
      .map(mapAgentRelationshipRow)
      .filter((row): row is AgentRelationship => row != null)
  },

  addOrchestrationEvidence(evidence: OrchestrationEvidence): void {
    const d = getDb()
    if (!d) return
    d.prepare(
      `INSERT OR IGNORE INTO orchestration_evidence
        (id, relationship_id, kind, status, title, detail, command, exit_code,
         workspace_path, branch_name, head_sha, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      evidence.id,
      evidence.relationshipId,
      evidence.kind,
      evidence.status,
      evidence.title,
      evidence.detail ?? null,
      evidence.command ?? null,
      evidence.exitCode ?? null,
      evidence.workspacePath ?? null,
      evidence.branchName ?? null,
      evidence.headSha ?? null,
      evidence.createdAt,
    )
  },

  listOrchestrationEvidence(relationshipId: string): OrchestrationEvidence[] {
    const d = getDb()
    if (!d) return []
    return d
      .prepare(
        'SELECT * FROM orchestration_evidence WHERE relationship_id = ? ORDER BY created_at ASC',
      )
      .all(relationshipId)
      .map(mapOrchestrationEvidenceRow)
      .filter((row): row is OrchestrationEvidence => row != null)
  },

  databasePath(): string {
    return databasePath()
  },

  schemaVersion(): number {
    const d = getDb()
    return d ? schemaVersion(d) : 0
  },

  integrityCheck(): DatabaseIntegrity {
    const d = getDb()
    if (!d) {
      return {
        available: false,
        ok: false,
        message: 'Metadata database unavailable',
        databasePath: databasePath(),
      }
    }
    try {
      const rows = d.prepare('PRAGMA integrity_check').all() as Array<
        Record<string, unknown>
      >
      const messages = rows.map((row) => String(Object.values(row)[0] ?? 'unknown'))
      return {
        available: true,
        ok: messages.length === 1 && messages[0].toLowerCase() === 'ok',
        message: messages.join('; ').slice(0, 2_000),
        databasePath: databasePath(),
      }
    } catch (error) {
      return {
        available: true,
        ok: false,
        message: (error as Error).message,
        databasePath: databasePath(),
      }
    }
  },

  createMetadataBackup(reason: MetadataBackup['reason'] = 'manual'): MetadataBackup {
    const d = getDb()
    if (!d) throw new Error('Metadata database unavailable')
    return createBackupFromDb(d, reason)
  },

  listMetadataBackups(): MetadataBackup[] {
    const directory = backupDirectory()
    if (!existsSync(directory)) return []
    const pattern = new RegExp(
      `^${PRODUCT_PACKAGE_NAME.replace(/[.*+?^${}()|[\\]\\\\]/g, '\\\\$&')}-(manual|migration|pre-restore)-(\\d+)-v(\\d+)\\.db$`,
    )
    const backups: MetadataBackup[] = []
    for (const fileName of readdirSync(directory)) {
        const match = pattern.exec(fileName)
        if (!match) continue
        const path = join(directory, fileName)
        const stats = statSync(path)
        backups.push({
          id: fileName,
          fileName,
          path,
          createdAt: Number(match[2]),
          bytes: stats.size,
          schemaVersion: Number(match[3]),
          integrity: 'unknown',
          reason: match[1] as MetadataBackup['reason'],
        })
    }
    return backups.sort((a, b) => b.createdAt - a.createdAt)
  },

  restoreMetadataBackup(backupId: string): {
    restored: MetadataBackup
    rollback: MetadataBackup
  } {
    const known = this.listMetadataBackups().find((backup) => backup.id === backupId)
    if (!known || basename(backupId) !== backupId) {
      throw new Error('Unknown metadata backup')
    }
    const sourceIntegrity = integrityForDbPath(known.path)
    if (!sourceIntegrity.ok) {
      throw new Error(`Backup is unreadable: ${sourceIntegrity.message}`)
    }
    const current = getDb()
    if (!current) throw new Error('Metadata database unavailable')
    const rollback = createBackupFromDb(current, 'pre-restore')
    current.close()
    db = null

    const activePath = databasePath()
    const restoreTemp = `${activePath}.restore-${Date.now()}.tmp`
    const displaced = `${activePath}.displaced-${Date.now()}.tmp`
    let restoredDb: SqliteDb | null = null
    try {
      copyFileSync(known.path, restoreTemp)
      const stagedIntegrity = integrityForDbPath(restoreTemp)
      if (!stagedIntegrity.ok) throw new Error(stagedIntegrity.message)
      rmSync(`${activePath}-wal`, { force: true })
      rmSync(`${activePath}-shm`, { force: true })
      if (existsSync(activePath)) renameSync(activePath, displaced)
      renameSync(restoreTemp, activePath)
      restoredDb = getDb()
      if (!restoredDb) throw new Error('Restored database could not be opened')
      const finalIntegrity = this.integrityCheck()
      if (!finalIntegrity.ok) throw new Error(finalIntegrity.message)
      rmSync(displaced, { force: true })
      return { restored: { ...known, integrity: 'ok' }, rollback }
    } catch (error) {
      restoredDb?.close()
      db = null
      rmSync(restoreTemp, { force: true })
      if (existsSync(displaced)) {
        rmSync(activePath, { force: true })
        renameSync(displaced, activePath)
      }
      getDb()
      throw error
    }
  },

}
