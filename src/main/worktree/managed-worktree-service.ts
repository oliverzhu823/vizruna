import { createHash, randomUUID } from 'node:crypto'
import {
  access,
  mkdir,
  realpath,
  rm,
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { AuditEventInput } from '@shared/audit-events'
import type {
  ManagedWorktree,
  WorktreeCapability,
  WorktreeCreateRequest,
  WorktreeReconcileResult,
  WorktreeRemoveRequest,
  WorktreeSafety,
} from '@shared/managed-worktree'
import type { ManagedWorktreeRepository } from './managed-worktree-repository'
import {
  ExecFileGitCommandRunner,
  parseGitWorktreePorcelain,
  type GitCommandRunner,
  type GitWorktreeListEntry,
} from './git-worktree-runner'

export class ManagedWorktreeError extends Error {
  constructor(
    readonly code:
      | 'NOT_GIT_REPOSITORY'
      | 'UNBORN_HEAD'
      | 'INVALID_BASE_REF'
      | 'INVALID_BRANCH_NAME'
      | 'BRANCH_ALREADY_EXISTS'
      | 'WORKTREE_NOT_FOUND'
      | 'WORKTREE_UNSAFE'
      | 'CONFIRMATION_REQUIRED'
      | 'PATH_OUTSIDE_MANAGED_ROOT'
      | 'GIT_COMMAND_FAILED',
    message: string,
    readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'ManagedWorktreeError'
  }
}

export interface ManagedWorktreeServiceOptions {
  managedRoot: string
  repository: ManagedWorktreeRepository
  runner?: GitCommandRunner
  audit?: (event: AuditEventInput) => void | Promise<void>
  now?: () => number
  idFactory?: () => string
}

function normalizePath(path: string): string {
  let normalized = resolve(path)
  if (/^[a-zA-Z]:[\\/]/.test(normalized)) {
    normalized = normalized.charAt(0).toUpperCase() + normalized.slice(1)
  }
  return normalized
}

function pathInside(root: string, target: string): boolean {
  const rel = relative(normalizePath(root), normalizePath(target))
  return (
    !!rel &&
    rel !== '..' &&
    !rel.startsWith('../') &&
    !rel.startsWith('..\\') &&
    !isAbsolute(rel)
  )
}

async function canonicalPath(path: string): Promise<string> {
  try {
    return normalizePath(await realpath(path))
  } catch {
    const parent = dirname(path)
    try {
      return normalizePath(join(await realpath(parent), basename(path)))
    } catch {
      return normalizePath(path)
    }
  }
}

function safeSlug(value: string, fallback: string): string {
  const slug = value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 48)
  return slug || fallback
}

function safeBaseRef(value: string | undefined): string {
  const ref = String(value || 'HEAD').trim()
  if (
    !ref ||
    ref.startsWith('-') ||
    ref.includes('..') ||
    ref.includes('@{') ||
    ref.includes('\\') ||
    !/^[A-Za-z0-9_./-]+$/.test(ref)
  ) {
    throw new ManagedWorktreeError('INVALID_BASE_REF', 'Invalid Git base ref')
  }
  return ref
}

function conciseGitError(stderr: string, fallback: string): string {
  return (
    stderr
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) || fallback
  ).slice(0, 1_000)
}

export class ManagedWorktreeService {
  readonly managedRoot: string
  private readonly repository: ManagedWorktreeRepository
  private readonly runner: GitCommandRunner
  private readonly auditWriter?: ManagedWorktreeServiceOptions['audit']
  private readonly now: () => number
  private readonly idFactory: () => string
  private readonly rootQueues = new Map<string, Promise<unknown>>()

  constructor(options: ManagedWorktreeServiceOptions) {
    this.managedRoot = normalizePath(options.managedRoot)
    this.repository = options.repository
    this.runner = options.runner ?? new ExecFileGitCommandRunner()
    this.auditWriter = options.audit
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
  }

  private audit(event: AuditEventInput): void {
    void Promise.resolve(this.auditWriter?.(event)).catch((error) => {
      console.warn('[managed-worktree] audit write failed:', error)
    })
  }

