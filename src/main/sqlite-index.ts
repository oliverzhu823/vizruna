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
import type { AgentCase } from '@shared/agent-case'
import type {
  AgentEvaluationBatch,
  AgentEvaluationRun,
  AgentEvaluationScenario,
  AgentEvaluationSuite,
} from '@shared/agent-evaluation'
import type {
  AgentProfile,
  AgentProfileSnapshot,
  SessionAgentBinding,
} from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'
import type { AgentRunHistoryItem } from '@shared/agent-run-history'
import type {
  SessionPromptBinding,
  SystemPromptPreset,
  SystemPromptSnapshot,
} from '@shared/system-prompt-preset'
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
const SCHEMA_VERSION = 16
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
    CREATE TABLE IF NOT EXISTS agent_run_runtime_evidence (
      session_file TEXT PRIMARY KEY,
      run_id TEXT,
      resource_json TEXT,
      context_before_json TEXT,
      context_after_json TEXT,
      captured_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS agent_run_turn_evidence (
      session_file TEXT NOT NULL,
      run_id TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      started_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (session_file, run_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_turn_evidence_session
      ON agent_run_turn_evidence(session_file, started_at DESC);
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
    CREATE TABLE IF NOT EXISTS agent_case (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      summary TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      status TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      source_session_id TEXT NOT NULL,
      source_session_file TEXT NOT NULL,
      model_id TEXT,
      thinking_level TEXT,
      provenance_json TEXT,
      verification_json TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_case_status_updated
      ON agent_case(status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_agent_case_workspace_updated
      ON agent_case(workspace_path, updated_at);
    CREATE TABLE IF NOT EXISTS agent_evaluation_suite (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      workspace_path TEXT NOT NULL,
      profile_id TEXT NOT NULL,
      version_id TEXT,
      baseline_suite_id TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_evaluation_suite_workspace
      ON agent_evaluation_suite(workspace_path, status, updated_at);
    CREATE INDEX IF NOT EXISTS idx_agent_evaluation_suite_profile
      ON agent_evaluation_suite(profile_id, updated_at);
    CREATE TABLE IF NOT EXISTS agent_evaluation_scenario (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      name TEXT NOT NULL,
      prompt TEXT NOT NULL,
      expected_outcome TEXT,
      tags_json TEXT NOT NULL DEFAULT '[]',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_evaluation_scenario_suite
      ON agent_evaluation_scenario(suite_id, sort_order, created_at);
    CREATE TABLE IF NOT EXISTS agent_evaluation_run (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      scenario_id TEXT NOT NULL,
      source_case_id TEXT NOT NULL,
      evidence_json TEXT NOT NULL,
      verdict TEXT NOT NULL,
      notes TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_evaluation_run_scenario
      ON agent_evaluation_run(scenario_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_agent_evaluation_run_suite
      ON agent_evaluation_run(suite_id, created_at);
    CREATE TABLE IF NOT EXISTS agent_evaluation_batch (
      id TEXT PRIMARY KEY,
      suite_id TEXT NOT NULL,
      workspace_path TEXT NOT NULL,
      status TEXT NOT NULL,
      batch_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_evaluation_batch_suite
      ON agent_evaluation_batch(suite_id, created_at DESC);
    CREATE TABLE IF NOT EXISTS agent_profile (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT NOT NULL,
      prompt_mode TEXT NOT NULL,
      model_id TEXT,
      thinking_level TEXT,
      tools_json TEXT,
      extension_tools_json TEXT,
      resource_selection_json TEXT,
      provider_requirements_json TEXT,
      import_provenance_json TEXT,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_profile_status_updated
      ON agent_profile(status, updated_at);
    CREATE TABLE IF NOT EXISTS agent_profile_version (
      id TEXT PRIMARY KEY,
      profile_id TEXT NOT NULL,
      version_number INTEGER NOT NULL,
      digest TEXT NOT NULL,
      config_json TEXT NOT NULL,
      status TEXT NOT NULL,
      validation_json TEXT,
      released_at INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE(profile_id, version_number),
      UNIQUE(profile_id, digest)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_profile_version_profile
      ON agent_profile_version(profile_id, version_number DESC);
    CREATE INDEX IF NOT EXISTS idx_agent_profile_version_status
      ON agent_profile_version(status, created_at DESC);
    CREATE TABLE IF NOT EXISTS session_agent_binding (
      session_file TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      profile_id TEXT NOT NULL,
      snapshot_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_agent_binding_profile
      ON session_agent_binding(profile_id, created_at);
    CREATE TABLE IF NOT EXISTS system_prompt_preset (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      system_prompt TEXT NOT NULL,
      prompt_mode TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_system_prompt_preset_status_updated
      ON system_prompt_preset(status, updated_at);
    CREATE TABLE IF NOT EXISTS session_prompt_binding (
      session_file TEXT PRIMARY KEY,
      session_id TEXT NOT NULL UNIQUE,
      preset_id TEXT,
      snapshot_json TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_session_prompt_binding_preset
      ON session_prompt_binding(preset_id, created_at);
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
  try {
    d.exec('ALTER TABLE agent_profile ADD COLUMN extension_tools_json TEXT')
  } catch {
    // Existing and new databases both converge on the same column.
  }
  try {
    d.exec('ALTER TABLE agent_profile ADD COLUMN resource_selection_json TEXT')
  } catch {
    // Existing and new databases both converge on the same column.
  }
  try {
    d.exec('ALTER TABLE agent_profile ADD COLUMN provider_requirements_json TEXT')
  } catch {
    // Existing and new databases both converge on the same column.
  }
  try {
    d.exec('ALTER TABLE agent_profile ADD COLUMN import_provenance_json TEXT')
  } catch {
    // Existing and new databases both converge on the same column.
  }
  try {
    d.exec('ALTER TABLE agent_case ADD COLUMN provenance_json TEXT')
  } catch {
    // Existing and new databases both converge on the same column.
  }
  try {
    d.exec('ALTER TABLE agent_case ADD COLUMN verification_json TEXT')
  } catch {
    // Existing and new databases both converge on the same column.
  }
  try {
    d.exec('ALTER TABLE agent_evaluation_suite ADD COLUMN version_id TEXT')
  } catch {
    // Existing and new databases both converge on the same column.
  }
  try {
    d.exec('ALTER TABLE agent_evaluation_suite ADD COLUMN baseline_suite_id TEXT')
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

function mapAgentCaseRow(row: unknown): AgentCase | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  let tags: string[] = []
  try {
    const parsed = JSON.parse(String(value.tags_json || '[]')) as unknown
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    tags = []
  }
  let provenance: AgentCase['provenance']
  let lastVerification: AgentCase['lastVerification']
  try {
    if (value.provenance_json) {
      provenance = JSON.parse(String(value.provenance_json)) as AgentCase['provenance']
    }
  } catch {
    provenance = undefined
  }
  try {
    if (value.verification_json) {
      lastVerification = JSON.parse(String(value.verification_json)) as AgentCase['lastVerification']
    }
  } catch {
    lastVerification = undefined
  }
  return {
    id: String(value.id || ''),
    name: String(value.name || ''),
    summary: value.summary ? String(value.summary) : undefined,
    tags,
    status: String(value.status || 'draft') as AgentCase['status'],
    workspacePath: String(value.workspace_path || ''),
    sourceSessionId: String(value.source_session_id || ''),
    sourceSessionFile: String(value.source_session_file || ''),
    modelId: value.model_id ? String(value.model_id) : undefined,
    thinkingLevel: value.thinking_level ? String(value.thinking_level) : undefined,
    provenance,
    lastVerification,
    createdAt: Number(value.created_at || 0),
    updatedAt: Number(value.updated_at || 0),
  }
}

function mapAgentEvaluationSuiteRow(row: unknown): AgentEvaluationSuite | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  const id = String(value.id || '')
  const profileId = String(value.profile_id || '')
  if (!id || !profileId) return null
  return {
    id,
    name: String(value.name || ''),
    description: value.description ? String(value.description) : undefined,
    workspacePath: String(value.workspace_path || ''),
    profileId,
    versionId: value.version_id ? String(value.version_id) : undefined,
    baselineSuiteId: value.baseline_suite_id ? String(value.baseline_suite_id) : undefined,
    status: String(value.status || 'active') as AgentEvaluationSuite['status'],
    createdAt: Number(value.created_at || 0),
    updatedAt: Number(value.updated_at || 0),
  }
}

function mapAgentEvaluationScenarioRow(row: unknown): AgentEvaluationScenario | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  let tags: string[] = []
  try {
    const parsed = JSON.parse(String(value.tags_json || '[]')) as unknown
    if (Array.isArray(parsed)) tags = parsed.filter((tag): tag is string => typeof tag === 'string')
  } catch {
    tags = []
  }
  const id = String(value.id || '')
  const suiteId = String(value.suite_id || '')
  if (!id || !suiteId) return null
  return {
    id,
    suiteId,
    name: String(value.name || ''),
    prompt: String(value.prompt || ''),
    expectedOutcome: value.expected_outcome ? String(value.expected_outcome) : undefined,
    tags,
    sortOrder: Number(value.sort_order || 0),
    createdAt: Number(value.created_at || 0),
    updatedAt: Number(value.updated_at || 0),
  }
}

function mapAgentEvaluationRunRow(row: unknown): AgentEvaluationRun | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  let evidence: AgentEvaluationRun['evidence']
  try {
    evidence = JSON.parse(String(value.evidence_json || '')) as AgentEvaluationRun['evidence']
  } catch {
    return null
  }
  const id = String(value.id || '')
  const suiteId = String(value.suite_id || '')
  const scenarioId = String(value.scenario_id || '')
  if (!id || !suiteId || !scenarioId || !evidence?.sourceSessionFile) return null
  return {
    id,
    suiteId,
    scenarioId,
    sourceCaseId: String(value.source_case_id || ''),
    evidence,
    verdict: String(value.verdict || 'pending') as AgentEvaluationRun['verdict'],
    notes: value.notes ? String(value.notes) : undefined,
    createdAt: Number(value.created_at || 0),
    updatedAt: Number(value.updated_at || 0),
  }
}

function mapAgentVersionRow(row: unknown): AgentVersion | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  let config: AgentVersion['config']
  let validation: AgentVersion['validation']
  try {
    config = JSON.parse(String(value.config_json || '')) as AgentVersion['config']
    if (value.validation_json) {
      validation = JSON.parse(String(value.validation_json)) as AgentVersion['validation']
    }
  } catch {
    return null
  }
  const id = String(value.id || '')
  const profileId = String(value.profile_id || '')
  const digest = String(value.digest || '')
  if (!id || !profileId || !digest || !config?.name || !config.systemPrompt) return null
  return {
    id,
    profileId,
    number: Number(value.version_number || 0),
    digest,
    config,
    status: String(value.status || 'candidate') as AgentVersion['status'],
    validation,
    releasedAt: value.released_at ? Number(value.released_at) : undefined,
    createdAt: Number(value.created_at || 0),
  }
}

function mapAgentProfileRow(row: unknown): AgentProfile | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  let tools: string[] | undefined
  if (value.tools_json != null) {
    try {
      const parsed = JSON.parse(String(value.tools_json)) as unknown
      if (Array.isArray(parsed)) {
        tools = parsed.filter((tool): tool is string => typeof tool === 'string')
      }
    } catch {
      tools = undefined
    }
  }
  let extensionTools: string[] | undefined
  if (value.extension_tools_json != null) {
    try {
      const parsed = JSON.parse(String(value.extension_tools_json)) as unknown
      if (Array.isArray(parsed)) {
        extensionTools = parsed.filter((tool): tool is string => typeof tool === 'string')
      }
    } catch {
      extensionTools = undefined
    }
  }
  let resourceSelection: AgentProfile['resourceSelection']
  if (value.resource_selection_json != null) {
    try {
      const parsed = JSON.parse(String(value.resource_selection_json)) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const candidate = parsed as Record<string, unknown>
        if (
          (candidate.mode === 'inherit' || candidate.mode === 'selected') &&
          Array.isArray(candidate.packageIds) &&
          Array.isArray(candidate.resourceIds) &&
          (candidate.projectContext === 'inherit' || candidate.projectContext === 'none')
        ) {
          resourceSelection = {
            mode: candidate.mode,
            packageIds: candidate.packageIds.filter(
              (id): id is string => typeof id === 'string',
            ),
            resourceIds: candidate.resourceIds.filter(
              (id): id is string => typeof id === 'string',
            ),
            projectContext: candidate.projectContext,
          }
        }
      }
    } catch {
      resourceSelection = undefined
    }
  }
  let providerRequirements: AgentProfile['providerRequirements']
  if (value.provider_requirements_json != null) {
    try {
      const parsed = JSON.parse(String(value.provider_requirements_json)) as unknown
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const candidate = parsed as Record<string, unknown>
        providerRequirements = {
          reasoning: candidate.reasoning === true,
          imageInput: candidate.imageInput === true,
          minContextWindow:
            typeof candidate.minContextWindow === 'number' && candidate.minContextWindow > 0
              ? candidate.minContextWindow
              : undefined,
        }
      }
    } catch {
      providerRequirements = undefined
    }
  }
  let importProvenance: AgentProfile['importProvenance']
  if (value.import_provenance_json != null) {
    try {
      importProvenance = JSON.parse(String(value.import_provenance_json)) as AgentProfile['importProvenance']
    } catch {
      importProvenance = undefined
    }
  }
  return {
    id: String(value.id || ''),
    name: String(value.name || ''),
    description: value.description ? String(value.description) : undefined,
    systemPrompt: String(value.system_prompt || ''),
    promptMode: String(value.prompt_mode || 'append') as AgentProfile['promptMode'],
    modelId: value.model_id ? String(value.model_id) : undefined,
    thinkingLevel: value.thinking_level ? String(value.thinking_level) : undefined,
    tools,
    extensionTools,
    resourceSelection,
    providerRequirements,
    importProvenance,
    status: String(value.status || 'active') as AgentProfile['status'],
    createdAt: Number(value.created_at || 0),
    updatedAt: Number(value.updated_at || 0),
  }
}

function mapSessionAgentBindingRow(row: unknown): SessionAgentBinding | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  let snapshot: AgentProfileSnapshot
  try {
    snapshot = JSON.parse(String(value.snapshot_json || '')) as AgentProfileSnapshot
  } catch {
    return null
  }
  if (!snapshot?.profileId || !snapshot.name || !snapshot.systemPrompt) return null
  return {
    sessionId: String(value.session_id || ''),
    sessionFile: String(value.session_file || ''),
    profileId: String(value.profile_id || snapshot.profileId),
    snapshot,
    createdAt: Number(value.created_at || 0),
  }
}

function mapSystemPromptPresetRow(row: unknown): SystemPromptPreset | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  return {
    id: String(value.id || ''),
    name: String(value.name || ''),
    description: value.description ? String(value.description) : undefined,
    systemPrompt: String(value.system_prompt || ''),
    promptMode: String(value.prompt_mode || 'append') as SystemPromptPreset['promptMode'],
    status: String(value.status || 'active') as SystemPromptPreset['status'],
    createdAt: Number(value.created_at || 0),
    updatedAt: Number(value.updated_at || 0),
  }
}

function mapSessionPromptBindingRow(row: unknown): SessionPromptBinding | null {
  if (!row || typeof row !== 'object') return null
  const value = row as Record<string, unknown>
  let snapshot: SystemPromptSnapshot
  try {
    snapshot = JSON.parse(String(value.snapshot_json || '')) as SystemPromptSnapshot
  } catch {
    return null
  }
  if (!snapshot?.name || !snapshot.systemPrompt || !snapshot.promptMode) return null
  return {
    sessionId: String(value.session_id || ''),
    sessionFile: String(value.session_file || ''),
    presetId: value.preset_id ? String(value.preset_id) : undefined,
    snapshot,
    createdAt: Number(value.created_at || 0),
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
  saveSystemPromptPreset(preset: SystemPromptPreset): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO system_prompt_preset
        (id, name, description, system_prompt, prompt_mode, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         system_prompt = excluded.system_prompt,
         prompt_mode = excluded.prompt_mode,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    ).run(
      preset.id,
      preset.name,
      preset.description ?? null,
      preset.systemPrompt,
      preset.promptMode,
      preset.status,
      preset.createdAt,
      preset.updatedAt,
    )
    return true
  },

  getSystemPromptPreset(id: string): SystemPromptPreset | null {
    const d = getDb()
    if (!d) return null
    return mapSystemPromptPresetRow(
      d.prepare('SELECT * FROM system_prompt_preset WHERE id = ?').get(id),
    )
  },

  listSystemPromptPresets(options?: { includeArchived?: boolean }): SystemPromptPreset[] {
    const d = getDb()
    if (!d) return []
    const where = options?.includeArchived === true ? '' : " WHERE status != 'archived'"
    return d
      .prepare(`SELECT * FROM system_prompt_preset${where} ORDER BY updated_at DESC`)
      .all()
      .map(mapSystemPromptPresetRow)
      .filter((preset): preset is SystemPromptPreset => preset != null)
  },

  bindSessionPrompt(binding: SessionPromptBinding): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO session_prompt_binding
        (session_file, session_id, preset_id, snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_file) DO UPDATE SET
         session_id = excluded.session_id,
         preset_id = excluded.preset_id,
         snapshot_json = excluded.snapshot_json,
         created_at = excluded.created_at`,
    ).run(
      binding.sessionFile,
      binding.sessionId,
      binding.presetId ?? null,
      JSON.stringify(binding.snapshot),
      binding.createdAt,
    )
    return true
  },

  getSessionPromptBinding(options: {
    sessionId?: string
    sessionFile?: string
  }): SessionPromptBinding | null {
    const d = getDb()
    if (!d) return null
    if (options.sessionFile) {
      return mapSessionPromptBindingRow(
        d
          .prepare('SELECT * FROM session_prompt_binding WHERE session_file = ?')
          .get(options.sessionFile),
      )
    }
    if (options.sessionId) {
      return mapSessionPromptBindingRow(
        d
          .prepare('SELECT * FROM session_prompt_binding WHERE session_id = ?')
          .get(options.sessionId),
      )
    }
    return null
  },

  saveAgentProfile(profile: AgentProfile): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO agent_profile
        (id, name, description, system_prompt, prompt_mode, model_id, thinking_level,
         tools_json, extension_tools_json, resource_selection_json, provider_requirements_json,
         import_provenance_json, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         system_prompt = excluded.system_prompt,
         prompt_mode = excluded.prompt_mode,
         model_id = excluded.model_id,
         thinking_level = excluded.thinking_level,
         tools_json = excluded.tools_json,
         extension_tools_json = excluded.extension_tools_json,
         resource_selection_json = excluded.resource_selection_json,
         provider_requirements_json = excluded.provider_requirements_json,
         import_provenance_json = excluded.import_provenance_json,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    ).run(
      profile.id,
      profile.name,
      profile.description ?? null,
      profile.systemPrompt,
      profile.promptMode,
      profile.modelId ?? null,
      profile.thinkingLevel ?? null,
      profile.tools === undefined ? null : JSON.stringify(profile.tools),
      profile.extensionTools === undefined ? null : JSON.stringify(profile.extensionTools),
      profile.resourceSelection === undefined
        ? null
        : JSON.stringify(profile.resourceSelection),
      profile.providerRequirements === undefined
        ? null
        : JSON.stringify(profile.providerRequirements),
      profile.importProvenance === undefined ? null : JSON.stringify(profile.importProvenance),
      profile.status,
      profile.createdAt,
      profile.updatedAt,
    )
    return true
  },

  getAgentProfile(id: string): AgentProfile | null {
    const d = getDb()
    if (!d) return null
    return mapAgentProfileRow(d.prepare('SELECT * FROM agent_profile WHERE id = ?').get(id))
  },

  listAgentProfiles(options?: { includeArchived?: boolean }): AgentProfile[] {
    const d = getDb()
    if (!d) return []
    const where = options?.includeArchived === true ? '' : " WHERE status != 'archived'"
    return d
      .prepare(`SELECT * FROM agent_profile${where} ORDER BY updated_at DESC`)
      .all()
      .map(mapAgentProfileRow)
      .filter((profile): profile is AgentProfile => profile != null)
  },

  saveAgentVersion(version: AgentVersion): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO agent_profile_version
        (id, profile_id, version_number, digest, config_json, status,
         validation_json, released_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         validation_json = excluded.validation_json,
         released_at = excluded.released_at`,
    ).run(
      version.id,
      version.profileId,
      version.number,
      version.digest,
      JSON.stringify(version.config),
      version.status,
      version.validation ? JSON.stringify(version.validation) : null,
      version.releasedAt ?? null,
      version.createdAt,
    )
    return true
  },

  getAgentVersion(id: string): AgentVersion | null {
    const d = getDb()
    if (!d) return null
    return mapAgentVersionRow(
      d.prepare('SELECT * FROM agent_profile_version WHERE id = ?').get(id),
    )
  },

  getLatestAgentVersion(profileId: string): AgentVersion | null {
    const d = getDb()
    if (!d) return null
    return mapAgentVersionRow(
      d
        .prepare(
          'SELECT * FROM agent_profile_version WHERE profile_id = ? ORDER BY version_number DESC LIMIT 1',
        )
        .get(profileId),
    )
  },

  listAgentVersions(profileId?: string): AgentVersion[] {
    const d = getDb()
    if (!d) return []
    const rows = profileId
      ? d
          .prepare(
            'SELECT * FROM agent_profile_version WHERE profile_id = ? ORDER BY version_number DESC',
          )
          .all(profileId)
      : d
          .prepare(
            'SELECT * FROM agent_profile_version ORDER BY created_at DESC, version_number DESC',
          )
          .all()
    return rows.map(mapAgentVersionRow).filter((version): version is AgentVersion => version != null)
  },

  bindSessionAgent(binding: SessionAgentBinding): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO session_agent_binding
        (session_file, session_id, profile_id, snapshot_json, created_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_file) DO UPDATE SET
         session_id = excluded.session_id,
         profile_id = excluded.profile_id,
         snapshot_json = excluded.snapshot_json,
         created_at = excluded.created_at`,
    ).run(
      binding.sessionFile,
      binding.sessionId,
      binding.profileId,
      JSON.stringify(binding.snapshot),
      binding.createdAt,
    )
    return true
  },

  getSessionAgentBinding(options: {
    sessionId?: string
    sessionFile?: string
  }): SessionAgentBinding | null {
    const d = getDb()
    if (!d) return null
    if (options.sessionFile) {
      return mapSessionAgentBindingRow(
        d
          .prepare('SELECT * FROM session_agent_binding WHERE session_file = ?')
          .get(options.sessionFile),
      )
    }
    if (options.sessionId) {
      return mapSessionAgentBindingRow(
        d
          .prepare('SELECT * FROM session_agent_binding WHERE session_id = ?')
          .get(options.sessionId),
      )
    }
    return null
  },

  saveAgentRunRuntimeEvidence(
    sessionFile: string,
    evidence: NonNullable<AgentRunHistoryItem['runtimeEvidence']>,
  ): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO agent_run_runtime_evidence
        (session_file, run_id, resource_json, context_before_json, context_after_json, captured_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT(session_file) DO UPDATE SET
         run_id = excluded.run_id,
         resource_json = COALESCE(excluded.resource_json, agent_run_runtime_evidence.resource_json),
         context_before_json = COALESCE(excluded.context_before_json, agent_run_runtime_evidence.context_before_json),
         context_after_json = CASE
           WHEN excluded.run_id IS NOT agent_run_runtime_evidence.run_id THEN excluded.context_after_json
           ELSE COALESCE(excluded.context_after_json, agent_run_runtime_evidence.context_after_json)
         END,
         captured_at = excluded.captured_at`,
    ).run(
      sessionFile,
      evidence.runId || null,
      evidence.resourceEvidence ? JSON.stringify(evidence.resourceEvidence) : null,
      evidence.contextBefore ? JSON.stringify(evidence.contextBefore) : null,
      evidence.contextAfter ? JSON.stringify(evidence.contextAfter) : null,
      evidence.capturedAt,
    )
    return true
  },

  getAgentRunRuntimeEvidence(sessionFile: string): AgentRunHistoryItem['runtimeEvidence'] | undefined {
    const d = getDb()
    if (!d) return undefined
    const row = d.prepare('SELECT * FROM agent_run_runtime_evidence WHERE session_file = ?').get(sessionFile) as Record<string, unknown> | undefined
    if (!row) return undefined
    const parse = <T>(value: unknown): T | undefined => {
      if (!value) return undefined
      try { return JSON.parse(String(value)) as T } catch { return undefined }
    }
    return {
      runId: row.run_id ? String(row.run_id) : undefined,
      resourceEvidence: parse(row.resource_json),
      contextBefore: parse(row.context_before_json),
      contextAfter: parse(row.context_after_json),
      capturedAt: Number(row.captured_at || 0),
    }
  },

  saveAgentRunTurnEvidence(sessionFile: string, evidence: NonNullable<AgentRunHistoryItem['turns']>[number]): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO agent_run_turn_evidence
        (session_file, run_id, evidence_json, started_at, updated_at)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(session_file, run_id) DO UPDATE SET
         evidence_json = excluded.evidence_json,
         started_at = excluded.started_at,
         updated_at = excluded.updated_at`,
    ).run(sessionFile, evidence.runId, JSON.stringify(evidence), evidence.startedAt, evidence.endedAt || Date.now())
    return true
  },

  getAgentRunTurnEvidence(sessionFile: string, runId: string): NonNullable<AgentRunHistoryItem['turns']>[number] | undefined {
    const d = getDb()
    if (!d) return undefined
    const row = d.prepare('SELECT evidence_json FROM agent_run_turn_evidence WHERE session_file = ? AND run_id = ?').get(sessionFile, runId) as { evidence_json?: string } | undefined
    if (!row?.evidence_json) return undefined
    try { return JSON.parse(row.evidence_json) as NonNullable<AgentRunHistoryItem['turns']>[number] } catch { return undefined }
  },

  listAgentRunTurnEvidence(sessionFile: string, limit = 50): NonNullable<AgentRunHistoryItem['turns']> {
    const d = getDb()
    if (!d) return []
    return d.prepare('SELECT evidence_json FROM agent_run_turn_evidence WHERE session_file = ? ORDER BY started_at DESC LIMIT ?').all(sessionFile, limit).flatMap((row: unknown) => {
      try { return [JSON.parse(String((row as { evidence_json?: string }).evidence_json || '')) as NonNullable<AgentRunHistoryItem['turns']>[number]] } catch { return [] }
    }).reverse()
  },

  listSessionAgentBindings(profileId: string): SessionAgentBinding[] {
    const d = getDb()
    if (!d) return []
    return d
      .prepare('SELECT * FROM session_agent_binding WHERE profile_id = ? ORDER BY created_at DESC')
      .all(profileId)
      .map(mapSessionAgentBindingRow)
      .filter((binding): binding is SessionAgentBinding => binding != null)
  },

  saveAgentCase(agentCase: AgentCase): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO agent_case
        (id, name, summary, tags_json, status, workspace_path, source_session_id,
         source_session_file, model_id, thinking_level, provenance_json, verification_json,
         created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         summary = excluded.summary,
         tags_json = excluded.tags_json,
         status = excluded.status,
         workspace_path = excluded.workspace_path,
         source_session_id = excluded.source_session_id,
         source_session_file = excluded.source_session_file,
         model_id = excluded.model_id,
         thinking_level = excluded.thinking_level,
         provenance_json = excluded.provenance_json,
         verification_json = excluded.verification_json,
         updated_at = excluded.updated_at`,
    ).run(
      agentCase.id,
      agentCase.name,
      agentCase.summary ?? null,
      JSON.stringify(agentCase.tags),
      agentCase.status,
      agentCase.workspacePath,
      agentCase.sourceSessionId,
      agentCase.sourceSessionFile,
      agentCase.modelId ?? null,
      agentCase.thinkingLevel ?? null,
      agentCase.provenance ? JSON.stringify(agentCase.provenance) : null,
      agentCase.lastVerification ? JSON.stringify(agentCase.lastVerification) : null,
      agentCase.createdAt,
      agentCase.updatedAt,
    )
    return true
  },

  getAgentCase(id: string): AgentCase | null {
    const d = getDb()
    if (!d) return null
    return mapAgentCaseRow(d.prepare('SELECT * FROM agent_case WHERE id = ?').get(id))
  },

  listAgentCases(options?: {
    workspacePath?: string
    includeArchived?: boolean
  }): AgentCase[] {
    const d = getDb()
    if (!d) return []
    const clauses: string[] = []
    const args: unknown[] = []
    if (options?.workspacePath) {
      clauses.push('workspace_path = ?')
      args.push(options.workspacePath)
    }
    if (options?.includeArchived !== true) clauses.push("status != 'archived'")
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    return d
      .prepare(`SELECT * FROM agent_case${where} ORDER BY updated_at DESC`)
      .all(...args)
      .map(mapAgentCaseRow)
      .filter((agentCase): agentCase is AgentCase => agentCase != null)
  },

  saveAgentEvaluationSuite(suite: AgentEvaluationSuite): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO agent_evaluation_suite
        (id, name, description, workspace_path, profile_id, version_id, baseline_suite_id, status, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         name = excluded.name,
         description = excluded.description,
         workspace_path = excluded.workspace_path,
         profile_id = excluded.profile_id,
         version_id = excluded.version_id,
         baseline_suite_id = excluded.baseline_suite_id,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    ).run(
      suite.id,
      suite.name,
      suite.description ?? null,
      suite.workspacePath,
      suite.profileId,
      suite.versionId ?? null,
      suite.baselineSuiteId ?? null,
      suite.status,
      suite.createdAt,
      suite.updatedAt,
    )
    return true
  },

  saveAgentEvaluationSuiteClone(
    suite: AgentEvaluationSuite,
    scenarios: AgentEvaluationScenario[],
  ): boolean {
    const d = getDb()
    if (!d) return false
    d.exec('BEGIN IMMEDIATE')
    try {
      d.prepare(
        `INSERT INTO agent_evaluation_suite
          (id, name, description, workspace_path, profile_id, version_id, baseline_suite_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        suite.id,
        suite.name,
        suite.description ?? null,
        suite.workspacePath,
        suite.profileId,
        suite.versionId ?? null,
        suite.baselineSuiteId ?? null,
        suite.status,
        suite.createdAt,
        suite.updatedAt,
      )
      const statement = d.prepare(
        `INSERT INTO agent_evaluation_scenario
          (id, suite_id, name, prompt, expected_outcome, tags_json, sort_order, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      for (const scenario of scenarios) {
        statement.run(
          scenario.id,
          scenario.suiteId,
          scenario.name,
          scenario.prompt,
          scenario.expectedOutcome ?? null,
          JSON.stringify(scenario.tags),
          scenario.sortOrder,
          scenario.createdAt,
          scenario.updatedAt,
        )
      }
      d.exec('COMMIT')
      return true
    } catch (error) {
      d.exec('ROLLBACK')
      throw error
    }
  },

  getAgentEvaluationSuite(id: string): AgentEvaluationSuite | null {
    const d = getDb()
    if (!d) return null
    return mapAgentEvaluationSuiteRow(
      d.prepare('SELECT * FROM agent_evaluation_suite WHERE id = ?').get(id),
    )
  },

  listAgentEvaluationSuites(options?: {
    workspacePath?: string
    includeArchived?: boolean
  }): AgentEvaluationSuite[] {
    const d = getDb()
    if (!d) return []
    const clauses: string[] = []
    const args: unknown[] = []
    if (options?.workspacePath) {
      clauses.push('workspace_path = ?')
      args.push(options.workspacePath)
    }
    if (options?.includeArchived !== true) clauses.push("status != 'archived'")
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : ''
    return d
      .prepare(`SELECT * FROM agent_evaluation_suite${where} ORDER BY updated_at DESC`)
      .all(...args)
      .map(mapAgentEvaluationSuiteRow)
      .filter((suite): suite is AgentEvaluationSuite => suite != null)
  },

  saveAgentEvaluationScenario(scenario: AgentEvaluationScenario): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO agent_evaluation_scenario
        (id, suite_id, name, prompt, expected_outcome, tags_json, sort_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         suite_id = excluded.suite_id,
         name = excluded.name,
         prompt = excluded.prompt,
         expected_outcome = excluded.expected_outcome,
         tags_json = excluded.tags_json,
         sort_order = excluded.sort_order,
         updated_at = excluded.updated_at`,
    ).run(
      scenario.id,
      scenario.suiteId,
      scenario.name,
      scenario.prompt,
      scenario.expectedOutcome ?? null,
      JSON.stringify(scenario.tags),
      scenario.sortOrder,
      scenario.createdAt,
      scenario.updatedAt,
    )
    return true
  },

  getAgentEvaluationScenario(id: string): AgentEvaluationScenario | null {
    const d = getDb()
    if (!d) return null
    return mapAgentEvaluationScenarioRow(
      d.prepare('SELECT * FROM agent_evaluation_scenario WHERE id = ?').get(id),
    )
  },

  listAgentEvaluationScenarios(suiteId: string): AgentEvaluationScenario[] {
    const d = getDb()
    if (!d) return []
    return d
      .prepare(
        'SELECT * FROM agent_evaluation_scenario WHERE suite_id = ? ORDER BY sort_order, created_at',
      )
      .all(suiteId)
      .map(mapAgentEvaluationScenarioRow)
      .filter((scenario): scenario is AgentEvaluationScenario => scenario != null)
  },

  saveAgentEvaluationRun(run: AgentEvaluationRun): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO agent_evaluation_run
        (id, suite_id, scenario_id, source_case_id, evidence_json, verdict, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         evidence_json = excluded.evidence_json,
         verdict = excluded.verdict,
         notes = excluded.notes,
         updated_at = excluded.updated_at`,
    ).run(
      run.id,
      run.suiteId,
      run.scenarioId,
      run.sourceCaseId,
      JSON.stringify(run.evidence),
      run.verdict,
      run.notes ?? null,
      run.createdAt,
      run.updatedAt,
    )
    return true
  },

  getAgentEvaluationRun(id: string): AgentEvaluationRun | null {
    const d = getDb()
    if (!d) return null
    return mapAgentEvaluationRunRow(
      d.prepare('SELECT * FROM agent_evaluation_run WHERE id = ?').get(id),
    )
  },

  listAgentEvaluationRuns(suiteId: string): AgentEvaluationRun[] {
    const d = getDb()
    if (!d) return []
    return d
      .prepare('SELECT * FROM agent_evaluation_run WHERE suite_id = ? ORDER BY created_at DESC')
      .all(suiteId)
      .map(mapAgentEvaluationRunRow)
      .filter((run): run is AgentEvaluationRun => run != null)
  },

  saveAgentEvaluationBatch(batch: AgentEvaluationBatch): boolean {
    const d = getDb()
    if (!d) return false
    d.prepare(
      `INSERT INTO agent_evaluation_batch
        (id, suite_id, workspace_path, status, batch_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         batch_json = excluded.batch_json,
         updated_at = excluded.updated_at`,
    ).run(
      batch.id,
      batch.suiteId,
      batch.workspacePath,
      batch.status,
      JSON.stringify(batch),
      batch.createdAt,
      Date.now(),
    )
    return true
  },

  getAgentEvaluationBatch(id: string): AgentEvaluationBatch | null {
    const d = getDb()
    if (!d) return null
    const row = d.prepare('SELECT batch_json FROM agent_evaluation_batch WHERE id = ?').get(id) as
      | { batch_json?: unknown }
      | undefined
    if (!row?.batch_json) return null
    try {
      return JSON.parse(String(row.batch_json)) as AgentEvaluationBatch
    } catch {
      return null
    }
  },

  getLatestAgentEvaluationBatch(suiteId: string): AgentEvaluationBatch | null {
    const d = getDb()
    if (!d) return null
    const row = d.prepare(
      'SELECT batch_json FROM agent_evaluation_batch WHERE suite_id = ? ORDER BY created_at DESC LIMIT 1',
    ).get(suiteId) as { batch_json?: unknown } | undefined
    if (!row?.batch_json) return null
    try {
      return JSON.parse(String(row.batch_json)) as AgentEvaluationBatch
    } catch {
      return null
    }
  },

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
