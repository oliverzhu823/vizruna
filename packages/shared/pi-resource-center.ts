export type PiResourceCenterKind = 'extensions' | 'skills' | 'prompts' | 'themes'
export type PiResourceCenterScope = 'user' | 'project' | 'temporary'

export interface PiResourceCenterRequest {
  workspaceId?: string
}

export interface PiResourceCenterItem {
  id: string
  kind: PiResourceCenterKind
  name: string
  path: string
  source: string
  scope: PiResourceCenterScope
  origin: 'package' | 'top-level'
  enabled: boolean
  packageId?: string
  /** Pi filter path relative to the package/resource base directory. */
  relativePath?: string
  /** True when Vizruna can persist an exact +path/-path Pi filter for this row. */
  configurable: boolean
  /** Statically discovered Pi registrations for Extension resources. */
  tools?: string[]
  commands?: string[]
}

export interface PiResourceCenterPackage {
  id: string
  source: string
  name: string
  description?: string
  version?: string
  scope: 'user' | 'project'
  type: 'npm' | 'git' | 'local'
  pinned: boolean
  filtered: boolean
  installed: boolean
  installedPath?: string
  resources: Record<PiResourceCenterKind, number>
}

export interface PiResourceCenterWarning {
  code: 'project-untrusted' | 'package-missing' | 'package-read-error' | 'resolve-error'
  message: string
  packageId?: string
}

export interface PiResourceCenterSnapshot {
  generatedAt: number
  workspacePath: string
  runtime: {
    sdkVersion: string
    workerLoaded: boolean
    projectTrusted: boolean
  }
  summary: {
    packages: number
    installedPackages: number
    extensions: number
    skills: number
    prompts: number
    themes: number
    enabledResources: number
    projectResources: number
  }
  packages: PiResourceCenterPackage[]
  resources: Record<PiResourceCenterKind, PiResourceCenterItem[]>
  warnings: PiResourceCenterWarning[]
}

export interface PiResourceCenterResponse {
  snapshot: PiResourceCenterSnapshot
}

export type PiPackageMutationAction = 'install' | 'update' | 'remove'

export type PiPackageMutationRequest =
  | {
      workspaceId?: string
      action: 'install'
      source: string
      scope: 'user' | 'project'
      confirmed: true
    }
  | {
      workspaceId?: string
      action: 'update' | 'remove'
      packageId: string
      confirmed: true
    }

export interface PiPackageMutationProgress {
  operationId: string
  action: PiPackageMutationAction
  phase: 'queued' | 'started' | 'progress' | 'completed' | 'failed'
  source: string
  message?: string
}

export interface PiPackageMutationResponse {
  ok: true
  operationId: string
  workerReload: 'reloaded' | 'deferred' | 'not-running'
  snapshot: PiResourceCenterSnapshot
}

export interface PiPackageUpdateCheckRequest {
  workspaceId?: string
}

export interface PiPackageUpdateCheckResponse {
  checkedAt: number
  packageIds: string[]
}

export interface PiResourceFilterSetRequest {
  workspaceId?: string
  resourceId: string
  enabled: boolean
}

export interface PiResourceFilterSetResponse {
  ok: true
  workerReload: 'reloaded' | 'deferred' | 'not-running'
  snapshot: PiResourceCenterSnapshot
}