  private async serializeForRoot<T>(root: string, operation: () => Promise<T>): Promise<T> {
    const key = normalizePath(root)
    const previous = this.rootQueues.get(key) ?? Promise.resolve()
    const run = previous.catch(() => {}).then(operation)
    this.rootQueues.set(key, run)
    try {
      return await run
    } finally {
      if (this.rootQueues.get(key) === run) this.rootQueues.delete(key)
    }
  }

  async capability(path: string): Promise<WorktreeCapability> {
    const cwd = normalizePath(path)
    const bareResult = await this.runner.run(cwd, ['rev-parse', '--is-bare-repository'])
    if (bareResult.ok && bareResult.stdout.trim() === 'true') {
      return {
        isGitRepository: false,
        repositoryRoot: cwd,
        reason: 'bare-repository',
        message: 'Bare Git repositories cannot be used as agent workspaces',
      }
    }
    const rootResult = await this.runner.run(cwd, ['rev-parse', '--show-toplevel'])
    if (!rootResult.ok) {
      const unavailable = /not found|enoent/i.test(rootResult.stderr)
      return {
        isGitRepository: false,
        reason: unavailable ? 'git-unavailable' : 'not-git-repository',
        message: conciseGitError(rootResult.stderr, 'Not a Git repository'),
      }
    }
    const workingTreeRoot = normalizePath(rootResult.stdout.trim())
    const head = await this.runner.run(workingTreeRoot, ['rev-parse', '--verify', 'HEAD^{commit}'])
    if (!head.ok) {
      return {
        isGitRepository: true,
        repositoryRoot: workingTreeRoot,
        reason: 'unborn-head',
        message: 'The repository has no initial commit',
      }
    }
    const entriesResult = await this.runner.run(workingTreeRoot, ['worktree', 'list', '--porcelain'])
    const primaryRoot = entriesResult.ok
      ? parseGitWorktreePorcelain(entriesResult.stdout)[0]?.path
      : undefined
    const repositoryRoot = normalizePath(primaryRoot || workingTreeRoot)
    const branch = await this.runner.run(workingTreeRoot, ['branch', '--show-current'])
    return {
      isGitRepository: true,
      repositoryRoot,
      currentBranch: branch.ok ? branch.stdout.trim() : '',
      headCommit: head.stdout.trim(),
    }
  }

  async list(rootWorkspacePath?: string): Promise<ManagedWorktree[]> {
    return this.repository.list({
      rootWorkspacePath: rootWorkspacePath
        ? normalizePath(rootWorkspacePath)
        : undefined,
    })
  }

  async get(id: string): Promise<ManagedWorktree | null> {
    return this.repository.get(id)
  }

  private async saveVerified(worktree: ManagedWorktree): Promise<void> {
    await this.repository.save(worktree)
    const stored = await this.repository.get(worktree.id)
    if (
      !stored ||
      stored.status !== worktree.status ||
      normalizePath(stored.worktreePath) !== normalizePath(worktree.worktreePath)
    ) {
      throw new Error('Managed worktree metadata could not be persisted')
    }
  }

  async create(request: WorktreeCreateRequest): Promise<ManagedWorktree> {
    const rawRoot = String(request.rootWorkspacePath || '').trim()
    if (!rawRoot) {
      throw new ManagedWorktreeError('NOT_GIT_REPOSITORY', 'Workspace path is required')
    }
    const requestedRoot = normalizePath(rawRoot)
    const capability = await this.capability(requestedRoot)
    if (!capability.isGitRepository || !capability.repositoryRoot) {
      throw new ManagedWorktreeError(
        'NOT_GIT_REPOSITORY',
        capability.message || 'Not a Git repository',
      )
    }
    if (!capability.headCommit) {
      throw new ManagedWorktreeError('UNBORN_HEAD', 'Repository has no initial commit')
    }
    const root = capability.repositoryRoot
    const resolvedRequest = {
      ...request,
      baseRef: request.baseRef || capability.currentBranch || capability.headCommit,
    }
    return this.serializeForRoot(root, () => this.createUnlocked(root, resolvedRequest))
  }

