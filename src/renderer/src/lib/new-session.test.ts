import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useAgentProfileStore } from '@renderer/stores/agent-profile-store'
import { materializePendingNewSession } from './new-session'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))

vi.mock('@renderer/lib/composer-run-display', () => ({
  refreshComposerRunDisplay: vi.fn().mockResolvedValue(undefined),
}))

describe('materializePendingNewSession', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({
      currentWorkspace: '/workspace',
      pendingNewSessionPlaceholder: true,
      currentSessionId: '__pending_new__',
      sessions: [],
      timelineItems: [],
      historySessionFile: null,
      runState: {
        status: 'idle',
        toolCount: 0,
        errorCount: 0,
        model: 'zai-coding-cn/glm-5.2',
        thinkingLevel: 'high',
      },
      lastModel: 'openai-codex/gpt-5.6-sol',
      lastThinking: 'medium',
    })
    useAgentProfileStore.setState({
      profiles: [],
      promptPresets: [],
      selectedProfileId: null,
      selectedPromptPresetId: null,
      temporaryPrompt: null,
      activeBinding: null,
      loading: false,
      loaded: true,
      promptPresetsLoading: false,
      promptPresetsLoaded: true,
      bindingLoading: false,
    })
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'session.new') {
        return {
          session: {
            sessionId: 'new-session',
            sessionFile: '/sessions/new.jsonl',
            workspaceId: '/workspace',
            title: '新会话',
            createdAt: 1,
            updatedAt: 1,
            modelId: 'zai-coding-cn/glm-5.2',
            thinkingLevel: 'high',
            status: 'idle',
          },
        }
      }
      if (method === 'session.list') return { sessions: [] }
      return {}
    })
  })

  it('passes the last active conversation model and thinking level to the real new session', async () => {
    await materializePendingNewSession('/workspace', '你好')

    expect(ipcClient.invoke).toHaveBeenCalledWith('session.new', {
      workspaceId: '/workspace',
      modelId: 'zai-coding-cn/glm-5.2',
      thinkingLevel: 'high',
    })
    expect(useUIStore.getState()).toMatchObject({
      currentSessionId: 'new-session',
      historySessionFile: '/sessions/new.jsonl',
      pendingNewSessionPlaceholder: false,
    })
  })

  it('passes the selected Agent and displays its immutable session binding', async () => {
    const profileId = '7c2f6716-82a0-49d4-aa18-78b26d698ff5'
    const binding = {
      kind: 'agent' as const,
      sessionId: 'new-session',
      sessionFile: '/sessions/new.jsonl',
      snapshot: {
        profileId,
        name: 'Research Agent',
        systemPrompt: 'Use citations.',
        promptMode: 'append' as const,
        capturedAt: 100,
      },
      createdAt: 100,
    }
    useAgentProfileStore.setState({
      selectedProfileId: profileId,
      profiles: [
        {
          id: profileId,
          name: 'Research Agent',
          systemPrompt: 'Use citations.',
          promptMode: 'append',
          status: 'active',
          createdAt: 100,
          updatedAt: 100,
        },
      ],
    })
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'session.new') {
        return {
          session: {
            sessionId: 'new-session',
            sessionFile: '/sessions/new.jsonl',
            workspaceId: '/workspace',
            title: '新会话',
            createdAt: 1,
            updatedAt: 1,
            modelId: 'zai-coding-cn/glm-5.2',
            thinkingLevel: 'high',
            status: 'idle',
          },
          conversationConfigBinding: binding,
        }
      }
      if (method === 'session.list') return { sessions: [] }
      return {}
    })

    await materializePendingNewSession('/workspace', '调研市场')

    expect(ipcClient.invoke).toHaveBeenCalledWith('session.new', {
      workspaceId: '/workspace',
      conversationConfig: { kind: 'agent', profileId },
      modelId: 'zai-coding-cn/glm-5.2',
      thinkingLevel: 'high',
    })
    expect(useAgentProfileStore.getState().activeBinding).toEqual(binding)
  })

  it('starts a conversation with one saved system prompt selection', async () => {
    const presetId = '86d06e79-2c03-4dfd-8e97-3f1500f548d9'
    useAgentProfileStore.setState({
      selectedPromptPresetId: presetId,
      promptPresets: [
        {
          id: presetId,
          name: 'Market Analyst',
          systemPrompt: 'Analyze the market rigorously.',
          promptMode: 'append',
          status: 'active',
          createdAt: 100,
          updatedAt: 100,
        },
      ],
    })

    await materializePendingNewSession('/workspace', '分析市场')

    expect(ipcClient.invoke).toHaveBeenCalledWith('session.new', {
      workspaceId: '/workspace',
      conversationConfig: { kind: 'prompt', presetId },
      modelId: 'zai-coding-cn/glm-5.2',
      thinkingLevel: 'high',
    })
  })

  it('uses a temporary system prompt once and clears it after materialization', async () => {
    useAgentProfileStore.getState().selectTemporaryPrompt({
      name: 'Draft Agent Prompt',
      systemPrompt: 'Help me design an Agent from scratch.',
      promptMode: 'append',
    })

    await materializePendingNewSession('/workspace', '从头搭建一个 Agent')

    expect(ipcClient.invoke).toHaveBeenCalledWith('session.new', {
      workspaceId: '/workspace',
      conversationConfig: {
        kind: 'temporaryPrompt',
        name: 'Draft Agent Prompt',
        systemPrompt: 'Help me design an Agent from scratch.',
        promptMode: 'append',
      },
      modelId: 'zai-coding-cn/glm-5.2',
      thinkingLevel: 'high',
    })
    expect(useAgentProfileStore.getState().temporaryPrompt).toBeNull()
  })
})
