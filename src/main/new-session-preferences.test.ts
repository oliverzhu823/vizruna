import { describe, expect, it, vi } from 'vitest'
import { applyNewSessionPreferences } from './new-session-preferences'

describe('applyNewSessionPreferences', () => {
  it('applies the previous model and thinking level to the new live session', async () => {
    let state = { model: 'anthropic/default', thinkingLevel: 'medium' }
    const runtime = {
      getState: vi.fn(async () => state),
      setModel: vi.fn(async (provider: string, modelId: string) => {
        state = { ...state, model: `${provider}/${modelId}` }
        return state.model
      }),
      setThinkingLevel: vi.fn(async (thinkingLevel: string) => {
        state = { ...state, thinkingLevel }
      }),
    }

    await expect(
      applyNewSessionPreferences(
        runtime,
        { model: 'zai-coding-cn/glm-5.2', thinkingLevel: 'high' },
        '/sessions/new.jsonl',
      ),
    ).resolves.toEqual({ model: 'zai-coding-cn/glm-5.2', thinkingLevel: 'high' })
    expect(runtime.setModel).toHaveBeenCalledWith(
      'zai-coding-cn',
      'glm-5.2',
      '/sessions/new.jsonl',
    )
    expect(runtime.setThinkingLevel).toHaveBeenCalledWith('high')
  })

  it('does not issue redundant mutations when the new runtime already inherited both values', async () => {
    const runtime = {
      getState: vi.fn(async () => ({ model: 'zai-coding-cn/glm-5.2', thinkingLevel: 'high' })),
      setModel: vi.fn(),
      setThinkingLevel: vi.fn(),
    }

    await applyNewSessionPreferences(runtime, {
      model: 'zai-coding-cn/glm-5.2',
      thinkingLevel: 'high',
    })

    expect(runtime.setModel).not.toHaveBeenCalled()
    expect(runtime.setThinkingLevel).not.toHaveBeenCalled()
  })
})
