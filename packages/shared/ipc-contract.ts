// IPC Contract - Complete typed method signatures for Renderer/Main/Worker

import type { AppEvent } from './app-events'
import type { AgentAssetListRequest, AgentAssetListResponse } from './agent-asset'
import type {
  AgentCaseArchiveRequest,
  AgentCaseCreateRequest,
  AgentCaseListRequest,
  AgentCaseListResponse,
  AgentCaseMutationResponse,
  AgentCaseUpdateRequest,
  AgentCaseVerifyRequest,
  AgentCaseVerifyResponse,
} from './agent-case'
import type {
  AgentEvaluationArchiveRequest,
  AgentEvaluationArchiveResponse,
  AgentEvaluationAssessRequest,
  AgentEvaluationAssessResponse,
  AgentEvaluationAttachCaseRequest,
  AgentEvaluationAttachCaseResponse,
  AgentEvaluationBatchCancelRequest,
  AgentEvaluationBatchGetRequest,
  AgentEvaluationBatchLatestRequest,
  AgentEvaluationBatchLatestResponse,
  AgentEvaluationBatchResponse,
  AgentEvaluationBatchStartRequest,
  AgentEvaluationCompareRequest,
  AgentEvaluationCompareResponse,
  AgentEvaluationListRequest,
  AgentEvaluationListResponse,
  AgentEvaluationReportExportRequest,
  AgentEvaluationReportExportResponse,
  AgentEvaluationScenarioCreateRequest,
  AgentEvaluationScenarioCreateResponse,
  AgentEvaluationSuiteCreateRequest,
  AgentEvaluationSuiteCreateResponse,
  AgentEvaluationSuiteCloneVersionRequest,
  AgentEvaluationSuiteCloneVersionResponse,
} from './agent-evaluation'
import type {
  AgentProfileArchiveRequest,
  AgentProfileCreateRequest,
  AgentProfileListRequest,
  AgentProfileListResponse,
  AgentProfileMutationResponse,
  AgentProfilePreviewRequest,
  AgentProfilePreviewResponse,
  AgentProfileUpdateRequest,
  SessionAgentBinding,
  SessionAgentBindingGetRequest,
  SessionAgentBindingGetResponse,
} from './agent-profile'
import type { AgentRunHistoryListRequest, AgentRunHistoryListResponse } from './agent-run-history'
import type {
  AgentVersionListRequest,
  AgentVersionListResponse,
  AgentVersionReadinessRequest,
  AgentVersionReadinessResponse,
  AgentVersionValidateRequest,
  AgentVersionValidateResponse,
} from './agent-version'
import type {
  ConversationConfigBinding,
  ConversationConfigBindingGetRequest,
  ConversationConfigBindingGetResponse,
  ConversationConfigSelection,
  SystemPromptPresetArchiveRequest,
  SystemPromptPresetCreateRequest,
  SystemPromptPresetListRequest,
  SystemPromptPresetListResponse,
  SystemPromptPresetMutationResponse,
  SystemPromptPresetUpdateRequest,
} from './system-prompt-preset'
import type { DiffResult } from './diff-model'
import type { CompatibilityLevel } from './extension-types'
import type { SessionLeaseSnapshot } from './session-lease'
import type {
  ManagedWorktree,
  WorktreeCapability,
  WorktreeCreateRequest,
  WorktreeReconcileResult,
  WorktreeRemoveRequest,
  WorktreeSafety,
} from './managed-worktree'
import type {
  AgentRelationship,
  OrchestrationEnvironment,
  OrchestrationTaskSnapshot,
} from './orchestration'
import type {
  AuditExportRequest,
  AuditQuery,
  AuditQueryResult,
  DiagnosticsPreview,
  FileExportResult,
  MetadataBackup,
  MetadataRestoreRequest,
  ReconciliationSnapshot,
  ReliabilitySnapshot,
} from './reliability'
import type {
  ProviderConnectivityResult,
  ProviderRoute,
  ProviderRouteSetRequest,
  ProviderRoutingConfig,
  ProxyProfile,
  ProxyProfileSaveRequest,
} from './provider-routing'
import type { PiInspectorRequest, PiInspectorResponse } from './pi-inspector'
import type {
  PiPackageImportApplyRequest,
  PiPackageImportApplyResponse,
  PiPackageImportPreviewRequest,
  PiPackageImportPreviewResponse,
  PiPackageStudioExportRequest,
  PiPackageStudioExportResponse,
  PiPackageStudioPreviewRequest,
  PiPackageStudioPreviewResponse,
} from './pi-package-studio'
import type {
  PiPackageMutationRequest,
  PiPackageMutationResponse,
  PiPackageUpdateCheckRequest,
  PiPackageUpdateCheckResponse,
  PiResourceCenterRequest,
  PiResourceCenterResponse,
  PiResourceFilterSetRequest,
  PiResourceFilterSetResponse,
} from './pi-resource-center'