  private async createUnlocked(
    root: string,
    request: WorktreeCreateRequest,
  ): Promise<ManagedWorktree> {
    await mkdir(this.managedRoot, { recursive: true, mode: 0o700 })
    const id = this.idFactory()
    const shortId = id.replace(/-/g, '').slice(0, 8)
    const taskSlug = safeSlug(String(request.name || ''), 'task')
    const repoSlug = safeSlug(basename(root), 'repository')
    const repoHash = createHash('sha256').update(normalizePath(root)).digest('hex').slice(0, 8)
    const repositoryDirectory = join(this.managedRoot, `${repoSlug}-${repoHash}`)
    const target = normalizePath(join(repositoryDirectory, `${taskSlug}-${shortId}`))
    const branchName =
      String(request.branchName || '').trim() || `pi-agent/${taskSlug}-${shortId}`
    const baseRef = safeBaseRef(request.baseRef)
    if (!pathInside(this.managedRoot, target)) {
      throw new ManagedWorktreeError(
        'PATH_OUTSIDE_MANAGED_ROOT',
        'Generated worktree path escaped the managed root',
      )
    }

    const branchFormat = await this.runner.run(root, [
      'check-ref-format',
      '--branch',
      branchName,
    ])
    if (!branchFormat.ok) {
      throw new ManagedWorktreeError(
        'INVALID_BRANCH_NAME',
        conciseGitError(branchFormat.stderr, 'Invalid Git branch name'),
      )
    }
    const existingBranch = await this.runner.run(root, [
      'show-ref',
      '--verify',
      '--quiet',
      `refs/heads/${branchName}`,
    ])
    if (existingBranch.ok) {
      throw new ManagedWorktreeError(
        'BRANCH_ALREADY_EXISTS',
        `Git branch already exists: ${branchName}`,
      )
    }
    if (existingBranch.exitCode !== 1) {
      throw new ManagedWorktreeError(
        'GIT_COMMAND_FAILED',
        conciseGitError(existingBranch.stderr, 'Could not inspect the requested Git branch'),
      )
    }

    const base = await this.runner.run(root, ['rev-parse', '--verify', `${baseRef}^{commit}`])
    if (!base.ok) {
      throw new ManagedWorktreeError(
        'INVALID_BASE_REF',
        conciseGitError(base.stderr, `Unknown base ref: ${baseRef}`),
      )
    }
    const baseCommit = base.stdout.trim()
    const now = this.now()
    let record: ManagedWorktree = {
      id,
      rootWorkspacePath: normalizePath(root),
      worktreePath: target,
      branchName,
      baseRef,
      baseCommit,
      status: 'creating',
      createdBySession: request.createdBySession?.trim() || undefined,
      createdAt: now,
      updatedAt: now,
    }
    let branchCreated = false
    try {
      await this.saveVerified(record)
      await mkdir(repositoryDirectory, { recursive: true, mode: 0o700 })
      const alreadyExists = await access(target).then(() => true).catch(() => false)
      if (alreadyExists) throw new Error('Generated worktree path already exists')

      const createBranch = await this.runner.run(
        root,
        ['branch', '--no-track', branchName, baseCommit],
        { timeoutMs: 30_000 },
      )
      if (!createBranch.ok) {
        throw new Error(conciseGitError(createBranch.stderr, 'git branch creation failed'))
      }
      branchCreated = true
      const result = await this.runner.run(
        root,
        ['worktree', 'add', '--', target, branchName],
        { timeoutMs: 120_000 },
      )
      if (!result.ok) {
        throw new Error(conciseGitError(result.stderr, 'git worktree add failed'))
      }
      const entry = await this.findEntryByPath(await this.gitWorktreeEntries(root), target)
      if (!entry || entry.branchName !== branchName) {
        throw new Error('Created worktree could not be verified')
      }
      record = {
        ...record,
        status: 'ready',
        updatedAt: this.now(),
        lastError: undefined,
      }
      await this.saveVerified(record)
      this.audit({
        category: 'operation',
        action: 'worktree.create',
        outcome: 'success',
        actor: request.createdBySession,
        workspaceId: root,
        details: { worktreeId: id, worktreePath: target, branchName, baseCommit },
      })
      return record
    } catch (error) {
      const rollbackErrors = await this.rollbackCreate(
        root,
        target,
        branchName,
        branchCreated,
      )
      record = {
        ...record,
        status: 'error',
        updatedAt: this.now(),
        lastError: [
          error instanceof Error ? error.message : String(error),
          ...rollbackErrors,
        ].join('; ').slice(0, 2_000),
      }
      try {
        await this.saveVerified(record)
      } catch (persistenceError) {
        rollbackErrors.push(
          `error state persistence failed: ${
            persistenceError instanceof Error ? persistenceError.message : String(persistenceError)
          }`,
        )
        record.lastError = [
          record.lastError,
          rollbackErrors[rollbackErrors.length - 1],
        ].filter(Boolean).join('; ').slice(0, 2_000)
      }
      this.audit({
        category: 'operation',
        action: 'worktree.create',
        outcome: 'failed',
        actor: request.createdBySession,
        workspaceId: root,
        details: { worktreeId: id, branchName, error: record.lastError },
      })
      throw new ManagedWorktreeError('GIT_COMMAND_FAILED', record.lastError || 'Worktree creation failed', {
        worktree: record,
      })
    }
  }

