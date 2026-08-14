import { describe, expect, it } from 'vitest'
import type { AgentProfile } from './agent-profile'
import {
  agentVersionConfigFromProfile,
  diffAgentVersions,
  serializeAgentVersionConfig,
} from './agent-version'

function profile(overrides: Partial<AgentProfile> = {}): AgentProfile {
  return {
    id: 'profile-1',
    name: 'Research Agent',
    systemPrompt: 'Research carefully',
    promptMode: 'append',
    tools: ['write', 'read', 'read'],
    resourceSelection: {
      mode: 'selected',
      packageIds: ['b', 'a'],
      resourceIds: ['skill-b', 'skill-a'],
      projectContext: 'none',
    },
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  }
}

describe('Agent version identity', () => {
  it('normalizes unordered tools and Pi resource selectors', () => {
    const first = agentVersionConfigFromProfile(profile())
    const second = agentVersionConfigFromProfile(profile({
      tools: ['read', 'write'],
      resourceSelection: {
        mode: 'selected',
        packageIds: ['a', 'b'],
        resourceIds: ['skill-a', 'skill-b'],
        projectContext: 'none',
      },
    }))
    expect(serializeAgentVersionConfig(first)).toBe(serializeAgentVersionConfig(second))
  })

  it('reports only fields whose reproducible configuration changed', () => {
    const before = agentVersionConfigFromProfile(profile())
    const after = agentVersionConfigFromProfile(profile({
      systemPrompt: 'Research and cite every claim',
      thinkingLevel: 'high',
    }))
    expect(diffAgentVersions(before, after).map((item) => item.field)).toEqual([
      'systemPrompt',
      'thinkingLevel',
    ])
  })
})
