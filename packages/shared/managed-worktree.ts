import { z } from 'zod'

export const managedWorktreeStatusSchema = z.enum([
  'creating',
  'ready',
  'dirty',
  'missing',
  'error',
  'removing',
  'removed',
])

export type ManagedWorktreeStatus = z.infer<typeof managedWorktreeStatusSchema>

export interface ManagedWorktree {
  id: string
  rootWorkspacePath: string
  worktreePath: string
  branchName: string
  baseRef: string
  baseCommit: string
  status: ManagedWorktreeStatus
  createdBySession?: string
  createdAt: number
  updatedAt: number
  lastError?: string
}

export interface WorktreeSafety {
  exists: boolean
  registeredWithGit: boolean
  dirty: boolean
  changedFiles: string[]
  aheadOfBase: number
  unmergedCommits: boolean
  upstream?: string
  unpushedCommits: number
  safeToRemove: boolean
  forceRemovalAllowed: boolean
  blockers: Array<
    'missing' | 'not-registered' | 'dirty' | 'unmerged' | 'unpushed' | 'active-workspace'
  >
}

export interface WorktreeCapability {
  isGitRepository: boolean
  repositoryRoot?: string
  currentBranch?: string
  headCommit?: string
  reason?:
    | 'not-git-repository'
    | 'bare-repository'
    | 'unborn-head'
    | 'git-unavailable'
    | 'unknown'
  message?: string
}

export interface WorktreeCreateRequest {
  rootWorkspacePath?: string
  name?: string
  branchName?: string
  baseRef?: string
  createdBySession?: string
}

export interface WorktreeRemoveRequest {
  id: string
  force?: boolean
  confirmed?: boolean
  deleteBranch?: boolean
}

export interface WorktreeReconcileResult {
  worktrees: ManagedWorktree[]
  unregistered: Array<{
    rootWorkspacePath: string
    worktreePath: string
    branchName?: string
  }>
}
