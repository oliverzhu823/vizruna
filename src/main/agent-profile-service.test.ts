import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from '@shared/agent-profile'

const mocks = vi.hoisted(() => ({
  sqliteIndex: {
    getAgentProfile: vi.fn(),
    bindSessionAgent: vi.fn(() => true),
    getSessionAgentBinding: vi.fn(),
  },
}))

vi.mock('./sqlite-index', () => ({ sqliteIndex: mocks.sqliteIndex }))

import {
  requireActiveAgentProfileSnapshot,
  inheritSessionAgentBinding,
  saveSessionAgentBinding,
  snapshotAgentProfile,
} from './agent-profile-service'

const profile: AgentProfile = {
  id: '7c2f6716-82a0-49d4-aa18-78b26d698ff5',
  name: 'Research Agent',
  systemPrompt: 'Use citations.',
  promptMode: 'append',
  tools: ['read'],
  status: 'active',
  createdAt: 10,
  updatedAt: 20,
}

describe('Agent profile session snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sqliteIndex.bindSessionAgent.mockReturnValue(true)
  })

  it('copies profile values so later edits cannot change an existing conversation', () => {
    const source = { ...profile, tools: ['read'] }
    const snapshot = snapshotAgentProfile(source, 100)

    source.tools.push('bash')
    expect(snapshot).toMatchObject({
      profileId: profile.id,
      name: 'Research Agent',
      systemPrompt: 'Use citations.',
      promptMode: 'append',
      tools: ['read'],
      capturedAt: 100,
    })
  })

  it('does not allow an archived Agent to start a new conversation', () => {
    mocks.sqliteIndex.getAgentProfile.mockReturnValue({ ...profile, status: 'archived' })

    expect(() => requireActiveAgentProfileSnapshot(profile.id)).toThrow('archived')
  })

  it('persists the captured snapshot against the new session identity', () => {
    const snapshot = snapshotAgentProfile(profile, 100)
    const binding = saveSessionAgentBinding({
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      snapshot,
    })

    expect(binding).toMatchObject({
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      profileId: profile.id,
      snapshot,
    })
    expect(mocks.sqliteIndex.bindSessionAgent).toHaveBeenCalledWith(binding)
  })

  it('carries the same snapshot into forks and clones', () => {
    const snapshot = snapshotAgentProfile(profile, 100)
    mocks.sqliteIndex.getSessionAgentBinding.mockReturnValue({
      sessionId: 'source',
      sessionFile: '/sessions/source.jsonl',
      profileId: profile.id,
      snapshot,
      createdAt: 100,
    })

    const binding = inheritSessionAgentBinding({
      sourceSessionFile: '/sessions/source.jsonl',
      sessionId: 'fork',
      sessionFile: '/sessions/fork.jsonl',
    })

    expect(binding?.snapshot).toEqual(snapshot)
    expect(binding).toMatchObject({
      sessionId: 'fork',
      sessionFile: '/sessions/fork.jsonl',
      profileId: profile.id,
    })
  })
})
