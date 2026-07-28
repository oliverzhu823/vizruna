import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const send = vi.fn()
  const runtimeLogin = vi.fn()
  return {
    send,
    runtimeLogin,
    win: {
      isDestroyed: vi.fn(() => false),
      isMinimized: vi.fn(() => false),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn(),
      webContents: { send },
    },
  }
})

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => mocks.win,
    getAllWindows: () => [mocks.win],
  },
  shell: { openExternal: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('../ipc/sdk-session', () => ({
  getActiveSdkModule: async () => ({
    ModelRuntime: {
      create: async () => ({
        login: mocks.runtimeLogin,
        refresh: vi.fn(),
      }),
    },
  }),
}))

vi.mock('../provider-routing/provider-routing-service', () => ({
  getProviderRoutingService: () => ({
    getConfig: async () => ({ routes: [], profiles: [] }),
    runtimeConfig: async () => ({ routes: [], profiles: [] }),
  }),
}))

vi.mock('../worker-manager', () => ({
  workerManager: { reloadAuthentication: vi.fn().mockResolvedValue(undefined) },
}))

vi.mock('./auth-network-scope', () => ({
  withProviderAuthNetwork: async (
    _config: unknown,
    _providerId: string,
    run: () => Promise<unknown>,
  ) => run(),
}))

import { ProviderAuthService } from './provider-auth-service'

describe('ProviderAuthService active-flow recovery', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.runtimeLogin.mockImplementation(
      async (
        _providerId: string,
        _authType: string,
        interaction: {
          prompt: (prompt: {
            type: 'select'
            message: string
            options: Array<{ id: string; label: string }>
          }) => Promise<string>
        },
      ) =>
        interaction.prompt({
          type: 'select',
          message: '选择授权方式',
          options: [{ id: 'browser', label: '网页授权' }],
        }),
    )
  })

  it('replays the pending prompt instead of rejecting subsequent login clicks', async () => {
    const service = new ProviderAuthService()
    const firstLogin = service.login('openai-codex', 'oauth')

    await vi.waitFor(() => {
      expect(mocks.send).toHaveBeenCalledWith(
        'ipc:provider-auth-flow',
        expect.objectContaining({ phase: 'prompt', providerId: 'openai-codex' }),
      )
    })
    const promptEventsBefore = mocks.send.mock.calls.filter(
      ([, event]) => event.phase === 'prompt',
    ).length

    await expect(service.login('openai-codex', 'oauth')).resolves.toBeUndefined()

    const promptEventsAfter = mocks.send.mock.calls.filter(
      ([, event]) => event.phase === 'prompt',
    ).length
    expect(promptEventsAfter).toBe(promptEventsBefore + 1)

    service.cancel()
    await expect(firstLogin).resolves.toBeUndefined()
  })
})
