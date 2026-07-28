import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { selectSessionModel } from './model-selection'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))

describe('selectSessionModel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUIStore.setState({
      currentWorkspace: null,
      historySessionFile: null,
      ephemeralSandboxDraft: false,
    })
  })

  it('defers a model selected in an ephemeral sandbox draft', async () => {
    useUIStore.setState({ ephemeralSandboxDraft: true })
    vi.mocked(ipcClient.invoke).mockResolvedValue({ modelId: 'zai-coding-cn/glm-5.2' })

    await expect(selectSessionModel('zai-coding-cn', 'glm-5.2')).resolves.toBe(
      'zai-coding-cn/glm-5.2',
    )
    expect(ipcClient.invoke).toHaveBeenCalledWith('model.set', {
      sessionId: '',
      provider: 'zai-coding-cn',
      modelId: 'glm-5.2',
      workspaceId: undefined,
      sessionFile: undefined,
      deferUntilSession: true,
    })
  })

  it('binds a live selection to the visible workspace and session', async () => {
    useUIStore.setState({
      currentWorkspace: '/workspace',
      historySessionFile: '/sessions/current.jsonl',
    })
    vi.mocked(ipcClient.invoke).mockResolvedValue({ modelId: 'openai-codex/gpt-5.6-sol' })

    await selectSessionModel('openai-codex', 'gpt-5.6-sol')
    expect(ipcClient.invoke).toHaveBeenCalledWith('model.set', {
      sessionId: '',
      provider: 'openai-codex',
      modelId: 'gpt-5.6-sol',
      workspaceId: '/workspace',
      sessionFile: '/sessions/current.jsonl',
      deferUntilSession: false,
    })
  })

  it('rejects an unverified response instead of updating optimistically', async () => {
    vi.mocked(ipcClient.invoke).mockResolvedValue({ modelId: 'openai-codex/other-model' })

    await expect(selectSessionModel('openai-codex', 'gpt-5.6-sol')).rejects.toThrow(
      'Model switch mismatch',
    )
  })
})
