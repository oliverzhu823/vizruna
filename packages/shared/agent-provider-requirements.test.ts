import { describe, expect, it } from 'vitest'
import { evaluateAgentProviderRequirements } from './agent-provider-requirements'

const models = [
  {
    id: 'text-model',
    provider: 'provider',
    reasoning: false,
    input: ['text'] as Array<'text' | 'image'>,
    contextWindow: 32_000,
  },
  {
    id: 'capable-model',
    provider: 'provider',
    reasoning: true,
    input: ['text', 'image'] as Array<'text' | 'image'>,
    contextWindow: 200_000,
  },
]

describe('Agent Provider requirements', () => {
  it('requires a fixed available model when capabilities are declared', () => {
    expect(
      evaluateAgentProviderRequirements(undefined, models, {
        reasoning: true,
        imageInput: false,
      }),
    ).toEqual(['model-required'])
    expect(
      evaluateAgentProviderRequirements('provider/missing', models, {
        reasoning: true,
        imageInput: false,
      }),
    ).toEqual(['model-unavailable'])
  })

  it('reports every unmet capability and accepts a compatible model', () => {
    const requirements = {
      reasoning: true,
      imageInput: true,
      minContextWindow: 100_000,
    }
    expect(
      evaluateAgentProviderRequirements('provider/text-model', models, requirements),
    ).toEqual(['reasoning-required', 'image-required', 'context-window-required'])
    expect(
      evaluateAgentProviderRequirements('provider/capable-model', models, requirements),
    ).toEqual([])
  })
})