  private async rollbackCreate(
    root: string,
    target: string,
    branchName: string,
    removeBranch: boolean,
  ): Promise<string[]> {
    const errors: string[] = []
    const entry = await this.findEntryByPath(
      await this.gitWorktreeEntries(root).catch(() => []),
      target,
    )
    if (entry) {
      const remove = await this.runner.run(root, ['worktree', 'remove', '--force', target], {
        timeoutMs: 60_000,
      })
      if (!remove.ok) errors.push(conciseGitError(remove.stderr, 'rollback remove failed'))
    }
    if (pathInside(this.managedRoot, target)) {
      await rm(target, { recursive: true, force: true }).catch((error) => {
        errors.push(`rollback path cleanup failed: ${(error as Error).message}`)
      })
    }
    if (removeBranch) {
      const branch = await this.runner.run(root, ['branch', '--list', branchName])
      if (branch.ok && branch.stdout.trim()) {
        const removeResult = await this.runner.run(root, ['branch', '-D', branchName])
        if (!removeResult.ok) {
          errors.push(conciseGitError(removeResult.stderr, 'rollback branch cleanup failed'))
        }
      }
    }
    return errors
  }

  async inspectSafety(id: string): Promise<WorktreeSafety> {
    const record = await this.repository.get(id)
    if (!record) throw new ManagedWorktreeError('WORKTREE_NOT_FOUND', 'Managed worktree not found')
    return this.inspectRecordSafety(record)
  }

  private async inspectRecordSafety(record: ManagedWorktree): Promise<WorktreeSafety> {
    const exists = await access(record.worktreePath).then(() => true).catch(() => false)
    const entries = await this.gitWorktreeEntries(record.rootWorkspacePath).catch(() => [])
    const registeredWithGit = (await this.findEntryByPath(entries, record.worktreePath)) != null
    const blockers: WorktreeSafety['blockers'] = []
    if (!exists) blockers.push('missing')
    if (!registeredWithGit) blockers.push('not-registered')

    let changedFiles: string[] = []
    if (exists && registeredWithGit) {
      const status = await this.runner.run(record.worktreePath, [
        'status',
        '--porcelain=v1',
        '--untracked-files=all',
      ])
      if (status.ok) {
        changedFiles = status.stdout
          .split(/\r?\n/)
          .filter(Boolean)
          .map((line) => line.slice(3))
          .slice(0, 500)
      }
    }
    const dirty = changedFiles.length > 0
    if (dirty) blockers.push('dirty')

    let aheadOfBase = 0
    let unmergedCommits = false
    let upstream: string | undefined
    let unpushedCommits = 0
    if (registeredWithGit) {
      const ahead = await this.runner.run(record.rootWorkspacePath, [
        'rev-list',
        '--count',
        `${record.baseRef}..${record.branchName}`,
      ])
      if (ahead.ok) aheadOfBase = Number.parseInt(ahead.stdout.trim(), 10) || 0
      if (aheadOfBase > 0) {
        const merged = await this.runner.run(record.rootWorkspacePath, [
          'merge-base',
          '--is-ancestor',
          record.branchName,
          record.baseRef,
        ])
        unmergedCommits = !merged.ok
      }
      const upstreamResult = await this.runner.run(record.rootWorkspacePath, [
        'rev-parse',
        '--abbrev-ref',
        `${record.branchName}@{upstream}`,
      ])
      if (upstreamResult.ok) {
        upstream = upstreamResult.stdout.trim()
        const unpushed = await this.runner.run(record.rootWorkspacePath, [
          'rev-list',
          '--count',
          `${upstream}..${record.branchName}`,
        ])
        if (unpushed.ok) unpushedCommits = Number.parseInt(unpushed.stdout.trim(), 10) || 0
      } else {
        unpushedCommits = aheadOfBase
      }
    }
    if (unmergedCommits) blockers.push('unmerged')
    if (unpushedCommits > 0) blockers.push('unpushed')

    return {
      exists,
      registeredWithGit,
      dirty,
      changedFiles,
      aheadOfBase,
      unmergedCommits,
      upstream,
      unpushedCommits,
      safeToRemove: blockers.length === 0,
      forceRemovalAllowed: true,
      blockers,
    }
  }

