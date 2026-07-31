import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SystemPromptPreset } from '@shared/system-prompt-preset'

const mocks = vi.hoisted(() => ({
  sqliteIndex: {
    getSystemPromptPreset: vi.fn(),
    bindSessionPrompt: vi.fn(() => true),
    getSessionPromptBinding: vi.fn(),
  },
  getSessionAgentBinding: vi.fn(),
  requireActiveAgentProfileSnapshot: vi.fn(),
  saveSessionAgentBinding: vi.fn(),
}))

vi.mock('./sqlite-index', () => ({ sqliteIndex: mocks.sqliteIndex }))
vi.mock('./agent-profile-service', () => ({
  getSessionAgentBinding: mocks.getSessionAgentBinding,
  requireActiveAgentProfileSnapshot: mocks.requireActiveAgentProfileSnapshot,
  saveSessionAgentBinding: mocks.saveSessionAgentBinding,
}))

import {
  getConversationConfigBinding,
  inheritConversationConfigBinding,
  requireActiveSystemPromptSnapshot,
  resolveConversationConfigSnapshot,
  saveConversationConfigBinding,
  snapshotSystemPromptPreset,
} from './system-prompt-preset-service'

const preset: SystemPromptPreset = {
  id: '86d06e79-2c03-4dfd-8e97-3f1500f548d9',
  name: 'Market Analyst',
  description: 'Evidence-first analysis',
  systemPrompt: 'Use evidence and state uncertainty.',
  promptMode: 'append',
  status: 'active',
  createdAt: 10,
  updatedAt: 20,
}

describe('system prompt presets and conversation snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sqliteIndex.bindSessionPrompt.mockReturnValue(true)
  })

  it('captures preset values so later library edits cannot change an existing conversation', () => {
    const source = { ...preset }
    const snapshot = snapshotSystemPromptPreset(source, 100)
    source.systemPrompt = 'Changed later'

    expect(snapshot).toEqual({
      source: 'preset',
      presetId: preset.id,
      name: 'Market Analyst',
      description: 'Evidence-first analysis',
      systemPrompt: 'Use evidence and state uncertainty.',
      promptMode: 'append',
      capturedAt: 100,
    })
  })

  it('rejects archived presets for new conversations', () => {
    mocks.sqliteIndex.getSystemPromptPreset.mockReturnValue({ ...preset, status: 'archived' })
    expect(() => requireActiveSystemPromptSnapshot(preset.id)).toThrow('archived')
  })

  it('resolves a temporary prompt without storing a reusable preset', () => {
    const snapshot = resolveConversationConfigSnapshot({
      kind: 'temporaryPrompt',
      name: 'Draft prompt',
      systemPrompt: 'Help build an Agent.',
      promptMode: 'append',
    })

    expect(snapshot).toMatchObject({
      source: 'temporary',
      name: 'Draft prompt',
      systemPrompt: 'Help build an Agent.',
      promptMode: 'append',
    })
    expect(mocks.sqliteIndex.getSystemPromptPreset).not.toHaveBeenCalled()
  })

  it('binds the prompt snapshot to the created session identity', () => {
    const snapshot = snapshotSystemPromptPreset(preset, 100)
    const binding = saveConversationConfigBinding({
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      snapshot,
    })

    expect(binding).toMatchObject({
      kind: 'prompt',
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      snapshot,
    })
    expect(mocks.sqliteIndex.bindSessionPrompt).toHaveBeenCalledWith(
      expect.objectContaining({ snapshot, presetId: preset.id }),
    )
  })

  it('inherits the same immutable snapshot when a conversation is forked', () => {
    const snapshot = snapshotSystemPromptPreset(preset, 100)
    mocks.sqliteIndex.getSessionPromptBinding.mockReturnValue({
      sessionId: 'source',
      sessionFile: '/sessions/source.jsonl',
      presetId: preset.id,
      snapshot,
      createdAt: 100,
    })

    const inherited = inheritConversationConfigBinding({
      sourceSessionFile: '/sessions/source.jsonl',
      sessionId: 'fork',
      sessionFile: '/sessions/fork.jsonl',
    })

    expect(inherited).toMatchObject({
      kind: 'prompt',
      sessionId: 'fork',
      sessionFile: '/sessions/fork.jsonl',
      snapshot,
    })
  })

  it('returns an Agent binding through the same conversation configuration API', () => {
    mocks.getSessionAgentBinding.mockReturnValue({
      sessionId: 'agent-session',
      sessionFile: '/sessions/agent.jsonl',
      profileId: 'agent-1',
      snapshot: {
        profileId: 'agent-1',
        name: 'Research Agent',
        systemPrompt: 'Research.',
        promptMode: 'append',
        capturedAt: 100,
      },
      createdAt: 100,
    })

    expect(
      getConversationConfigBinding({ sessionFile: '/sessions/agent.jsonl' }),
    ).toMatchObject({ kind: 'agent', snapshot: { profileId: 'agent-1' } })
  })
})
