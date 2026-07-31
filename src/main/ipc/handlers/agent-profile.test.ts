import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile, SessionAgentBinding } from '@shared/agent-profile'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (request: Record<string, unknown>) => Promise<unknown>>()
  return {
    handlers,
    sqliteIndex: {
      listAgentProfiles: vi.fn(() => []),
      getAgentProfile: vi.fn(),
      saveAgentProfile: vi.fn(() => true),
    },
    getSessionAgentBinding: vi.fn(),
    auditWrite: vi.fn(),
  }
})

vi.mock('../registry', () => ({
  registerHandlerWithSchema: (
    channel: string,
    schema: { parse: (request: unknown) => Record<string, unknown> },
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => {
    mocks.handlers.set(channel, (request) => handler(schema.parse(request)))
  },
}))

vi.mock('../../sqlite-index', () => ({ sqliteIndex: mocks.sqliteIndex }))
vi.mock('../../agent-profile-service', () => ({
  getSessionAgentBinding: mocks.getSessionAgentBinding,
}))
vi.mock('../../audit/audit-repository', () => ({
  auditRepository: { write: mocks.auditWrite },
}))

import { registerAgentProfileHandlers } from './agent-profile'

const profileId = '7c2f6716-82a0-49d4-aa18-78b26d698ff5'
const existingProfile: AgentProfile = {
  id: profileId,
  name: 'Research Agent',
  description: 'Research with citations',
  systemPrompt: 'Use authoritative sources and cite every conclusion.',
  promptMode: 'append',
  modelId: 'openai-codex/gpt-5.6-sol',
  thinkingLevel: 'high',
  tools: ['read', 'grep'],
  status: 'active',
  createdAt: 100,
  updatedAt: 100,
}

describe('Agent Profile IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.sqliteIndex.getAgentProfile.mockReturnValue(existingProfile)
    mocks.sqliteIndex.saveAgentProfile.mockReturnValue(true)
    registerAgentProfileHandlers()
  })

  it('creates a reusable active Agent configuration', async () => {
    const handler = mocks.handlers.get('ipc:agentProfile.create')!
    const response = (await handler({
      name: ' Research Agent ',
      description: ' Evidence-first research ',
      systemPrompt: ' Always cite sources. ',
      promptMode: 'append',
      modelId: 'openai-codex/gpt-5.6-sol',
      thinkingLevel: 'high',
      tools: ['read', 'read', 'grep'],
    })) as { profile: AgentProfile }

    expect(response.profile).toMatchObject({
      name: 'Research Agent',
      description: 'Evidence-first research',
      systemPrompt: 'Always cite sources.',
      promptMode: 'append',
      status: 'active',
      tools: ['read', 'grep'],
    })
    expect(response.profile.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(mocks.sqliteIndex.saveAgentProfile).toHaveBeenCalledWith(response.profile)
    expect(mocks.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent-profile.create', outcome: 'success' }),
    )
  })

  it('can clear inherited model, thinking and tool overrides while editing', async () => {
    const handler = mocks.handlers.get('ipc:agentProfile.update')!
    const response = (await handler({
      id: profileId,
      modelId: null,
      thinkingLevel: null,
      tools: null,
    })) as { profile: AgentProfile }

    expect(response.profile.modelId).toBeUndefined()
    expect(response.profile.thinkingLevel).toBeUndefined()
    expect(response.profile.tools).toBeUndefined()
    expect(response.profile.systemPrompt).toBe(existingProfile.systemPrompt)
  })

  it('archives without deleting profiles', async () => {
    const handler = mocks.handlers.get('ipc:agentProfile.archive')!
    const response = (await handler({ id: profileId })) as { profile: AgentProfile }

    expect(response.profile.status).toBe('archived')
    expect(mocks.sqliteIndex.saveAgentProfile).toHaveBeenCalledOnce()
    expect(mocks.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent-profile.archive', outcome: 'success' }),
    )
  })

  it('returns the immutable Agent snapshot bound to a conversation', async () => {
    const binding: SessionAgentBinding = {
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      profileId,
      snapshot: {
        profileId,
        name: existingProfile.name,
        systemPrompt: existingProfile.systemPrompt,
        promptMode: existingProfile.promptMode,
        capturedAt: 120,
      },
      createdAt: 120,
    }
    mocks.getSessionAgentBinding.mockReturnValue(binding)
    const handler = mocks.handlers.get('ipc:agentProfile.binding.get')!

    await expect(
      handler({ sessionId: 'session-1', sessionFile: '/sessions/session-1.jsonl' }),
    ).resolves.toEqual({ binding })
  })

  it('rejects invalid prompt modes before storage', async () => {
    const handler = mocks.handlers.get('ipc:agentProfile.create')!

    expect(() =>
      handler({
        name: 'Unsafe Agent',
        systemPrompt: 'Prompt',
        promptMode: 'dynamic',
      }),
    ).toThrow()
    expect(mocks.sqliteIndex.saveAgentProfile).not.toHaveBeenCalled()
  })
})
