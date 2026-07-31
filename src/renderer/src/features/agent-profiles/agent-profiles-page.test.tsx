import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentProfile } from '@shared/agent-profile'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useAgentProfileStore } from '@renderer/stores/agent-profile-store'
import { AgentProfilesPage } from './agent-profiles-page'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const agent: AgentProfile = {
  id: '7c2f6716-82a0-49d4-aa18-78b26d698ff5',
  name: 'Research Agent',
  description: 'Evidence-first market research',
  systemPrompt: 'Use citations.',
  promptMode: 'append',
  modelId: 'openai-codex/gpt-5.6-sol',
  thinkingLevel: 'high',
  tools: ['read', 'grep'],
  status: 'active',
  createdAt: 100,
  updatedAt: 100,
}

describe('AgentProfilesPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.mocked(ipcClient.invoke).mockReset()
    useAgentProfileStore.setState({
      profiles: [],
      selectedProfileId: null,
      activeBinding: null,
      loading: false,
      loaded: false,
      bindingLoading: false,
    })
  })

  it('lists configurations and starts a new conversation with the chosen Agent', async () => {
    vi.mocked(ipcClient.invoke).mockResolvedValue({ profiles: [agent] })
    const onUseAgent = vi.fn()

    render(<AgentProfilesPage onUseAgent={onUseAgent} />)

    expect(await screen.findByText('Research Agent')).toBeVisible()
    expect(screen.getByText('Evidence-first market research')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Use this Agent' }))
    expect(onUseAgent).toHaveBeenCalledWith(agent.id)
  })

  it('creates an append-mode Agent with inherited runtime settings', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentProfile.list') return { profiles: [] }
      if (method === 'model.list') return { models: [] }
      if (method === 'agentProfile.create') return { profile: agent }
      return {}
    })

    render(<AgentProfilesPage onUseAgent={vi.fn()} />)
    expect(await screen.findByText('No custom Agents yet')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'New Agent' }))
    fireEvent.change(screen.getByPlaceholderText('For example: Market Research Agent'), {
      target: { value: 'Research Agent' },
    })
    fireEvent.change(
      screen.getByPlaceholderText(
        "Describe the Agent's role, goals, boundaries, and output requirements…",
      ),
      { target: { value: 'Use citations.' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith('agentProfile.create', {
        name: 'Research Agent',
        description: undefined,
        systemPrompt: 'Use citations.',
        promptMode: 'append',
        modelId: undefined,
        thinkingLevel: undefined,
        tools: undefined,
      })
    })
  })
})