  async remove(request: WorktreeRemoveRequest): Promise<{
    worktree: ManagedWorktree
    safety: WorktreeSafety
  }> {
    const current = await this.repository.get(request.id)
    if (!current) throw new ManagedWorktreeError('WORKTREE_NOT_FOUND', 'Managed worktree not found')
    return this.serializeForRoot(current.rootWorkspacePath, async () => {
      const record = await this.repository.get(request.id)
      if (!record) throw new ManagedWorktreeError('WORKTREE_NOT_FOUND', 'Managed worktree not found')
      const safety = await this.inspectRecordSafety(record)
      if (!safety.safeToRemove && request.force !== true) {
        const next = {
          ...record,
          status: safety.dirty ? ('dirty' as const) : record.status,
          updatedAt: this.now(),
        }
        await this.saveVerified(next)
        this.audit({
          category: 'operation',
          action: 'worktree.remove-blocked',
          outcome: 'blocked',
          workspaceId: record.rootWorkspacePath,
          details: {
            worktreeId: record.id,
            worktreePath: record.worktreePath,
            blockers: safety.blockers,
          },
        })
        throw new ManagedWorktreeError(
          'WORKTREE_UNSAFE',
          'Worktree has changes or commits that are not safely integrated',
          { worktree: next, safety },
        )
      }
      if (request.force === true && request.confirmed !== true) {
        throw new ManagedWorktreeError(
          'CONFIRMATION_REQUIRED',
          'Forced worktree removal requires explicit confirmation',
          { safety },
        )
      }
      await this.assertManagedPath(record.worktreePath)
      let removing: ManagedWorktree = {
        ...record,
        status: 'removing',
        updatedAt: this.now(),
      }
      await this.saveVerified(removing)

      try {
        if (safety.registeredWithGit) {
          const args = ['worktree', 'remove']
          if (request.force === true) args.push('--force')
          args.push(record.worktreePath)
          const removed = await this.runner.run(record.rootWorkspacePath, args, {
            timeoutMs: 120_000,
          })
          if (!removed.ok) {
            throw new Error(conciseGitError(removed.stderr, 'git worktree remove failed'))
          }
        } else if (safety.exists && request.force === true) {
          await rm(record.worktreePath, { recursive: true, force: true })
        }
        if (request.deleteBranch === true) {
          const branchArgs = ['branch', request.force === true ? '-D' : '-d', record.branchName]
          const branch = await this.runner.run(record.rootWorkspacePath, branchArgs)
          if (!branch.ok) {
            throw new Error(conciseGitError(branch.stderr, 'git branch delete failed'))
          }
        }
        removing = {
          ...removing,
          status: 'removed',
          updatedAt: this.now(),
          lastError: undefined,
        }
        await this.saveVerified(removing)
        this.audit({
          category: 'operation',
          action: request.force === true ? 'worktree.force-remove' : 'worktree.remove',
          outcome: 'success',
          workspaceId: record.rootWorkspacePath,
          details: {
            worktreeId: record.id,
            worktreePath: record.worktreePath,
            branchName: record.branchName,
            deleteBranch: request.deleteBranch === true,
            blockers: safety.blockers,
          },
        })
        return { worktree: removing, safety }
      } catch (error) {
        const failed = {
          ...removing,
          status: safety.dirty ? ('dirty' as const) : ('error' as const),
          updatedAt: this.now(),
          lastError: (error instanceof Error ? error.message : String(error)).slice(0, 2_000),
        }
        await this.saveVerified(failed)
        this.audit({
          category: 'operation',
          action: request.force === true ? 'worktree.force-remove' : 'worktree.remove',
          outcome: 'failed',
          workspaceId: record.rootWorkspacePath,
          details: { worktreeId: record.id, error: failed.lastError },
        })
        throw new ManagedWorktreeError('GIT_COMMAND_FAILED', failed.lastError, {
          worktree: failed,
          safety,
        })
      }
    })
  }

