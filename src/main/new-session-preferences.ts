type NewSessionRuntime = {
  getState: () => Promise<unknown>
  setModel: (provider: string, modelId: string, sessionFile?: string) => Promise<string>
  setThinkingLevel: (level: string) => Promise<void>
}

type SessionRuntimePreferences = {
  model?: string
  thinkingLevel?: string
}

function runtimePreferences(state: unknown): SessionRuntimePreferences {
  const value = state as { model?: unknown; thinkingLevel?: unknown } | null
  const model = String(value?.model || '').trim()
  const thinkingLevel = String(value?.thinkingLevel || '').trim()
  return {
    ...(model ? { model } : {}),
    ...(thinkingLevel ? { thinkingLevel } : {}),
  }
}

function splitModelKey(model: string): { provider: string; modelId: string } {
  const separator = model.indexOf('/')
  const provider = separator > 0 ? model.slice(0, separator).trim() : ''
  const modelId = separator > 0 ? model.slice(separator + 1).trim() : ''
  if (!provider || !modelId) throw new Error(`MODEL_SELECTION_INVALID: ${model}`)
  return { provider, modelId }
}

/** Apply the previous conversation's actual runtime choices to a newly created session. */
export async function applyNewSessionPreferences(
  runtime: NewSessionRuntime,
  requested: SessionRuntimePreferences,
  sessionFile?: string,
): Promise<SessionRuntimePreferences> {
  let current = runtimePreferences(await runtime.getState())
  const requestedModel = String(requested.model || '').trim()
  const requestedThinking = String(requested.thinkingLevel || '').trim()

  if (requestedModel && current.model !== requestedModel) {
    const { provider, modelId } = splitModelKey(requestedModel)
    const actual = await runtime.setModel(provider, modelId, sessionFile)
    if (actual !== requestedModel) {
      throw new Error(
        `MODEL_SWITCH_NOT_APPLIED: requested ${requestedModel}, actual ${actual || 'none'}`,
      )
    }
  }

  if (requestedThinking && current.thinkingLevel !== requestedThinking) {
    await runtime.setThinkingLevel(requestedThinking)
  }

  current = runtimePreferences(await runtime.getState())
  return current
}
