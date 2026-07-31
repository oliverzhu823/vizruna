import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentCase } from '@shared/agent-case'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { AgentCasesPage } from './agent-cases-page'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({ adapters: [] }) },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const agentCase: AgentCase = {
  id: '7c2f6716-82a0-49d4-aa18-78b26d698ff5',
  name: 'Competitor research',
  summary: 'Produces a reviewed market report.',
  tags: ['research', 'report'],
  status: 'validated',
  workspacePath: '/workspace/research',
  sourceSessionId: 'session-1',
  sourceSessionFile: '/sessions/session-1.jsonl',
  modelId: 'openai-codex/gpt-5.6-sol',
  thinkingLevel: 'high',
  createdAt: 100,
  updatedAt: 100,
}

describe('AgentCasesPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.mocked(ipcClient.invoke).mockReset()
    useUIStore.setState({
      currentWorkspace: '/workspace/research',
      currentSessionId: 'session-1',
      historySessionFile: '/sessions/session-1.jsonl',
      sessions: [
        {
          sessionId: 'session-1',
          sessionFile: '/sessions/session-1.jsonl',
          title: 'Competitor research',
          updatedAt: 100,
          modelId: 'openai-codex/gpt-5.6-sol',
        },
      ],
      runState: { status: 'idle', toolCount: 0, errorCount: 0, thinkingLevel: 'high' },
      lastThinking: 'high',
    })
  })

  it('lists a saved case and opens its source conversation', async () => {
    vi.mocked(ipcClient.invoke).mockResolvedValue({ cases: [agentCase] })
    const onOpenSource = vi.fn().mockResolvedValue(undefined)

    render(<AgentCasesPage onOpenSource={onOpenSource} />)

    expect(await screen.findByText('Competitor research')).toBeVisible()
    expect(screen.getByText('Validated')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Open source' }))

    await waitFor(() => expect(onOpenSource).toHaveBeenCalledWith(agentCase))
  })

  it('saves the current conversation without copying its content into the request', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentCase.list') return { cases: [] }
      if (method === 'agentCase.create') return { agentCase }
      return {}
    })

    render(<AgentCasesPage onOpenSource={vi.fn()} />)
    expect(await screen.findByText('No Agent Cases yet')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Save current conversation' }))
    fireEvent.change(screen.getByLabelText('Case summary'), {
      target: { value: 'Reusable market research flow' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save case' }))

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith(
        'agentCase.create',
        expect.objectContaining({
          name: 'Competitor research',
          summary: 'Reusable market research flow',
          workspacePath: '/workspace/research',
          sourceSessionId: 'session-1',
          sourceSessionFile: '/sessions/session-1.jsonl',
        }),
      )
    })
    const createCall = vi.mocked(ipcClient.invoke).mock.calls.find(([method]) => method === 'agentCase.create')
    expect(createCall?.[1]).not.toHaveProperty('messages')
    expect(createCall?.[1]).not.toHaveProperty('content')
  })
})
