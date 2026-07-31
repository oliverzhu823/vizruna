import { describe, expect, it } from 'vitest'
import type { AgentProfileSnapshot } from '@shared/agent-profile'
import type { SystemPromptSnapshot } from '@shared/system-prompt-preset'
import {
  buildAgentPromptLoaderOverrides,
  buildAgentToolsOverride,
} from '../worker/agent-profile-runtime'

function profile(
  overrides: Partial<AgentProfileSnapshot> = {},
): AgentProfileSnapshot {
  return {
    profileId: 'b0d3a941-2048-4c9d-a7ea-a6d3a82dc012',
    name: 'Research Agent',
    systemPrompt: 'Return a cited research report.',
    promptMode: 'append',
    capturedAt: 100,
    ...overrides,
  }
}

describe('Agent profile Pi runtime options', () => {
  it('leaves General Pi prompt and tools untouched', () => {
    expect(buildAgentPromptLoaderOverrides(null)).toEqual({})
    expect(buildAgentToolsOverride(null)).toEqual({})
  })

  it('appends scenario instructions without mutating Pi base prompts', () => {
    const overrides = buildAgentPromptLoaderOverrides(profile())
    const base = ['Pi default', 'Project SYSTEM.md']

    expect(overrides.appendSystemPromptOverride?.(base)).toEqual([
      ...base,
      'Return a cited research report.',
    ])
    expect(base).toEqual(['Pi default', 'Project SYSTEM.md'])
    expect(overrides.systemPromptOverride).toBeUndefined()
  })

  it('replaces the Pi prompt only in explicit replace mode', () => {
    const overrides = buildAgentPromptLoaderOverrides(
      profile({ promptMode: 'replace', systemPrompt: 'You are a closed-domain reviewer.' }),
    )

    expect(overrides.systemPromptOverride?.()).toBe('You are a closed-domain reviewer.')
    expect(overrides.appendSystemPromptOverride).toBeUndefined()
  })

  it('distinguishes inherited tools from an intentionally tool-less Agent', () => {
    expect(buildAgentToolsOverride(profile())).toEqual({})
    expect(buildAgentToolsOverride(profile({ tools: [] }))).toEqual({ tools: [] })
    expect(buildAgentToolsOverride(profile({ tools: ['read', 'grep'] }))).toEqual({
      tools: ['read', 'grep'],
    })
  })

  it('applies a standalone conversation prompt without overriding Agent tools', () => {
    const prompt: SystemPromptSnapshot = {
      source: 'temporary',
      name: 'Draft Agent Prompt',
      systemPrompt: 'Help design an Agent from scratch.',
      promptMode: 'append',
      capturedAt: 100,
    }

    expect(
      buildAgentPromptLoaderOverrides(prompt).appendSystemPromptOverride?.(['Pi default']),
    ).toEqual(['Pi default', 'Help design an Agent from scratch.'])
    expect(buildAgentToolsOverride(prompt)).toEqual({})
  })
})
