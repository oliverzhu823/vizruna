import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { WorktreesPanel } from './worktrees-panel'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))

vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: vi.fn(),
}))

const worktree = {
  id: 'worktree-1',
  rootWorkspacePath: '/repo',
  worktreePath: '/managed/repo/task-1',
  branchName: 'pi-agent/task-1',
  baseRef: 'main',
  baseCommit: 'abc123',
  status: 'ready' as const,
  createdAt: 1,
  updatedAt: 1,
}

describe('WorktreesPanel', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.mocked(ipcClient.invoke).mockReset()
    useUIStore.setState({
      currentWorkspace: '/repo',
      managedWorktrees: [],
      worktreeCapability: null,
      unregisteredWorktrees: [],
      worktreeLoading: false,
      worktreeError: null,
    })
  })

  it('explains the honest Local fallback for a non-Git folder', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'worktree.capability') {
        return {
          ok: true,
          capability: {
            isGitRepository: false,
            reason: 'not-git-repository',
            message: 'Not a Git repository',
          },
        }
      }
      if (method === 'worktree.reconcile') return { ok: true, worktrees: [], unregistered: [] }
      if (method === 'worktree.list') return { ok: true, worktrees: [] }
      return {}
    })

    render(<WorktreesPanel />)

    expect(
      await screen.findByText('This folder is not a usable Git repository'),
    ).toBeInTheDocument()
    expect(screen.getByText('Not a Git repository')).toBeInTheDocument()
  })

  it('does not offer forced removal while the worktree is active', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'worktree.capability') {
        return {
          ok: true,
          capability: {
            isGitRepository: true,
            repositoryRoot: '/repo',
            currentBranch: 'main',
            headCommit: 'abc123',
          },
        }
      }
      if (method === 'worktree.reconcile') {
        return { ok: true, worktrees: [worktree], unregistered: [] }
      }
      if (method === 'worktree.list') return { ok: true, worktrees: [worktree] }
      if (method === 'worktree.inspectRemoval') {
        return {
          ok: true,
          safety: {
            exists: true,
            registeredWithGit: true,
            dirty: false,
            changedFiles: [],
            aheadOfBase: 0,
            unmergedCommits: false,
            unpushedCommits: 0,
            safeToRemove: false,
            forceRemovalAllowed: false,
            blockers: ['active-workspace'],
          },
        }
      }
      return {}
    })

    render(<WorktreesPanel />)
    await screen.findByText('pi-agent/task-1')
    fireEvent.click(screen.getByRole('button', { name: 'Safe remove' }))

    expect(await screen.findByText('This worktree is in use')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Confirm forced removal' }),
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/The current UI or a background task is using this worktree/),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('checkbox', { name: 'Also delete the associated branch' }),
    ).not.toBeInTheDocument()
    await waitFor(() => {
      expect(ipcClient.invoke).not.toHaveBeenCalledWith(
        'worktree.remove',
        expect.anything(),
      )
    })
  })

  it('passes separate task and custom branch names to the creation transaction', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'worktree.capability') {
        return {
          ok: true,
          capability: {
            isGitRepository: true,
            repositoryRoot: '/repo',
            currentBranch: 'main',
            headCommit: 'abc123',
          },
        }
      }
      if (method === 'worktree.reconcile') {
        return { ok: true, worktrees: [], unregistered: [] }
      }
      if (method === 'worktree.list') return { ok: true, worktrees: [] }
      if (method === 'worktree.create') return { ok: true, worktree }
      return {}
    })

    render(<WorktreesPanel />)
    await screen.findByText('This repository has no managed worktrees yet.')
    fireEvent.click(screen.getByRole('button', { name: 'Create worktree' }))
    fireEvent.change(screen.getByLabelText('Task name'), {
      target: { value: 'billing-worktree' },
    })
    fireEvent.change(screen.getByLabelText('Branch name (optional)'), {
      target: { value: 'feature/billing-worktree' },
    })
    fireEvent.click(screen.getAllByRole('button', { name: 'Create worktree' }).at(-1)!)

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith('worktree.create', {
        name: 'billing-worktree',
        branchName: 'feature/billing-worktree',
      })
    })
  })
})
