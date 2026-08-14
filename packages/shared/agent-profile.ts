export type AgentPromptMode = 'append' | 'replace'
export type AgentProfileStatus = 'active' | 'archived'
export type AgentPiResourceMode = 'inherit' | 'selected'
export type AgentProjectContextMode = 'inherit' | 'none'
export type AgentPiResourceKind = 'extensions' | 'skills' | 'prompts'

/** User-authored resource selectors kept on the reusable Agent profile. */
export interface AgentPiResourceSelection {
  mode: AgentPiResourceMode
  packageIds: string[]
  resourceIds: string[]
  projectContext: AgentProjectContextMode
}

/** One Pi-native resource that was actually resolvable when a session started. */
export interface AgentResolvedPiResource {
  id: string
  kind: AgentPiResourceKind
  name: string
  path: string
  source: string
  scope: 'user' | 'project' | 'temporary'
  origin: 'package' | 'top-level'
  packageId?: string
}

/**
 * Immutable result of resolving profile selectors against Pi's PackageManager.
 * The Worker consumes this snapshot instead of reinterpreting an edited profile.
 */
export interface AgentPiResourceSnapshot {
  workspacePath: string
  sdkVersion: string
  mode: AgentPiResourceMode
  projectContext: AgentProjectContextMode
  selectedPackageIds: string[]
  selectedResourceIds: string[]
  resources: AgentResolvedPiResource[]
  missingPackageIds: string[]
  missingResourceIds: string[]
  disabledResourceIds: string[]
  capturedAt: number
}

export type AgentEffectiveConfigWarningCode =
  | 'project-untrusted'
  | 'empty-selection'
  | 'package-missing'
  | 'resource-missing'
  | 'resource-disabled'

export interface AgentEffectiveConfigWarning {
  code: AgentEffectiveConfigWarningCode
  ids?: string[]
}

export interface AgentProviderRequirements {
  reasoning: boolean
  imageInput: boolean
  minContextWindow?: number
}

export interface AgentImportProvenance {
  packageName: string
  packageVersion: string
  sourceProfileId: string
  sourceVersionId: string
  sourceVersionNumber: number
  sourceVersionDigest: string
  sourceVersionStatus: 'candidate' | 'validated' | 'released'
  importedAt: number
}

/**
 * A reusable, user-managed Agent configuration.
 *
 * `undefined` model/thinking/tools means "inherit the current conversation
 * defaults". An empty tools array deliberately creates a tool-less Agent.
 */
export interface AgentProfile {
  id: string
  name: string
  description?: string
  systemPrompt: string
  promptMode: AgentPromptMode
  modelId?: string
  thinkingLevel?: string
  tools?: string[]
  /** undefined = all tools from selected Extensions; array = explicit allowlist. */
  extensionTools?: string[]
  resourceSelection?: AgentPiResourceSelection
  providerRequirements?: AgentProviderRequirements
  importProvenance?: AgentImportProvenance
  status: AgentProfileStatus
  createdAt: number
  updatedAt: number
}

/**
 * Immutable runtime copy captured when a conversation is created.
 * Later profile edits must not alter an existing conversation.
 */
export interface AgentProfileSnapshot {
  profileId: string
  versionId?: string
  versionNumber?: number
  versionDigest?: string
  name: string
  description?: string
  systemPrompt: string
  promptMode: AgentPromptMode
  modelId?: string
  thinkingLevel?: string
  tools?: string[]
  extensionTools?: string[]
  resourceSnapshot?: AgentPiResourceSnapshot
  providerRequirements?: AgentProviderRequirements
  capturedAt: number
}

export interface SessionAgentBinding {
  sessionId: string
  sessionFile: string
  profileId: string
  snapshot: AgentProfileSnapshot
  createdAt: number
}

export interface AgentProfileListRequest {
  includeArchived?: boolean
}

export interface AgentProfileListResponse {
  profiles: AgentProfile[]
}

export interface AgentProfileCreateRequest {
  name: string
  description?: string
  systemPrompt: string
  promptMode: AgentPromptMode
  modelId?: string
  thinkingLevel?: string
  tools?: string[]
  extensionTools?: string[]
  resourceSelection?: AgentPiResourceSelection
  providerRequirements?: AgentProviderRequirements
}

export interface AgentProfileUpdateRequest {
  id: string
  name?: string
  description?: string
  systemPrompt?: string
  promptMode?: AgentPromptMode
  modelId?: string | null
  thinkingLevel?: string | null
  tools?: string[] | null
  extensionTools?: string[] | null
  resourceSelection?: AgentPiResourceSelection | null
  providerRequirements?: AgentProviderRequirements | null
}

export interface AgentProfilePreviewRequest {
  workspaceId?: string
  resourceSelection?: AgentPiResourceSelection
}

export interface AgentProfilePreviewResponse {
  resourceSnapshot: AgentPiResourceSnapshot
  warnings: AgentEffectiveConfigWarning[]
  catalog: import('./pi-resource-center').PiResourceCenterSnapshot
}

export interface AgentProfileArchiveRequest {
  id: string
}

export interface AgentProfileMutationResponse {
  profile: AgentProfile
}

export interface SessionAgentBindingGetRequest {
  sessionId?: string
  sessionFile?: string
}

export interface SessionAgentBindingGetResponse {
  binding: SessionAgentBinding | null
}
