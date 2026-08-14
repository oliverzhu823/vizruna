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
    systemPromptPreview?: string
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
