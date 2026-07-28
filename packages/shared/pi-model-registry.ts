/** Minimal surface shared by Pi's legacy ModelRegistry and current ModelRuntime. */
export type PiModelRegistryLike = {
  find?: (provider: string, modelId: string) => unknown
  get?: (provider: string, modelId: string) => unknown
  getModel?: (provider: string, modelId: string) => unknown
}

export type PiSessionModelRef = {
  provider?: string
  id?: string
  modelId?: string
}

export function resolveModelFromRegistry(
  registry: PiModelRegistryLike | null | undefined,
  provider: string,
  modelId: string,
): unknown {
  if (!registry) return undefined
  return (
    registry.getModel?.(provider, modelId) ??
    registry.find?.(provider, modelId) ??
    registry.get?.(provider, modelId)
  )
}

export function piModelKey(provider: string, modelId: string): string {
  return `${provider.trim()}/${modelId.trim()}`
}

export function piSessionModelKey(model: PiSessionModelRef | null | undefined): string | undefined {
  if (!model) return undefined
  const provider = String(model.provider ?? '').trim()
  const modelId = String(model.modelId ?? model.id ?? '').trim()
  return provider && modelId ? `${provider}/${modelId}` : undefined
}

/** Resolve a Pi model, apply it, then verify the live session actually changed. */
export async function switchPiSessionModel(input: {
  registry: PiModelRegistryLike | null | undefined
  provider: string
  modelId: string
  setModel: (model: unknown) => Promise<void>
  getCurrentModel: () => PiSessionModelRef | null | undefined
}): Promise<string> {
  const provider = input.provider.trim()
  const modelId = input.modelId.trim()
  if (!provider || !modelId) throw new Error('MODEL_SELECTION_INVALID')

  const requested = piModelKey(provider, modelId)
  const model = resolveModelFromRegistry(input.registry, provider, modelId)
  if (!model) throw new Error(`MODEL_NOT_FOUND: ${requested}`)

  await input.setModel(model)
  const actual = piSessionModelKey(input.getCurrentModel())
  if (actual !== requested) {
    throw new Error(`MODEL_SWITCH_NOT_APPLIED: requested ${requested}, actual ${actual || 'none'}`)
  }
  return actual
}
