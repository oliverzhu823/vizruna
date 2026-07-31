import { registerHandler } from '../registry'
import { workerManager } from '../../worker-manager'
import { configStore } from '../../config-store'
import { isSandboxWorkspacePath } from '../../sandbox-workspaces'
import { readModelsConfigRaw, modelsCatalogFromConfig } from '../../pi-models-json'
import { getActiveSdkModule } from '../sdk-session'

async function persistDefaultModelSelection(
  provider: string,
  modelId: string,
  cwd?: string,
): Promise<string> {
  const sdk = await getActiveSdkModule()
  const runtime = await sdk.ModelRuntime.create({ allowModelNetwork: false })
  const model = runtime.getModel(provider, modelId)
  const key = `${provider}/${modelId}`
  if (!model) throw new Error(`MODEL_NOT_FOUND: ${key}`)
  if (!(await runtime.checkAuth(provider))) throw new Error(`MODEL_AUTH_MISSING: ${key}`)

  const settings = sdk.SettingsManager.create(cwd || process.cwd(), sdk.getAgentDir())
  settings.setDefaultModelAndProvider(provider, modelId)
  return key
}

export function registerModelRuntimeHandlers(): void {
  registerHandler('ipc:model.list', async (req) => {
    const scope = req?.scope === 'available' ? 'available' : 'catalog'
    const mapRegistry = (models: readonly { id: string; name?: string; provider?: string; contextWindow?: number; maxOutput?: number; maxTokens?: number }[]) =>
      models.map((m) => ({
        id: m.id,
        name: m.name || m.id,
        provider: m.provider,
        contextWindow: m.contextWindow || 0,
        maxOutput: m.maxOutput || m.maxTokens || 0,
        available: true,
      }))

    const catalogFromDisk = () => {
      const { config, parseError } = readModelsConfigRaw()
      if (parseError) return { models: [] as ReturnType<typeof mapRegistry> }
      return { models: modelsCatalogFromConfig(config) }
    }

    if (scope === 'catalog') return catalogFromDisk()

    if (workerManager.isRunning) {
      try {
        const models = await workerManager.getModels()
        if (models.length > 0) return { models }
      } catch (e) {
        console.error('[IPC] model.list worker failed:', e)
      }
    }
    try {
      const { ModelRuntime } = await getActiveSdkModule()
      const runtime = await ModelRuntime.create({ allowModelNetwork: false })
      const models = await runtime.getAvailable()
      if (models.length > 0) return { models: mapRegistry(models) }
    } catch (e) {
      console.error('[IPC] model.list failed:', e)
    }
    // `available` is an authorization boundary. Never fall back to the model
    // catalog here: catalog entries can exist without credentials and would be
    // selectable in Composer but fail as soon as the first prompt is sent.
    return { models: [] }
  })

  registerHandler('ipc:model.set', async (req) => {
    let provider: string
    let modelId: string
    if (req.provider && req.modelId) {
      provider = req.provider
      modelId = req.modelId
    } else {
      const raw = req.modelId || ''
      const separator = raw.indexOf('/')
      if (separator > 0) {
        provider = raw.slice(0, separator)
        modelId = raw.slice(separator + 1)
      } else {
        provider = 'anthropic'
        modelId = raw
      }
    }
    provider = provider.trim()
    modelId = modelId.trim()
    if (!provider || !modelId) throw new Error('MODEL_SELECTION_INVALID')

    const workspaceId = String(req.workspaceId || '').trim()
    const sessionFile = String(req.sessionFile || '').trim()
    const fallbackCwd = workspaceId || workerManager.cwd || configStore.get('currentProject') || ''

    if (req.deferUntilSession === true) {
      return {
        modelId: await persistDefaultModelSelection(provider, modelId, fallbackCwd || undefined),
      }
    }

    if (sessionFile) {
      await workerManager.loadSession(sessionFile, { cwd: fallbackCwd || undefined })
    } else if (!workerManager.isRunning || (workspaceId && workerManager.cwd !== workspaceId)) {
      if (!fallbackCwd || (!workspaceId && isSandboxWorkspacePath(fallbackCwd))) {
        return {
          modelId: await persistDefaultModelSelection(provider, modelId, fallbackCwd || undefined),
        }
      }
      await workerManager.start(fallbackCwd)
    }
    const actual = await workerManager.setModel(provider, modelId, sessionFile || undefined)
    return { modelId: actual }
  })

  registerHandler('ipc:model.cycle', async () => ({ modelId: '', thinkingLevel: 'medium' }))

  registerHandler('ipc:thinkingLevel.set', async (req) => {
    if (!workerManager.isRunning) {
      const cwd = workerManager.cwd || configStore.get('currentProject')
      if (!cwd || isSandboxWorkspacePath(cwd)) throw new Error('Worker not started')
      await workerManager.start(cwd)
    }
    await workerManager.setThinkingLevel(req.level)
    return { level: req.level }
  })

  registerHandler('ipc:runtime.getState', async (req) => {
    const workspaceId = String(req?.workspaceId || '').trim()
    const sessionFile = String(req?.sessionFile || '').trim()
    if (sessionFile) {
      try {
        return { state: await workerManager.getState(sessionFile) }
      } catch {
        return { state: null }
      }
    }
    if (workspaceId && workspaceId !== workerManager.cwd) {
      const bg = await workerManager.getBackgroundRuntimeState(workspaceId)
      return { state: bg }
    }
    if (!workerManager.isRunning) return { state: null }
    return { state: await workerManager.getState() }
  })

  registerHandler('ipc:context.preview', async () => {
    if (!workerManager.isRunning) return { preview: null }
    try {
      return { preview: await workerManager.getSessionContextPreview() }
    } catch (e) {
      console.error('[IPC] context.preview failed:', e)
      return { preview: null }
    }
  })
}
