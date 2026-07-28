import { beforeEach, describe, expect, it } from 'vitest'
import { PRODUCT_UI_STORAGE_KEY } from '@shared/product-identity'
import { useUIStore } from '../ui-store'

describe('managed worktree UI state persistence', () => {
  beforeEach(() => {
    window.localStorage.clear()
    useUIStore.persist.clearStorage()
  })

  it('does not persist repository-derived or transient worktree state', () => {
    useUIStore.setState({
      managedWorktrees: [
        {
          id: 'worktree-1',
          rootWorkspacePath: '/repo',
          worktreePath: '/managed/repo/task-1',
          branchName: 'pi-agent/task-1',
          baseRef: 'main',
          baseCommit: 'abc123',
          status: 'ready',
          createdAt: 1,
          updatedAt: 1,
        },
      ],
      worktreeCapability: {
        isGitRepository: true,
        repositoryRoot: '/repo',
        currentBranch: 'main',
        headCommit: 'abc123',
      },
      unregisteredWorktrees: [
        {
          rootWorkspacePath: '/repo',
          worktreePath: '/managed/repo/unregistered',
        },
      ],
      worktreeLoading: true,
      worktreeError: 'transient',
    })

    const persisted = JSON.parse(
      window.localStorage.getItem(PRODUCT_UI_STORAGE_KEY) || '{}',
    ) as { state?: Record<string, unknown> }

    expect(persisted.state).toBeDefined()
    expect(persisted.state).not.toHaveProperty('managedWorktrees')
    expect(persisted.state).not.toHaveProperty('worktreeCapability')
    expect(persisted.state).not.toHaveProperty('unregisteredWorktrees')
    expect(persisted.state).not.toHaveProperty('worktreeLoading')
    expect(persisted.state).not.toHaveProperty('worktreeError')
  })
})
