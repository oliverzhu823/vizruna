import { describe, expect, it, vi } from 'vitest'
import {
  resolveModelFromRegistry,
  switchPiSessionModel,
} from './pi-model-registry'

describe('resolveModelFromRegistry', () => {
  it('supports the current ModelRuntime getModel API', () => {
    const model = { provider: 'openai-codex', id: 'gpt-test' }
    expect(resolveModelFromRegistry({ getModel: () => model }, model.provider, model.id)).toBe(model)
  })
})

describe('switchPiSessionModel', () => {
  it('returns the verified live model key', async () => {
    const requested = { provider: 'zai-coding-cn', id: 'glm-test' }
    let current = { provider: 'openai-codex', id: 'gpt-test' }
    const setModel = vi.fn(async (model: unknown) => {
      current = model as typeof current
    })

    await expect(
      switchPiSessionModel({
        registry: { getModel: () => requested },
        provider: requested.provider,
        modelId: requested.id,
        setModel,
        getCurrentModel: () => current,
      }),
    ).resolves.toBe('zai-coding-cn/glm-test')
    expect(setModel).toHaveBeenCalledWith(requested)
  })

  it('rejects a model missing from the live runtime', async () => {
    await expect(
      switchPiSessionModel({
        registry: { getModel: () => undefined },
        provider: 'unknown',
        modelId: 'missing',
        setModel: vi.fn(),
        getCurrentModel: () => undefined,
      }),
    ).rejects.toThrow('MODEL_NOT_FOUND: unknown/missing')
  })

  it('rejects a switch that did not change the live session', async () => {
    await expect(
      switchPiSessionModel({
        registry: { getModel: () => ({ provider: 'zai-coding-cn', id: 'glm-test' }) },
        provider: 'zai-coding-cn',
        modelId: 'glm-test',
        setModel: vi.fn(async () => undefined),
        getCurrentModel: () => ({ provider: 'openai-codex', id: 'gpt-test' }),
      }),
    ).rejects.toThrow(
      'MODEL_SWITCH_NOT_APPLIED: requested zai-coding-cn/glm-test, actual openai-codex/gpt-test',
    )
  })
})
