import type { AgentProfileSnapshot } from './agent-profile'

export type AgentEvaluationSuiteStatus = 'active' | 'archived'
export type AgentEvaluationVerdict = 'pending' | 'passed' | 'failed'

/** A stable collection of repeatable tasks for one reusable Agent profile. */
export interface AgentEvaluationSuite {
  id: string
  name: string
  description?: string
  workspacePath: string
  profileId: string
  /** Immutable Agent version under test. Optional only for pre-v13 migrated metadata. */
  versionId?: string
  /** Suite whose fixed scenarios were copied to create this version run. */
  baselineSuiteId?: string
  status: AgentEvaluationSuiteStatus
  createdAt: number
  updatedAt: number
}

/** One user-authored task and its human acceptance criteria. */
export interface AgentEvaluationScenario {
  id: string
  suiteId: string
  name: string
  prompt: string
  expectedOutcome?: string
  tags: string[]
  sortOrder: number
  createdAt: number
  updatedAt: number
}

export interface AgentEvaluationMetrics {
  durationMs: number | null
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  cost: number
  toolCalls: number
  failedToolCalls: number
  assistantMessages: number
}

/**
 * Evidence captured from the source Pi JSONL branch. Output and usage remain
 * local; credentials and hidden reasoning are deliberately excluded.
 */
export interface AgentEvaluationEvidence {
  capturedAt: number
  piRuntimeVersion: string
  sourceSessionId: string
  sourceSessionFile: string
  actualPrompt: string
  promptMatched: boolean
  outputText: string
  modelId?: string
  thinkingLevel?: string
  agent?: {
    profileId: string
    name: string
    versionId?: string
    versionNumber?: number
    snapshotCapturedAt: number
    snapshotDigest: string
    snapshot: AgentProfileSnapshot
  }
  metrics: AgentEvaluationMetrics
}

/** One immutable observation plus a mutable human decision. */
export interface AgentEvaluationRun {
  id: string
  suiteId: string
  scenarioId: string
  sourceCaseId: string
  evidence: AgentEvaluationEvidence
  verdict: AgentEvaluationVerdict
  notes?: string
  createdAt: number
  updatedAt: number
}

export type AgentEvaluationBatchStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'

export type AgentEvaluationBatchItemStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'cancelled'
  | 'failed'

export interface AgentEvaluationBatchItem {
  scenarioId: string
  scenarioName: string
  status: AgentEvaluationBatchItemStatus
  runId?: string
  sessionId?: string
  sessionFile?: string
  error?: string
  startedAt?: number
  completedAt?: number
}

/** Durable progress for a sequential, background Pi regression run. */
export interface AgentEvaluationBatch {
  id: string
  suiteId: string
  workspacePath: string
  profileId: string
  versionId: string
  status: AgentEvaluationBatchStatus
  items: AgentEvaluationBatchItem[]
  createdAt: number
  startedAt?: number
  completedAt?: number
}

export interface AgentEvaluationSuiteBundle {
  suite: AgentEvaluationSuite
  scenarios: AgentEvaluationScenario[]
  runs: AgentEvaluationRun[]
}

export interface AgentEvaluationListRequest {
  workspacePath?: string
  includeArchived?: boolean
}

export interface AgentEvaluationListResponse {
  suites: AgentEvaluationSuiteBundle[]
}

export interface AgentEvaluationSuiteCreateRequest {
  name: string
  description?: string
  workspacePath: string
  profileId: string
  versionId: string
}

export interface AgentEvaluationSuiteCreateResponse {
  suite: AgentEvaluationSuite
}

export interface AgentEvaluationSuiteCloneVersionRequest {
  sourceSuiteId: string
  targetVersionId: string
  name?: string
}

export interface AgentEvaluationSuiteCloneVersionResponse {
  bundle: AgentEvaluationSuiteBundle
}

export interface AgentEvaluationScenarioCreateRequest {
  suiteId: string
  name: string
  prompt: string
  expectedOutcome?: string
  tags?: string[]
}

export interface AgentEvaluationScenarioCreateResponse {
  scenario: AgentEvaluationScenario
}

export interface AgentEvaluationAttachCaseRequest {
  suiteId: string
  scenarioId: string
  caseId: string
}

export interface AgentEvaluationAttachCaseResponse {
  run: AgentEvaluationRun
}

export interface AgentEvaluationAssessRequest {
  runId: string
  verdict: AgentEvaluationVerdict
  notes?: string
}

export interface AgentEvaluationAssessResponse {
  run: AgentEvaluationRun
}

export interface AgentEvaluationArchiveRequest {
  suiteId: string
}

export interface AgentEvaluationArchiveResponse {
  suite: AgentEvaluationSuite
}

export type AgentEvaluationComparisonOutcome =
  | 'improved'
  | 'equivalent'
  | 'regressed'
  | 'mixed'
  | 'insufficient'

export type AgentEvaluationComparisonReason =
  | 'scenario-missing'
  | 'run-missing'
  | 'review-pending'
  | 'prompt-drifted'

export interface AgentEvaluationRunDigest {
  id: string
  verdict: AgentEvaluationVerdict
  promptMatched: boolean
  modelId?: string
  thinkingLevel?: string
  metrics: AgentEvaluationMetrics
  createdAt: number
}

export interface AgentEvaluationScenarioComparison {
  key: string
  name: string
  baselineScenarioId?: string
  candidateScenarioId?: string
  baselineRun?: AgentEvaluationRunDigest
  candidateRun?: AgentEvaluationRunDigest
  outcome: Exclude<AgentEvaluationComparisonOutcome, 'mixed'>
  reasons: AgentEvaluationComparisonReason[]
}

export interface AgentEvaluationComparisonDelta {
  passRatePoints: number | null
  averageDurationMs: number | null
  inputTokens: number
  outputTokens: number
  cost: number
  toolCalls: number
  failedToolCalls: number
}

export interface AgentEvaluationVersionComparison {
  baselineSuiteId: string
  candidateSuiteId: string
  baselineVersionId: string
  candidateVersionId: string
  outcome: AgentEvaluationComparisonOutcome
  counts: Record<Exclude<AgentEvaluationComparisonOutcome, 'mixed'>, number>
  pairedRuns: number
  delta: AgentEvaluationComparisonDelta
  scenarios: AgentEvaluationScenarioComparison[]
}

export interface AgentEvaluationCompareRequest {
  baselineSuiteId: string
  candidateSuiteId: string
}

export interface AgentEvaluationCompareResponse {
  comparison: AgentEvaluationVersionComparison
}

export interface AgentEvaluationBatchStartRequest {
  suiteId: string
}

export interface AgentEvaluationBatchGetRequest {
  batchId: string
}

export interface AgentEvaluationBatchLatestRequest {
  suiteId: string
}

export interface AgentEvaluationBatchCancelRequest {
  batchId: string
}

export interface AgentEvaluationBatchResponse {
  batch: AgentEvaluationBatch
}

export interface AgentEvaluationBatchLatestResponse {
  batch: AgentEvaluationBatch | null
}

export interface AgentEvaluationReportExportRequest {
  baselineSuiteId: string
  candidateSuiteId: string
  locale: 'zh' | 'en'
  /** Explicit opt-in for authored prompts, acceptance criteria, and model outputs. */
  includeContent?: boolean
}

export interface AgentEvaluationReportExportResponse {
  bytes: number
  outcome: AgentEvaluationComparisonOutcome
  download: {
    filename: string
    mimeType: 'text/markdown;charset=utf-8'
    base64: string
  }
}
