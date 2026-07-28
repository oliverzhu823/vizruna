import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { enterNewSessionPlaceholder } from '@renderer/lib/new-session'
import { useUIStore } from '@renderer/stores/ui-store'
import { NewTaskDialog } from './new-task-dialog'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))

vi.mock('@renderer/lib/activate-workspace', () => ({
  activateWorkspace: vi.fn(),
}))

vi.mock('@renderer/lib/new-session', () => ({
  enterNewSessionPlaceholder: vi.fn(),
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

describe('NewTaskDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.clearAllMocks()
    useUIStore.setState({
      runState: {
        ...useUIStore.getState().runState,
        model: 'openai/gpt-test',
        thinkingLevel: 'high',
      },
      composerPrefill: null,
    })
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'model.list') {
        return {
          models: [
            {
              provider: 'openai',
              id: 'gpt-test',
              name: 'GPT Test',
              available: true,
            },
          ],
        }
      }
      if (method === 'providerRouting.get') {
        return {
          config: {
            profiles: [],
            routes: [{ provider: 'openai', mode: 'system' }],
            providers: [],
            systemProxyDetected: false,
          },
        }
      }
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
      if (method === 'settings.get') {
        return { settings: { maxSessionWorkers: 4 } }
      }
      if (method === 'worktree.create') {
        return {
          ok: true,
          worktree: {
            id: 'worktree-1',
            worktreePath: '/managed/repo/agent-task',
          },
        }
      }
      if (method === 'model.set') return { modelId: 'openai/gpt-test' }
      if (method === 'thinkingLevel.set') return { level: 'high' }
      return {}
    })
  })

  it('prepares a Worktree task with model, route, concurrency, and first prompt', async () => {
    const onClose = vi.fn()
    render(<NewTaskDialog projectPath="/repo" onClose={onClose} />)

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByLabelText('Provider')).toHaveValue('openai')
    expect(screen.getByLabelText('Model')).toHaveValue('openai/gpt-test')
    fireEvent.click(screen.getByRole('button', { name: 'Show advanced options' }))
    fireEvent.click(screen.getByRole('radio', { name: /Worktree/ }))
    fireEvent.change(screen.getByLabelText('Worktree name (optional)'), {
      target: { value: 'billing-adapter' },
    })
    fireEvent.change(screen.getByLabelText('Git branch (optional)'), {
      target: { value: 'feature/billing-adapter' },
    })
    fireEvent.change(screen.getByLabelText('First task'), {
      target: { value: 'Implement the billing adapter and run its tests.' },
    })
    fireEvent.change(screen.getByLabelText('Current provider route'), {
      target: { value: 'direct' },
    })
    fireEvent.change(screen.getByLabelText('Maximum parallel Workers'), {
      target: { value: '6' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Prepare task' }))

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith('worktree.create', {
        rootWorkspacePath: '/repo',
        name: 'billing-adapter',
        branchName: 'feature/billing-adapter',
      })
    })
    expect(ipcClient.invoke).toHaveBeenCalledWith('providerRouting.set', {
      provider: 'openai',
      mode: 'direct',
    })
    expect(ipcClient.invoke).toHaveBeenCalledWith('settings.set', {
      key: 'maxSessionWorkers',
      value: 6,
    })
    expect(activateWorkspace).toHaveBeenCalledWith(
      '/managed/repo/agent-task',
      { preferHome: true },
    )
    expect(enterNewSessionPlaceholder).toHaveBeenCalledOnce()
    expect(ipcClient.invoke).toHaveBeenCalledWith('model.set', {
      sessionId: '',
      provider: 'openai',
      modelId: 'gpt-test',
      workspaceId: '/managed/repo/agent-task',
      sessionFile: undefined,
      deferUntilSession: false,
    })
    expect(ipcClient.invoke).toHaveBeenCalledWith('thinkingLevel.set', {
      sessionId: '',
      level: 'high',
    })
    expect(useUIStore.getState().composerPrefill).toBe(
      'Implement the billing adapter and run its tests.',
    )
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('disables Worktree when the project is not a Git repository', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'model.list') {
        return { models: [{ provider: 'openai', id: 'gpt-test' }] }
      }
      if (method === 'providerRouting.get') {
        return {
          config: {
            profiles: [],
            routes: [],
            providers: [],
            systemProxyDetected: false,
          },
        }
      }
      if (method === 'worktree.capability') {
        return {
          ok: true,
          capability: {
            isGitRepository: false,
            message: 'Not a Git repository',
          },
        }
      }
      if (method === 'settings.get') {
        return { settings: { maxSessionWorkers: 4 } }
      }
      return {}
    })

    render(<NewTaskDialog projectPath="/plain-folder" onClose={() => {}} />)

    fireEvent.click(
      await screen.findByRole('button', { name: 'Show advanced options' }),
    )
    const worktreeOption = await screen.findByRole('radio', { name: /Worktree/ })
    expect(worktreeOption).toBeDisabled()
    expect(screen.getByText('Not a Git repository')).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Local/ })).toBeChecked()
  })

  it('clears task-specific draft state when reopened for another project', async () => {
    const onClose = vi.fn()
    const view = render(
      <NewTaskDialog projectPath="/repo" onClose={onClose} />,
    )

    await screen.findByRole('dialog')
    fireEvent.change(screen.getByLabelText('First task'), {
      target: { value: 'Do not carry this into another project.' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Show advanced options' }))

    useUIStore.getState().setRunState({ model: 'openai/another-model' })
    view.rerender(<NewTaskDialog projectPath="/repo" onClose={onClose} />)
    expect(screen.getByLabelText('First task')).toHaveValue(
      'Do not carry this into another project.',
    )

    view.rerender(<NewTaskDialog projectPath={null} onClose={onClose} />)
    view.rerender(<NewTaskDialog projectPath="/repo-two" onClose={onClose} />)

    expect(await screen.findByLabelText('First task')).toHaveValue('')
    expect(
      screen.getByRole('button', { name: 'Show advanced options' }),
    ).toHaveAttribute('aria-expanded', 'false')
  })
})
