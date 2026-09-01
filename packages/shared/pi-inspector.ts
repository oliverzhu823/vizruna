export type PiInspectorScope = 'global' | 'project' | 'package' | 'runtime' | 'unknown'

export interface PiInspectorRequest {
  workspaceId?: string
  sessionId?: string
  sessionFile?: string
}

export interface PiInspectorNamedResource {
  id: string
  name: string
  description?: string
  source: PiInspectorScope
  path?: string
  version?: string
  enabled: boolean
  loaded: boolean
  tools?: string[]
  commands?: string[]
  error?: string
}

export interface PiInspectorContextSource {
  kind: 'agents' | 'system' | 'append' | 'agent-profile' | 'prompt-preset'
  label: string
  path?: string
  mode?: 'append' | 'replace'
  charCount?: number
}

export type PiPromptOwner =
  | 'pi-runtime'
  | 'runtime-tools'
  | 'user-prompt'
  | 'project-context'
  | 'agent-config'
  | 'skill-router'
  | 'skill-catalog'
  | 'workspace'

export interface PiPromptManifestSection {
  id: string
  label: string
  owner: PiPromptOwner
  order: number
  enabled: boolean
  activation: string
  charCount: number
  estimatedTokens: number
  /** Content digest for the section as compiled into this exact request. */
  digest?: string
  /** How often the section is allowed to change. */
  stability?: 'stable' | 'session' | 'turn'
  /** Human-readable authoritative source, never prompt text. */
  source?: string
  details?: string[]
}

export interface PiPromptContractSnapshot {
  version: 2
  capturedAt: number
  promptDigest: string
  toolsDigest: string
  requestDigest: string
  activeTools: string[]
  sections: PiPromptManifestSection[]
}

export interface PiPromptDocumentRequest extends PiInspectorRequest {}

export interface PiPromptDocumentResponse {
  text: string
  charCount: number
  estimatedTokens: number
  sections: PiPromptManifestSection[]
  contract?: PiPromptContractSnapshot
}

export interface PiInspectorWarning {
  code:
    | 'runtime-offline'
    | 'session-not-loaded'
    | 'model-unselected'
    | 'auth-missing'
    | 'project-untrusted'
    | 'extension-load-error'
    | 'package-not-loaded'
  message: string
  resourceId?: string
}

export interface PiInspectorSnapshot {
  generatedAt: number
  workspacePath: string
  session: {
    id?: string
    file?: string
    name?: string
    loaded: boolean
    running: boolean
    messageCount: number
  }
  runtime: {
    sdkVersion: string
    model?: string
    provider?: string
    thinkingLevel?: string
    projectTrusted: boolean
    auth?: {
      configured: boolean
      type?: 'api_key' | 'oauth' | 'subscription'
    }
    route?: {
      mode: 'direct' | 'system' | 'profile'
      label: string
    }
  }
  configuration: {
    kind: 'general' | 'agent' | 'prompt'
    name: string
    description?: string
    mode?: 'append' | 'replace'
    capturedAt?: number
    toolsMode: 'runtime' | 'inherited' | 'custom'
    extensionToolsMode: 'runtime' | 'all-selected' | 'custom'
    extensionToolCount?: number
    resourceMode: 'runtime' | 'inherit' | 'selected'
    projectContextMode: 'runtime' | 'inherit' | 'none'
    resolvedResourceCount?: number
    providerRequirements?: {
      reasoning: boolean
      imageInput: boolean
      minContextWindow?: number
    }
  }
  context: {
    sources: PiInspectorContextSource[]
    systemPromptChars: number
    estimatedTokens: number
    sections: PiPromptManifestSection[]
    promptContract?: PiPromptContractSnapshot
    skillDiscovery?: {
      mode: 'on-demand' | 'fixed'
      indexedCount: number
      promptSkillCount: number
      searchableCount: number
      catalogDigest?: string
      searchCount?: number
      loadCount?: number
      loadedSkills?: string[]
      conflicts?: string[]
    }
  }
  resources: {
    tools: PiInspectorNamedResource[]
    skills: PiInspectorNamedResource[]
    extensions: PiInspectorNamedResource[]
    prompts: PiInspectorNamedResource[]
    packages: PiInspectorNamedResource[]
  }
  warnings: PiInspectorWarning[]
}

export interface PiInspectorResponse {
  snapshot: PiInspectorSnapshot
}
