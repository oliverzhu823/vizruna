import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (request: Record<string, unknown>) => Promise<unknown>>()
  const setDefaultModelAndProvider = vi.fn()
  return {
    handlers,
    setDefaultModelAndProvider,
    catalogModels: [] as Array<Record<string, unknown>>,
    workerManager: {
      isRunning: false,
      cwd: null as string | null,
      start: vi.fn(),
      loadSession: vi.fn(),
      setModel: vi.fn(),
      getModels: vi.fn(),
      setThinkingLevel: vi.fn(),
      getState: vi.fn(),
      getBackgroundRuntimeState: vi.fn(),
      getSessionContextPreview: vi.fn(),
    },
  }
})

vi.mock('../registry', () => ({
  registerHandler: (channel: string, handler: (request: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, handler)
  },
}))

vi.mock('../../worker-manager', () => ({ workerManager: mocks.workerManager }))
vi.mock('../../config-store', () => ({
  configStore: { get: vi.fn(() => '/app/sandbox-workspaces/draft') },
}))
vi.mock('../../sandbox-workspaces', () => ({
  isSandboxWorkspacePath: (path: string) => path.includes('sandbox-workspaces'),
}))
vi.mock('../../pi-models-json', () => ({
  readModelsConfigRaw: () => ({ config: { providers: {} } }),
  modelsCatalogFromConfig: () => mocks.catalogModels,
}))
vi.mock('../sdk-session', () => ({
  getActiveSdkModule: async () => ({
    ModelRuntime: {
      create: async () => ({
        getModel: (provider: string, modelId: string) => ({ provider, id: modelId }),
        checkAuth: async () => ({ type: 'oauth', source: 'test' }),
        getAvailable: async () => [],
      }),
    },
    SettingsManager: {
      create: () => ({ setDefaultModelAndProvider: mocks.setDefaultModelAndProvider }),
    },
    getAgentDir: () => '/agent',
  }),
}))

import { registerModelRuntimeHandlers } from './model-runtime'

describe('model.set IPC routing', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.workerManager.isRunning = false
    mocks.workerManager.cwd = null
    mocks.catalogModels = []
    registerModelRuntimeHandlers()
  })

  it('persists an authenticated selection for an ephemeral draft without starting a Worker', async () => {
    const handler = mocks.handlers.get('ipc:model.set')!
    await expect(
      handler({
        provider: 'zai-coding-cn',
        modelId: 'glm-5.2',
        deferUntilSession: true,
      }),
    ).resolves.toEqual({ modelId: 'zai-coding-cn/glm-5.2' })

    expect(mocks.setDefaultModelAndProvider).toHaveBeenCalledWith('zai-coding-cn', 'glm-5.2')
    expect(mocks.workerManager.start).not.toHaveBeenCalled()
    expect(mocks.workerManager.setModel).not.toHaveBeenCalled()
  })

  it('loads the requested session and returns the Worker-verified model', async () => {
    mocks.workerManager.isRunning = true
    mocks.workerManager.cwd = '/workspace'
    mocks.workerManager.setModel.mockResolvedValue('openai-codex/gpt-5.6-sol')
    const handler = mocks.handlers.get('ipc:model.set')!

    await expect(
      handler({
        provider: 'openai-codex',
        modelId: 'gpt-5.6-sol',
        workspaceId: '/workspace',
        sessionFile: '/sessions/current.jsonl',
      }),
    ).resolves.toEqual({ modelId: 'openai-codex/gpt-5.6-sol' })

    expect(mocks.workerManager.loadSession).toHaveBeenCalledWith('/sessions/current.jsonl', {
      cwd: '/workspace',
    })
    expect(mocks.workerManager.setModel).toHaveBeenCalledWith(
      'openai-codex',
      'gpt-5.6-sol',
      '/sessions/current.jsonl',
    )
  })

  it('does not turn a Worker switch error into success', async () => {
    mocks.workerManager.isRunning = true
    mocks.workerManager.cwd = '/workspace'
    mocks.workerManager.setModel.mockRejectedValue(new Error('MODEL_NOT_FOUND'))
    const handler = mocks.handlers.get('ipc:model.set')!

    await expect(
      handler({
        provider: 'unknown',
        modelId: 'missing',
        workspaceId: '/workspace',
      }),
    ).rejects.toThrow('MODEL_NOT_FOUND')
  })

  it('never exposes unauthenticated catalog entries as available models', async () => {
    mocks.catalogModels = [
      {
        provider: 'openai-codex',
        id: 'gpt-test',
        name: 'gpt-test',
        contextWindow: 1000,
        maxOutput: 100,
        available: true,
      },
    ]
    const handler = mocks.handlers.get('ipc:model.list')!

    await expect(handler({ scope: 'available' })).resolves.toEqual({ models: [] })
    await expect(handler({ scope: 'catalog' })).resolves.toEqual({
      models: mocks.catalogModels,
    })
  })
})