// ── Workspace ──
export interface WorkspaceOpenRequest { path?: string; awaitWorker?: boolean }
export interface WorkspaceEnsureWorkerRequest { path: string }
export interface WorkspaceEnsureWorkerResponse { ok: boolean; workspaceId: string; sessionId?: string; model?: string; error?: string }
export interface WorkspaceOpenResponse { workspaceId: string; path: string; name: string }
export interface WorkspaceSwitchRequest { workspaceId: string }
export interface WorkspaceSwitchResponse { workspaceId: string; path: string; name: string }
export interface WorktreeRootRequest { rootWorkspacePath?: string }
export interface WorktreeCapabilityResponse {
  ok: boolean
  capability?: WorktreeCapability
  error?: string
  code?: string
}
export interface WorktreeListResponse {
  ok: boolean
  worktrees?: ManagedWorktree[]
  managedRoot?: string
  error?: string
  code?: string
}
export interface WorktreeCreateResponse {
  ok: boolean
  worktree?: ManagedWorktree
  error?: string
  code?: string
}
export interface WorktreeInspectRemovalRequest { id: string }
export interface WorktreeInspectRemovalResponse {
  ok: boolean
  safety?: WorktreeSafety
  error?: string
  code?: string
}
export interface WorktreeRemoveResponse {
  ok: boolean
  worktree?: ManagedWorktree
  safety?: WorktreeSafety
  error?: string
  code?: string
}
export interface WorktreeReconcileResponse extends Partial<WorktreeReconcileResult> {
  ok: boolean
  error?: string
  code?: string
}
export interface OrchestrationListRequest { rootWorkspacePath?: string }
export interface OrchestrationListResponse { relationships: AgentRelationship[] }
export interface OrchestrationCreateRequest {
  parentSessionFile: string
  rootWorkspacePath?: string
  name?: string
  goal: string
  environment?: OrchestrationEnvironment
  timeoutMs?: number
}
export interface OrchestrationCreateResponse { relationship: AgentRelationship }
export interface OrchestrationReadRequest { relationshipId: string }
export interface OrchestrationReadResponse { snapshot: OrchestrationTaskSnapshot }
export interface OrchestrationSendRequest {
  relationshipId: string
  text: string
}
export interface OrchestrationMutationResponse { relationship: AgentRelationship }
export interface OrchestrationResumeRequest {
  relationshipId: string
  action: 'continue' | 'retry'
}
export interface ReliabilityRootRequest { rootWorkspacePath?: string }
export interface ReliabilitySnapshotResponse { snapshot: ReliabilitySnapshot }
export interface ReliabilityReconcileResponse { reconciliation: ReconciliationSnapshot }
export interface AuditQueryResponse extends AuditQueryResult {}
export interface DiagnosticsPreviewResponse { preview: DiagnosticsPreview }
export interface MetadataBackupListResponse { backups: MetadataBackup[] }
export interface MetadataBackupCreateResponse { backup: MetadataBackup }
export interface MetadataBackupRestoreResponse {
  restored: MetadataBackup
  rollback: MetadataBackup
}
export interface ProviderRoutingGetResponse {
  config: ProviderRoutingConfig
}
export interface ProviderRoutingMutationResponse {
  route?: ProviderRoute
  profile?: ProxyProfile
  workersUpdated: number
  workersDeferred: number
}
export interface ProxyProfileDeleteRequest {
  id: string
  confirmed: true
}
export interface ProviderRoutingDiagnoseRequest {
  provider: string
}
export interface ProviderRoutingDiagnoseResponse {
  result: ProviderConnectivityResult
}

