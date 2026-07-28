import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
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
})
