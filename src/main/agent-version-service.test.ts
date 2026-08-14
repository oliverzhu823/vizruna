import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'

const mocks = vi.hoisted(() => ({
  latest: null as AgentVersion | null,
  saved: [] as AgentVersion[],
}))

vi.mock('./sqlite-index', () => ({
  sqliteIndex: {
    getLatestAgentVersion: vi.fn(() => mocks.latest),
    saveAgentVersion: vi.fn((version: AgentVersion) => {
      mocks.saved.push(version)
      return true
    }),
    getAgentVersion: vi.fn(),
    listAgentProfiles: vi.fn(() => []),
    listAgentEvaluationSuites: vi.fn(() => []),
    saveAgentEvaluationSuite: vi.fn(() => true),
  },
}))

import { ensureAgentVersion, releaseAgentVersion } from './agent-version-service'

const profile: AgentProfile = {
  id: 'profile-1',
  name: 'Agent',
  systemPrompt: 'Act carefully',
  promptMode: 'append',
  tools: ['write', 'read'],
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}

describe('Agent version service', () => {
  beforeEach(() => {
    mocks.latest = null
    mocks.saved = []
  })

  it('creates an immutable candidate and reuses it for equivalent configuration', () => {
    const first = ensureAgentVersion(profile, 10)
    expect(first.number).toBe(1)
    expect(first.status).toBe('candidate')
    mocks.latest = first
    const same = ensureAgentVersion({ ...profile, tools: ['read', 'write'], updatedAt: 99 }, 20)
    expect(same.id).toBe(first.id)
    expect(mocks.saved).toHaveLength(1)
  })

  it('increments the version when reproducible behavior changes', () => {
    mocks.latest = ensureAgentVersion(profile, 10)
    const second = ensureAgentVersion({ ...profile, systemPrompt: 'Act and cite sources' }, 20)
    expect(second.number).toBe(2)
    expect(second.digest).not.toBe(mocks.latest.digest)
  })

  it('does not release an unvalidated candidate', () => {
    const candidate = ensureAgentVersion(profile, 10)
    expect(() => releaseAgentVersion(candidate)).toThrow('validated')
  })
})