// ── Session ──
export interface SessionInfo {
  sessionId: string
  sessionFile?: string
  workspaceId: string
  title: string
  createdAt: number
  updatedAt: number
  modelId: string
  thinkingLevel?: string
  status: 'idle' | 'busy' | 'error'
}
export interface SessionListRequest { workspaceId?: string }
export interface SessionListResponse { sessions: SessionInfo[] }
export interface SessionOpenRequest { sessionId: string; sessionFile?: string }
export interface SessionOpenResponse { session: SessionInfo }
export interface SessionNewRequest {
  workspaceId: string
  title?: string
  /** One mutually-exclusive configuration selected before the first message. */
  conversationConfig?: ConversationConfigSelection
  /** Optional reusable Agent selected before the first message is sent. */
  agentProfileId?: string
  /** Full provider/model key inherited from the last active conversation. */
  modelId?: string
  thinkingLevel?: string
}
export interface SessionNewResponse {
  session: SessionInfo
  agentBinding?: SessionAgentBinding
  conversationConfigBinding?: ConversationConfigBinding
}
export interface SessionForkRequest {
  sessionId?: string
  sessionFile: string
  entryId?: string
  /** @deprecated use entryId */
  fromMessageId?: string
  title?: string
  position?: 'before' | 'at'
  workspaceId?: string
}
export interface SessionForkResponse {
  cancelled?: boolean
  error?: string
  editorText?: string
  sessionId?: string
  sessionFile?: string
  workspaceId?: string
  session: SessionInfo & { sessionFile?: string; error?: string }
}
export interface SessionCloneRequest {
  sessionId?: string
  sessionFile: string
  title?: string
  workspaceId?: string
}
export interface SessionCloneResponse {
  cancelled?: boolean
  error?: string
  sessionId?: string
  sessionFile?: string
  workspaceId?: string
  session: SessionInfo & { sessionFile?: string; error?: string }
}
export interface SessionForkCandidatesRequest { sessionFile: string }
export interface SessionForkCandidatesResponse {
  messages: Array<{ entryId: string; text: string }>
  error?: string
}
export interface SessionRenameRequest { sessionId: string; title: string }
export interface SessionRenameResponse { session: SessionInfo }
export interface SessionCompactRequest { sessionId: string }
export interface SessionCompactResponse { sessionId: string; compacted: boolean; tokensSaved: number }
export interface SessionExportRequest { sessionId: string; format: 'json' | 'markdown' | 'html' }
export interface SessionExportResponse { content: string; format: string; filename: string }
export interface SessionLeaseInspectRequest { sessionFile: string }
export interface SessionLeaseInspectResponse { snapshot: SessionLeaseSnapshot }
export interface SessionLeaseTakeoverRequest { sessionFile: string; confirmed: true }
export interface SessionLeaseTakeoverResponse {
  acquired: boolean
  snapshot: SessionLeaseSnapshot
}

// ── Prompt ──
export interface PromptSendRequest { sessionId: string; text: string }
export interface PromptSendResponse {
  messageId?: string
  error?: 'SESSION_LEASE_CONFLICT'
  leaseConflict?: SessionLeaseSnapshot
}
export interface PromptSteerRequest { sessionId: string; text: string }
export interface PromptSteerResponse {
  steered: boolean
  error?: 'SESSION_LEASE_CONFLICT'
  leaseConflict?: SessionLeaseSnapshot
}
export interface PromptFollowUpRequest { sessionId: string; text: string }
export interface PromptFollowUpResponse {
  messageId?: string
  error?: 'SESSION_LEASE_CONFLICT'
  leaseConflict?: SessionLeaseSnapshot
}
export interface PromptAbortRequest { sessionId: string }
export interface PromptAbortResponse { aborted: boolean }

