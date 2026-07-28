import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { AuditEventInput } from '@shared/audit-events'
import type { ManagedWorktree } from '@shared/managed-worktree'
import {
  MemoryManagedWorktreeRepository,
  type ManagedWorktreeRepository,
} from './managed-worktree-repository'
import {
  ExecFileGitCommandRunner,
  type GitCommandRunner,
} from './git-worktree-runner'
import {
  ManagedWorktreeError,
  ManagedWorktreeService,
} from './managed-worktree-service'

const execFileAsync = promisify(execFile)
const temporaryDirectories: string[] = []

async function git(cwd: string, args: string[]): Promise<string> {
  const result = await execFileAsync('git', args, {
    cwd,
    encoding: 'utf8',
    timeout: 30_000,
  })
  return String(result.stdout || '').trim()
}

async function repositoryFixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-enterprise-worktree-'))
  temporaryDirectories.push(directory)
  const root = join(directory, 'repository')
  const managedRoot = join(directory, 'managed')
  await mkdir(root, { recursive: true })
  await git(root, ['init', '-b', 'main'])
  await git(root, ['config', 'user.email', 'tests@pi-enterprise.invalid'])
  await git(root, ['config', 'user.name', 'Pi Enterprise Tests'])
  await writeFile(join(root, 'README.md'), '# fixture\n')
  await git(root, ['add', 'README.md'])
  await git(root, ['commit', '-m', 'initial'])
  const repository = new MemoryManagedWorktreeRepository()
  const audit: AuditEventInput[] = []
  const service = new ManagedWorktreeService({
    managedRoot,
    repository,
    audit: (event) => {
      audit.push(event)
    },
  })
  return { directory, root, managedRoot, repository, service, audit }
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  )
})

