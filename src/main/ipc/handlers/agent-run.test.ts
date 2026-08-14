import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (request: Record<string, unknown>) => Promise<unknown>>()
  return {
    handlers,
    listSessions: vi.fn(),
    getMessages: vi.fn(),
    listRuntime: vi.fn(),
    listBindings: vi.fn(),
    listCases: vi.fn(),
    getRuntimeEvidence: vi.fn(),
    listTurnEvidence: vi.fn(),
  }
})

vi.mock('../registry', () => ({
  registerHandlerWithSchema: (channel: string, schema: { parse: (value: unknown) => Record<string, unknown> }, handler: (value: Record<string, unknown>) => Promise<unknown>) => {
    mocks.handlers.set(channel, (request) => handler(schema.parse(request)))
  },
}))
vi.mock('../sdk-session', () => ({ listSessionsOnDisk: mocks.listSessions }))
vi.mock('../../session-messages-from-disk', () => ({ getSessionMessagesFromDisk: mocks.getMessages }))
vi.mock('../../worker-manager', () => ({ workerManager: { listSessionRuntime: mocks.listRuntime } }))
vi.mock('../../sqlite-index', () => ({
  sqliteIndex: { listSessionAgentBindings: mocks.listBindings, listAgentCases: mocks.listCases, getAgentRunRuntimeEvidence: mocks.getRuntimeEvidence, listAgentRunTurnEvidence: mocks.listTurnEvidence },
}))

import { registerAgentRunHandlers } from './agent-run'

describe('Agent run history IPC', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.listRuntime.mockReturnValue([])
    mocks.listCases.mockReturnValue([{ id: 'case-1', name: 'Saved run', sourceSessionFile: '/sessions/one.jsonl' }])
    mocks.getRuntimeEvidence.mockReturnValue({ runId: 'run-1', resourceEvidence: { capturedAt: 100, activeTools: [{ name: 'read' }], skills: [], promptTemplates: [], extensions: [], contextFiles: [], systemPromptSources: [] }, capturedAt: 100 })
    mocks.listTurnEvidence.mockReturnValue([{ runId: 'run-1', status: 'completed', startedAt: 100, endedAt: 200, usage: { input: 100, output: 20, cacheRead: 40, cacheWrite: 0, cost: 0.02 }, tools: [{ name: 'read', calls: 1, failed: 0 }], compactions: { count: 0, tokensSaved: 0 }, files: [], errors: [] }])
    mocks.listBindings.mockReturnValue([{
      sessionId: 'session-1', sessionFile: '/sessions/one.jsonl', profileId: '7c2f6716-82a0-49d4-aa18-78b26d698ff5', createdAt: 100,
      snapshot: { profileId: '7c2f6716-82a0-49d4-aa18-78b26d698ff5', versionId: 'version-1', versionNumber: 2, name: 'Research', systemPrompt: 'Research', promptMode: 'append', modelId: 'openai/gpt', capturedAt: 100 },
    }])
    mocks.listSessions.mockResolvedValue([{ id: 'session-1', path: '/sessions/one.jsonl', cwd: '/workspace', firstMessage: 'Research competitors', created: new Date(100), modified: new Date(200), messageCount: 7 }])
    mocks.getMessages.mockResolvedValue({ items: [{ type: 'file', path: '/workspace/report.md' }, { type: 'assistant-message', usage: { input: 100, output: 20, cacheRead: 40, cost: { total: 0.02 } } }, { type: 'tool-call', toolName: 'read' }], totalCount: 3 })
    registerAgentRunHandlers()
  })

  it('joins immutable Agent binding, local session, artifacts and case evidence', async () => {
    const result = await mocks.handlers.get('ipc:agentRun.list')!({ profileId: '7c2f6716-82a0-49d4-aa18-78b26d698ff5', workspacePath: '/workspace' }) as { runs: Array<Record<string, unknown>> }
    expect(result.runs[0]).toMatchObject({ sessionId: 'session-1', versionNumber: 2, status: 'completed', messageCount: 7, caseId: 'case-1', runtimeEvidence: { runId: 'run-1', resourceEvidence: { activeTools: [{ name: 'read' }] } }, turns: [{ runId: 'run-1', status: 'completed' }] })
    expect(result.runs[0].artifacts).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'case', name: 'Saved run' }),
      expect.objectContaining({ kind: 'file', path: '/workspace/report.md' }),
    ]))
    expect(result.runs[0].observability).toMatchObject({ completeTimeline: true, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cost: 0.02 }, tools: { totalCalls: 1 } })
  })

  it('surfaces live and failed run state from authoritative runtime and timeline evidence', async () => {
    mocks.listRuntime.mockReturnValue([{ sessionFile: '/sessions/one.jsonl', running: true, cwd: '/workspace' }])
    mocks.getMessages.mockResolvedValue({ items: [{ type: 'agent_error', text: 'Provider quota reached' }], totalCount: 7 })
    let result = await mocks.handlers.get('ipc:agentRun.list')!({ profileId: '7c2f6716-82a0-49d4-aa18-78b26d698ff5', workspacePath: '/workspace' }) as { runs: Array<Record<string, unknown>> }
    expect(result.runs[0].status).toBe('running')
    mocks.listRuntime.mockReturnValue([])
    result = await mocks.handlers.get('ipc:agentRun.list')!({ profileId: '7c2f6716-82a0-49d4-aa18-78b26d698ff5', workspacePath: '/workspace' }) as { runs: Array<Record<string, unknown>> }
    expect(result.runs[0]).toMatchObject({ status: 'failed', failureReason: 'Provider quota reached' })
  })
})