// ── Model ──
export interface ModelInfo {
  id: string
  name: string
  provider: string
  contextWindow: number
  maxOutput: number
  available: boolean
  reasoning: boolean
  input: Array<'text' | 'image'>
}
export interface ModelListRequest {
  workspaceId?: string
  /** catalog=当前 Pi agent 目录的 models.json；available=已配置鉴权（Composer） */
  scope?: 'catalog' | 'available'
}
export interface ModelListResponse { models: ModelInfo[] }
export interface ModelSetRequest {
  sessionId: string
  provider?: string
  modelId: string
  workspaceId?: string
  sessionFile?: string
  /** Ephemeral draft: validate and persist for the session that will be created on first send. */
  deferUntilSession?: boolean
}
export interface ModelSetResponse { modelId: string }
export interface ModelCycleRequest { sessionId: string; direction?: 'next' | 'prev' }
export interface ModelCycleResponse { modelId: string; thinkingLevel: string }

export type PiModelsApiType =
  | 'openai-completions'
  | 'openai-responses'
  | 'anthropic-messages'
  | 'google-generative-ai'

export interface PiModelsProviderConfig {
  name?: string
  baseUrl?: string
  api?: PiModelsApiType
  apiKey?: string
  authHeader?: boolean
  headers?: Record<string, string>
  compat?: Record<string, unknown>
  models?: {
    id: string
    name?: string
    api?: string
    reasoning?: boolean
    input?: ('text' | 'image')[]
    contextWindow?: number
    maxTokens?: number
    thinkingLevelMap?: Record<string, string>
  }[]
  modelOverrides?: Record<string, unknown>
}

export interface PiModelsConfigPayload {
  providers: Record<string, PiModelsProviderConfig>
}

export interface PiModelsGetRequest {}
export interface PiModelsGetResponse {
  path: string
  config: PiModelsConfigPayload
  parseError?: string
  schemaError?: string
}

export interface PiModelsSetRequest { config: PiModelsConfigPayload }
export interface PiModelsSetResponse { ok: boolean; path: string; error?: string }

export interface PiModelsFetchRequest {
  baseUrl: string
  apiKey?: string
  authHeader?: boolean
}
export interface PiModelsFetchResponse {
  ok: boolean
  ids?: string[]
  error?: string
}

export interface PiConfigImportInspectRequest {}
export interface PiConfigImportInspectResponse {
  available: boolean
  sourceDir: string
  targetDir: string
  files: Array<'auth.json' | 'models.json' | 'settings.json'>
  providers: string[]
  targetHasConfig: boolean
  reason?: 'same-directory' | 'source-empty'
}
export interface PiConfigImportRunRequest { confirmed: true }
export interface PiConfigImportRunResponse {
  ok: true
  imported: Array<'auth.json' | 'models.json' | 'settings.json'>
  backupFiles: string[]
  targetDir: string
}

// ── ThinkingLevel ──
export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'
export interface ThinkingLevelSetRequest { sessionId: string; level: ThinkingLevel }
export interface ThinkingLevelSetResponse { level: string }

// ── Commands ──
export interface CommandInfo {
  id: string
  name: string
  description: string
  category: 'skill' | 'prompt' | 'extension' | 'builtin'
}
export interface CommandsListRequest { sessionId?: string }
export interface CommandsListResponse { commands: CommandInfo[] }

// ── Review ──
export interface ReviewGetDiffRequest {
  sessionId: string
  scope: 'turn' | 'session' | 'git'
  turnId?: string
}
export interface ReviewGetDiffResponse { diff: DiffResult }

export interface ReviewStageHunksRequest {
  cwd: string
  files: { path: string; hunkPatches: string[] }[]
}
export interface ReviewStageHunksResponse { ok: boolean; error?: string }

export interface ReviewCommitRequest {
  cwd: string
  message: string
}
export interface ReviewCommitResponse { ok: boolean; error?: string; commitHash?: string }