describe('ManagedWorktreeService', () => {
  it('reports a non-Git directory without pretending it is isolated', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-enterprise-non-git-'))
    temporaryDirectories.push(directory)
    const service = new ManagedWorktreeService({
      managedRoot: join(directory, 'managed'),
      repository: new MemoryManagedWorktreeRepository(),
    })
    expect(await service.capability(directory)).toMatchObject({
      isGitRepository: false,
      reason: 'not-git-repository',
    })
    await expect(
      service.create({ rootWorkspacePath: directory, name: 'task' }),
    ).rejects.toMatchObject({ code: 'NOT_GIT_REPOSITORY' })
  })

  it('detects a bare repository as an unsupported workspace', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'pi-enterprise-bare-git-'))
    temporaryDirectories.push(directory)
    await git(directory, ['init', '--bare'])
    const service = new ManagedWorktreeService({
      managedRoot: join(directory, '..', 'managed'),
      repository: new MemoryManagedWorktreeRepository(),
    })
    expect(await service.capability(directory)).toMatchObject({
      isGitRepository: false,
      reason: 'bare-repository',
    })
  })

  it('creates and verifies a managed worktree transactionally', async () => {
    const { root, managedRoot, service, audit } = await repositoryFixture()
    const worktree = await service.create({
      rootWorkspacePath: root,
      name: 'Customer API',
      createdBySession: '/sessions/parent.jsonl',
    })
    const canonicalRoot = await realpath(root)

    expect(worktree).toMatchObject({
      rootWorkspacePath: canonicalRoot,
      status: 'ready',
      baseRef: 'main',
      createdBySession: '/sessions/parent.jsonl',
    })
    expect(worktree.worktreePath.startsWith(managedRoot)).toBe(true)
    expect(worktree.branchName).toMatch(/^pi-agent\/customer-api-/)
    expect(await readFile(join(worktree.worktreePath, 'README.md'), 'utf8')).toContain('fixture')
    expect(await git(root, ['worktree', 'list', '--porcelain'])).toContain(
      await realpath(worktree.worktreePath),
    )
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'worktree.create', outcome: 'success' }),
      ]),
    )
  })

  it('accepts a user-selected branch name and keeps the generated directory name separate', async () => {
    const { root, service } = await repositoryFixture()
    const worktree = await service.create({
      rootWorkspacePath: root,
      name: 'Customer Billing',
      branchName: 'feature/customer-billing',
    })

    expect(worktree.branchName).toBe('feature/customer-billing')
    expect(worktree.worktreePath).toMatch(/customer-billing-[a-f0-9]{8}$/)
    expect(await git(root, ['branch', '--list', 'feature/customer-billing'])).toContain(
      'feature/customer-billing',
    )
  })

  it('rejects an existing custom branch without removing or changing it', async () => {
    const { root, repository, service } = await repositoryFixture()
    await git(root, ['branch', 'feature/keep-me'])
    const existingCommit = await git(root, ['rev-parse', 'feature/keep-me'])

    await expect(
      service.create({
        rootWorkspacePath: root,
        name: 'Existing branch',
        branchName: 'feature/keep-me',
      }),
    ).rejects.toMatchObject({ code: 'BRANCH_ALREADY_EXISTS' })

    expect(await git(root, ['rev-parse', 'feature/keep-me'])).toBe(existingCommit)
    expect(await repository.list({ includeRemoved: true })).toHaveLength(0)
  })

  it('rejects an invalid custom branch before creating metadata or Git state', async () => {
    const { root, repository, service } = await repositoryFixture()

    await expect(
      service.create({
        rootWorkspacePath: root,
        name: 'Invalid branch',
        branchName: 'feature/invalid..name',
      }),
    ).rejects.toMatchObject({ code: 'INVALID_BRANCH_NAME' })

    expect(await repository.list({ includeRemoved: true })).toHaveLength(0)
  })

  it('rolls back an invalid Git add and never marks the record ready', async () => {
    const { root, repository, service } = await repositoryFixture()
    await expect(
      service.create({ rootWorkspacePath: root, name: 'bad', baseRef: 'missing/ref' }),
    ).rejects.toMatchObject({ code: 'INVALID_BASE_REF' })
    expect(await repository.list({ includeRemoved: true })).toHaveLength(0)
  })

  it('rolls back Git state when the ready metadata write fails', async () => {
    const fixture = await repositoryFixture()
    let failedReadyWrite = false
    const repository: ManagedWorktreeRepository = {
      get: (id) => fixture.repository.get(id),
      list: (options) => fixture.repository.list(options),
      save: (record) => {
        if (record.status === 'ready' && !failedReadyWrite) {
          failedReadyWrite = true
          throw new Error('injected database failure')
        }
        fixture.repository.save(record)
      },
    }
    const service = new ManagedWorktreeService({
      managedRoot: fixture.managedRoot,
      repository,
    })

    await expect(
      service.create({ rootWorkspacePath: fixture.root, name: 'database-failure' }),
    ).rejects.toMatchObject({ code: 'GIT_COMMAND_FAILED' })

    const records = await repository.list({ includeRemoved: true })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ status: 'error' })
    expect(await git(fixture.root, ['branch', '--list', records[0].branchName])).toBe('')
    expect((await git(fixture.root, ['worktree', 'list', '--porcelain'])).match(/^worktree /gm))
      .toHaveLength(1)
  })

  it('rolls back a created branch when post-add verification fails', async () => {
    const fixture = await repositoryFixture()
    const delegate = new ExecFileGitCommandRunner()
    let listCount = 0
    const runner: GitCommandRunner = {
      run: async (cwd, args, options) => {
        if (args.join(' ') === 'worktree list --porcelain') {
          listCount += 1
          if (listCount === 2) {
            return { ok: true, stdout: '', stderr: '', exitCode: 0 }
          }
        }
        return delegate.run(cwd, args, options)
      },
    }
    const service = new ManagedWorktreeService({
      managedRoot: fixture.managedRoot,
      repository: fixture.repository,
      runner,
    })

    await expect(
      service.create({ rootWorkspacePath: fixture.root, name: 'verify-failure' }),
    ).rejects.toMatchObject({ code: 'GIT_COMMAND_FAILED' })

    const records = await fixture.repository.list({ includeRemoved: true })
    expect(records).toHaveLength(1)
    expect(records[0]).toMatchObject({ status: 'error' })
    expect(await git(fixture.root, ['branch', '--list', records[0].branchName])).toBe('')
    expect((await git(fixture.root, ['worktree', 'list', '--porcelain'])).match(/^worktree /gm))
      .toHaveLength(1)
  })

  it('blocks dirty removal and requires explicit confirmation for forced removal', async () => {
    const { root, service, repository, audit } = await repositoryFixture()
    const worktree = await service.create({ rootWorkspacePath: root, name: 'dirty' })
    await writeFile(join(worktree.worktreePath, 'untracked.txt'), 'keep me\n')

    await expect(service.remove({ id: worktree.id })).rejects.toMatchObject({
      code: 'WORKTREE_UNSAFE',
      details: {
        safety: expect.objectContaining({ dirty: true, safeToRemove: false }),
      },
    })
    await expect(service.remove({ id: worktree.id, force: true })).rejects.toMatchObject({
      code: 'CONFIRMATION_REQUIRED',
    })
    expect((await repository.get(worktree.id))?.status).toBe('dirty')
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'worktree.remove-blocked', outcome: 'blocked' }),
      ]),
    )

    const removed = await service.remove({
      id: worktree.id,
      force: true,
      confirmed: true,
    })
    expect(removed.worktree.status).toBe('removed')
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'worktree.force-remove', outcome: 'success' }),
      ]),
    )
  })

  it('blocks unmerged and unpushed commits until they are integrated', async () => {
    const { root, service } = await repositoryFixture()
    const worktree = await service.create({ rootWorkspacePath: root, name: 'commit' })
    await writeFile(join(worktree.worktreePath, 'feature.txt'), 'feature\n')
    await git(worktree.worktreePath, ['add', 'feature.txt'])
    await git(worktree.worktreePath, ['commit', '-m', 'feature'])

    const unsafe = await service.inspectSafety(worktree.id)
    expect(unsafe).toMatchObject({
      dirty: false,
      unmergedCommits: true,
      unpushedCommits: 1,
      safeToRemove: false,
    })
    await expect(service.remove({ id: worktree.id })).rejects.toMatchObject({
      code: 'WORKTREE_UNSAFE',
    })

    await git(root, ['merge', '--no-ff', worktree.branchName, '-m', 'merge feature'])
    const safe = await service.inspectSafety(worktree.id)
    expect(safe.safeToRemove).toBe(true)
    const result = await service.remove({ id: worktree.id, deleteBranch: true })
    expect(result.worktree.status).toBe('removed')
    expect(await git(root, ['branch', '--list', worktree.branchName])).toBe('')
  })

  it('reconciles an externally removed worktree as missing', async () => {
    const { root, service, repository, audit } = await repositoryFixture()
    const worktree = await service.create({ rootWorkspacePath: root, name: 'missing' })
    await git(root, ['worktree', 'remove', '--force', worktree.worktreePath])

    const result = await service.reconcile(root)
    expect(result.worktrees.find((row) => row.id === worktree.id)?.status).toBe('missing')
    expect((await repository.get(worktree.id))?.status).toBe('missing')
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'worktree.reconcile', outcome: 'success' }),
      ]),
    )
  })

  it('detects command-line worktrees under the managed root without auto-adopting them', async () => {
    const { root, managedRoot, service } = await repositoryFixture()
    const externalPath = join(managedRoot, 'external', 'manual')
    await mkdir(join(managedRoot, 'external'), { recursive: true })
    await git(root, ['worktree', 'add', '-b', 'manual/external', externalPath, 'HEAD'])

    const result = await service.reconcile(root)
    const canonicalRoot = await realpath(root)
    const canonicalExternalPath = await realpath(externalPath)
    expect(result.unregistered).toEqual([
      expect.objectContaining({
        rootWorkspacePath: canonicalRoot,
        worktreePath: canonicalExternalPath,
        branchName: 'manual/external',
      }),
    ])
  })

  it('refuses a malicious repository record that points outside the managed root', async () => {
    const { root, directory, managedRoot, repository, service } = await repositoryFixture()
    const outside = join(directory, 'outside')
    await mkdir(outside)
    await writeFile(join(outside, 'do-not-delete.txt'), 'protected\n')
    const record: ManagedWorktree = {
      id: '11111111-1111-4111-8111-111111111111',
      rootWorkspacePath: root,
      worktreePath: outside,
      branchName: 'pi-agent/malicious',
      baseRef: 'main',
      baseCommit: await git(root, ['rev-parse', 'HEAD']),
      status: 'missing',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await repository.save(record)

    await expect(
      service.remove({ id: record.id, force: true, confirmed: true }),
    ).rejects.toBeInstanceOf(ManagedWorktreeError)
    expect(await readFile(join(outside, 'do-not-delete.txt'), 'utf8')).toBe('protected\n')
    expect(outside.startsWith(managedRoot)).toBe(false)
  })

  it('creates and safely removes twenty worktrees without Git or disk residue', async () => {
    const { root, managedRoot, service } = await repositoryFixture()
    for (let index = 0; index < 20; index += 1) {
      const worktree = await service.create({
        rootWorkspacePath: root,
        name: `batch-${index}`,
      })
      const removed = await service.remove({
        id: worktree.id,
        deleteBranch: true,
      })
      expect(removed.worktree.status).toBe('removed')
    }
    const porcelain = await git(root, ['worktree', 'list', '--porcelain'])
    expect(porcelain.match(/^worktree /gm)).toHaveLength(1)
    const remaining = await service.reconcile(root)
    expect(remaining.worktrees).toHaveLength(0)
    expect(remaining.unregistered).toHaveLength(0)
    expect(managedRoot).toContain('managed')
  }, 120_000)
})