  async reconcile(rootWorkspacePath?: string): Promise<WorktreeReconcileResult> {
    let resolvedRoot: string | undefined
    if (rootWorkspacePath) {
      const capability = await this.capability(rootWorkspacePath)
      resolvedRoot = capability.repositoryRoot
        ? normalizePath(capability.repositoryRoot)
        : normalizePath(rootWorkspacePath)
    }
    const records = await this.repository.list({
      rootWorkspacePath: resolvedRoot,
    })
    const byRoot = new Map<string, ManagedWorktree[]>()
    for (const record of records) {
      const rows = byRoot.get(record.rootWorkspacePath) ?? []
      rows.push(record)
      byRoot.set(record.rootWorkspacePath, rows)
    }
    if (resolvedRoot) {
      if (!byRoot.has(resolvedRoot)) {
        byRoot.set(resolvedRoot, [])
      }
    }

    const unregistered: WorktreeReconcileResult['unregistered'] = []
    const reconciled: ManagedWorktree[] = []
    for (const [root, rootRecords] of byRoot) {
      const entries = await this.gitWorktreeEntries(root).catch(() => [])
      const recordPaths = new Set(
        await Promise.all(rootRecords.map((record) => canonicalPath(record.worktreePath))),
      )
      const canonicalManagedRoot = await canonicalPath(this.managedRoot)
      for (const entry of entries) {
        const entryPath = await canonicalPath(entry.path)
        if (pathInside(canonicalManagedRoot, entryPath) && !recordPaths.has(entryPath)) {
          unregistered.push({
            rootWorkspacePath: root,
            worktreePath: entryPath,
            branchName: entry.branchName,
          })
        }
      }
      for (const record of rootRecords) {
        const registered = (await this.findEntryByPath(entries, record.worktreePath)) != null
        const exists = await access(record.worktreePath).then(() => true).catch(() => false)
        let status: ManagedWorktree['status']
        if (!registered || !exists) status = 'missing'
        else {
          const safety = await this.inspectRecordSafety(record)
          status = safety.dirty ? 'dirty' : 'ready'
        }
        const next = {
          ...record,
          status,
          updatedAt: this.now(),
          lastError: status === 'missing' ? 'Worktree is missing from disk or Git metadata' : undefined,
        }
        await this.saveVerified(next)
        if (record.status !== next.status) {
          this.audit({
            category: 'operation',
            action: 'worktree.reconcile',
            outcome: 'success',
            workspaceId: root,
            details: {
              worktreeId: record.id,
              worktreePath: record.worktreePath,
              previousStatus: record.status,
              status: next.status,
            },
          })
        }
        reconciled.push(next)
      }
    }
    return { worktrees: reconciled, unregistered }
  }

  private async gitWorktreeEntries(root: string): Promise<GitWorktreeListEntry[]> {
    const result = await this.runner.run(root, ['worktree', 'list', '--porcelain'])
    if (!result.ok) {
      throw new ManagedWorktreeError(
        'GIT_COMMAND_FAILED',
        conciseGitError(result.stderr, 'git worktree list failed'),
      )
    }
    return parseGitWorktreePorcelain(result.stdout)
  }

  private async assertManagedPath(target: string): Promise<void> {
    await mkdir(this.managedRoot, { recursive: true, mode: 0o700 })
    const canonicalRoot = await canonicalPath(this.managedRoot)
    const canonicalTarget = await canonicalPath(target)
    if (!pathInside(canonicalRoot, canonicalTarget)) {
      throw new ManagedWorktreeError(
        'PATH_OUTSIDE_MANAGED_ROOT',
        'Refusing to operate outside the managed worktree root',
      )
    }
  }

  private async findEntryByPath(
    entries: GitWorktreeListEntry[],
    target: string,
  ): Promise<GitWorktreeListEntry | undefined> {
    const canonicalTarget = await canonicalPath(target)
    for (const entry of entries) {
      if ((await canonicalPath(entry.path)) === canonicalTarget) return entry
    }
    return undefined
  }
}