// ── Extensions ──
export interface ExtensionInfo {
  id: string
  name: string
  version?: string
  description?: string
  enabled: boolean
  compatibility: CompatibilityLevel
  source: 'global' | 'project' | 'package'
  registeredTools: string[]
  registeredCommands: string[]
  loadError?: string
  piSync?: boolean
  piEnabled?: boolean
  inSettingsPackages?: boolean
  workerLoadHint?: string
}
export interface ExtensionsListRequest {}
export interface ExtensionsListResponse { extensions: ExtensionInfo[] }
export interface ExtensionsSetEnabledRequest { extensionId: string; enabled: boolean }
export interface ExtensionsSetEnabledResponse { ok: boolean; extensionId: string; enabled: boolean; error?: string; needsWorkerReload?: boolean }

// ── Registry ──
export interface RegistryRefreshRequest { force?: boolean }
export interface RegistryRefreshResponse { refreshed: boolean; count: number; version?: string }

// ── Settings ──
export interface SettingsGetRequest { key?: string }
export interface SettingsGetResponse { settings: Record<string, unknown> }
export interface SettingsSetRequest { key: string; value: unknown }
export interface SettingsSetResponse { key: string; value: unknown }

// ── App update (GitHub Releases) ──
export interface AppCheckUpdateRequest {}
export interface AppCheckUpdateResponse {
  ok: boolean
  currentVersion: string
  latestVersion: string | null
  hasUpdate: boolean
  releaseUrl: string
  releaseNotes?: string
  downloadUrl?: string | null
  downloadName?: string | null
  checksumUrl?: string | null
  assets?: import('./app-update').AppUpdateAsset[]
  error?: string
}
export interface AppOpenReleaseRequest { url?: string }
export interface AppOpenReleaseResponse { ok: boolean }
export interface AppGetPendingUpdateRequest {}
export interface AppGetPendingUpdateResponse {
  update: import('./app-update').AppUpdateAvailableInfo | null
}
export interface AppDismissUpdatePromptRequest {}
export interface AppDismissUpdatePromptResponse { ok: boolean }
export interface AppIgnoreUpdateVersionRequest { version: string }
export interface AppIgnoreUpdateVersionResponse { ok: boolean }
export interface AppDownloadUpdateRequest {
  url: string
  fileName?: string
  checksumUrl: string
}
export interface AppDownloadUpdateResponse {
  ok: boolean
  path?: string
  error?: string
}

// ── Events ──
export interface EventsSubscribeRequest { channels?: string[] }
export interface EventsSubscribeResponse { subscriptionId: string }

// ── IPC Method Map ──
export interface IpcMethodMap {
  'agentAsset.list': {
    request: AgentAssetListRequest
    response: AgentAssetListResponse
  }
  'pi.inspector.get': {
    request: PiInspectorRequest
    response: PiInspectorResponse
  }
  'pi.resources.center.get': {
    request: PiResourceCenterRequest
    response: PiResourceCenterResponse
  }
  'pi.resources.package.mutate': {
    request: PiPackageMutationRequest
    response: PiPackageMutationResponse
  }
  'pi.resources.package.checkUpdates': {
    request: PiPackageUpdateCheckRequest
    response: PiPackageUpdateCheckResponse
  }
  'pi.resources.filter.set': {
    request: PiResourceFilterSetRequest
    response: PiResourceFilterSetResponse
  }
  'systemPromptPreset.list': {
    request: SystemPromptPresetListRequest
    response: SystemPromptPresetListResponse
  }
  'systemPromptPreset.create': {
    request: SystemPromptPresetCreateRequest
    response: SystemPromptPresetMutationResponse
  }
  'systemPromptPreset.update': {
    request: SystemPromptPresetUpdateRequest
    response: SystemPromptPresetMutationResponse
  }
  'systemPromptPreset.archive': {
    request: SystemPromptPresetArchiveRequest
    response: SystemPromptPresetMutationResponse
  }
  'conversationConfig.binding.get': {
    request: ConversationConfigBindingGetRequest
    response: ConversationConfigBindingGetResponse
  }
  'agentProfile.list': {
    request: AgentProfileListRequest
    response: AgentProfileListResponse
  }
  'agentProfile.preview': {
    request: AgentProfilePreviewRequest
    response: AgentProfilePreviewResponse
  }
  'agentProfile.create': {
    request: AgentProfileCreateRequest
    response: AgentProfileMutationResponse
  }
  'agentProfile.update': {
    request: AgentProfileUpdateRequest
    response: AgentProfileMutationResponse
  }
  'agentProfile.archive': {
    request: AgentProfileArchiveRequest
    response: AgentProfileMutationResponse
  }
  'agentVersion.list': {
    request: AgentVersionListRequest
    response: AgentVersionListResponse
  }
  'agentVersion.readiness': {
    request: AgentVersionReadinessRequest
    response: AgentVersionReadinessResponse
  }
  'agentVersion.validate': {
    request: AgentVersionValidateRequest
    response: AgentVersionValidateResponse
  }
  'pi.packageStudio.preview': {
    request: PiPackageStudioPreviewRequest
    response: PiPackageStudioPreviewResponse
  }
  'pi.packageStudio.export': {
    request: PiPackageStudioExportRequest
    response: PiPackageStudioExportResponse
  }
  'pi.packageStudio.import.preview': {
    request: PiPackageImportPreviewRequest
    response: PiPackageImportPreviewResponse
  }
  'pi.packageStudio.import.apply': {
    request: PiPackageImportApplyRequest
    response: PiPackageImportApplyResponse
  }
  'agentProfile.binding.get': {
    request: SessionAgentBindingGetRequest
    response: SessionAgentBindingGetResponse
  }
  'agentRun.list': {
    request: AgentRunHistoryListRequest
    response: AgentRunHistoryListResponse
  }
  'agentCase.list': {
    request: AgentCaseListRequest
    response: AgentCaseListResponse
  }
  'agentCase.create': {
    request: AgentCaseCreateRequest
    response: AgentCaseMutationResponse
  }
  'agentCase.update': {
    request: AgentCaseUpdateRequest
    response: AgentCaseMutationResponse
  }
  'agentCase.archive': {
    request: AgentCaseArchiveRequest
    response: AgentCaseMutationResponse
  }
  'agentCase.verify': {
    request: AgentCaseVerifyRequest
    response: AgentCaseVerifyResponse
  }
  'agentEvaluation.list': {
    request: AgentEvaluationListRequest
    response: AgentEvaluationListResponse
  }
  'agentEvaluation.report.export': {
    request: AgentEvaluationReportExportRequest
    response: AgentEvaluationReportExportResponse
  }
  'agentEvaluation.suite.create': {
    request: AgentEvaluationSuiteCreateRequest
    response: AgentEvaluationSuiteCreateResponse
  }
  'agentEvaluation.suite.cloneVersion': {
    request: AgentEvaluationSuiteCloneVersionRequest
    response: AgentEvaluationSuiteCloneVersionResponse
  }
  'agentEvaluation.scenario.create': {
    request: AgentEvaluationScenarioCreateRequest
    response: AgentEvaluationScenarioCreateResponse
  }
  'agentEvaluation.attachCase': {
    request: AgentEvaluationAttachCaseRequest
    response: AgentEvaluationAttachCaseResponse
  }
  'agentEvaluation.batch.start': {
    request: AgentEvaluationBatchStartRequest
    response: AgentEvaluationBatchResponse
  }
  'agentEvaluation.batch.get': {
    request: AgentEvaluationBatchGetRequest
    response: AgentEvaluationBatchResponse
  }
  'agentEvaluation.batch.latest': {
    request: AgentEvaluationBatchLatestRequest
    response: AgentEvaluationBatchLatestResponse
  }
  'agentEvaluation.batch.cancel': {
    request: AgentEvaluationBatchCancelRequest
    response: AgentEvaluationBatchResponse
  }
  'agentEvaluation.compare': {
    request: AgentEvaluationCompareRequest
    response: AgentEvaluationCompareResponse
  }
  'agentEvaluation.assess': {
    request: AgentEvaluationAssessRequest
    response: AgentEvaluationAssessResponse
  }
  'agentEvaluation.archive': {
    request: AgentEvaluationArchiveRequest
    response: AgentEvaluationArchiveResponse
  }
  'workspace.open': { request: WorkspaceOpenRequest; response: WorkspaceOpenResponse }
  'workspace.ensureWorker': { request: WorkspaceEnsureWorkerRequest; response: WorkspaceEnsureWorkerResponse }
  'workspace.switch': { request: WorkspaceSwitchRequest; response: WorkspaceSwitchResponse }
  'worktree.capability': {
    request: WorktreeRootRequest
    response: WorktreeCapabilityResponse
  }
  'worktree.list': { request: WorktreeRootRequest; response: WorktreeListResponse }
  'worktree.create': { request: WorktreeCreateRequest; response: WorktreeCreateResponse }
  'worktree.inspectRemoval': {
    request: WorktreeInspectRemovalRequest
    response: WorktreeInspectRemovalResponse
  }
  'worktree.remove': { request: WorktreeRemoveRequest; response: WorktreeRemoveResponse }
  'worktree.reconcile': {
    request: WorktreeRootRequest
    response: WorktreeReconcileResponse
  }
  'orchestration.list': {
    request: OrchestrationListRequest
    response: OrchestrationListResponse
  }
  'orchestration.create': {
    request: OrchestrationCreateRequest
    response: OrchestrationCreateResponse
  }
  'orchestration.read': {
    request: OrchestrationReadRequest
    response: OrchestrationReadResponse
  }
  'orchestration.send': {
    request: OrchestrationSendRequest
    response: OrchestrationMutationResponse
  }
  'orchestration.stop': {
    request: OrchestrationReadRequest
    response: OrchestrationMutationResponse
  }
  'orchestration.resume': {
    request: OrchestrationResumeRequest
    response: OrchestrationMutationResponse
  }
  'reliability.snapshot': {
    request: ReliabilityRootRequest
    response: ReliabilitySnapshotResponse
  }
  'reliability.reconcile': {
    request: ReliabilityRootRequest
    response: ReliabilityReconcileResponse
  }
  'audit.query': { request: AuditQuery; response: AuditQueryResponse }
  'audit.export': { request: AuditExportRequest; response: FileExportResult }
  'diagnostics.preview': {
    request: ReliabilityRootRequest
    response: DiagnosticsPreviewResponse
  }
  'diagnostics.export': {
    request: ReliabilityRootRequest
    response: FileExportResult
  }
  'metadataBackup.list': {
    request: Record<string, never>
    response: MetadataBackupListResponse
  }
  'metadataBackup.create': {
    request: Record<string, never>
    response: MetadataBackupCreateResponse
  }
  'metadataBackup.restore': {
    request: MetadataRestoreRequest
    response: MetadataBackupRestoreResponse
  }
  'providerRouting.get': {
    request: Record<string, never>
    response: ProviderRoutingGetResponse
  }
  'providerRouting.set': {
    request: ProviderRouteSetRequest
    response: ProviderRoutingMutationResponse
  }
  'providerRouting.diagnose': {
    request: ProviderRoutingDiagnoseRequest
    response: ProviderRoutingDiagnoseResponse
  }
  'proxyProfile.save': {
    request: ProxyProfileSaveRequest
    response: ProviderRoutingMutationResponse
  }
  'proxyProfile.delete': {
    request: ProxyProfileDeleteRequest
    response: ProviderRoutingMutationResponse
  }
  'session.list': { request: SessionListRequest; response: SessionListResponse }
  'session.lease.inspect': {
    request: SessionLeaseInspectRequest
    response: SessionLeaseInspectResponse
  }
  'session.lease.takeover': {
    request: SessionLeaseTakeoverRequest
    response: SessionLeaseTakeoverResponse
  }
  'session.open': { request: SessionOpenRequest; response: SessionOpenResponse }
  'session.new': { request: SessionNewRequest; response: SessionNewResponse }
  'session.fork': { request: SessionForkRequest; response: SessionForkResponse }
  'session.forkCandidates': { request: SessionForkCandidatesRequest; response: SessionForkCandidatesResponse }
  'session.clone': { request: SessionCloneRequest; response: SessionCloneResponse }
  'session.rename': { request: SessionRenameRequest; response: SessionRenameResponse }
  'session.compact': { request: SessionCompactRequest; response: SessionCompactResponse }
  'session.export': { request: SessionExportRequest; response: SessionExportResponse }
  'prompt.send': { request: PromptSendRequest; response: PromptSendResponse }
  'prompt.steer': { request: PromptSteerRequest; response: PromptSteerResponse }
  'prompt.followUp': { request: PromptFollowUpRequest; response: PromptFollowUpResponse }
  'prompt.abort': { request: PromptAbortRequest; response: PromptAbortResponse }
  'model.list': { request: ModelListRequest; response: ModelListResponse }
  'model.set': { request: ModelSetRequest; response: ModelSetResponse }
  'model.cycle': { request: ModelCycleRequest; response: ModelCycleResponse }
  'pi.models.get': { request: PiModelsGetRequest; response: PiModelsGetResponse }
  'pi.models.set': { request: PiModelsSetRequest; response: PiModelsSetResponse }
  'pi.models.fetch': { request: PiModelsFetchRequest; response: PiModelsFetchResponse }
  'pi.configImport.inspect': {
    request: PiConfigImportInspectRequest
    response: PiConfigImportInspectResponse
  }
  'pi.configImport.run': {
    request: PiConfigImportRunRequest
    response: PiConfigImportRunResponse
  }
  'thinkingLevel.set': { request: ThinkingLevelSetRequest; response: ThinkingLevelSetResponse }
  'commands.list': { request: CommandsListRequest; response: CommandsListResponse }
  'review.getDiff': { request: ReviewGetDiffRequest; response: ReviewGetDiffResponse }
  'review.stageHunks': { request: ReviewStageHunksRequest; response: ReviewStageHunksResponse }
  'review.unstageHunks': { request: ReviewStageHunksRequest; response: ReviewStageHunksResponse }
  'review.commit': { request: ReviewCommitRequest; response: ReviewCommitResponse }
  'extensions.list': { request: ExtensionsListRequest; response: ExtensionsListResponse }
  'extensions.setEnabled': { request: ExtensionsSetEnabledRequest; response: ExtensionsSetEnabledResponse }
  'registry.refresh': { request: RegistryRefreshRequest; response: RegistryRefreshResponse }
  'settings.get': { request: SettingsGetRequest; response: SettingsGetResponse }
  'settings.set': { request: SettingsSetRequest; response: SettingsSetResponse }
  'app.checkUpdate': { request: AppCheckUpdateRequest; response: AppCheckUpdateResponse }
  'app.getPendingUpdate': {
    request: AppGetPendingUpdateRequest
    response: AppGetPendingUpdateResponse
  }
  'app.dismissUpdatePrompt': {
    request: AppDismissUpdatePromptRequest
    response: AppDismissUpdatePromptResponse
  }
  'app.openRelease': { request: AppOpenReleaseRequest; response: AppOpenReleaseResponse }
  'app.ignoreUpdateVersion': {
    request: AppIgnoreUpdateVersionRequest
    response: AppIgnoreUpdateVersionResponse
  }
  'app.downloadUpdate': {
    request: AppDownloadUpdateRequest
    response: AppDownloadUpdateResponse
  }
  'events.subscribe': { request: EventsSubscribeRequest; response: EventsSubscribeResponse; stream: AppEvent }
}

// ── Type helpers ──
export type IpcMethodName = keyof IpcMethodMap
export type IpcRequest<M extends IpcMethodName> = IpcMethodMap[M]['request']
export type IpcResponse<M extends IpcMethodName> = IpcMethodMap[M]['response']

export function ipcChannel<M extends IpcMethodName>(method: M): string {
  return `ipc:${method}`
}

export interface IpcInvoker {
  invoke<M extends IpcMethodName>(method: M, request: IpcRequest<M>): Promise<IpcResponse<M>>
}

export interface IpcHandler<M extends IpcMethodName> {
  (request: IpcRequest<M>): Promise<IpcResponse<M>>
}

export const EVENTS_CHANNEL = 'ipc:events'
