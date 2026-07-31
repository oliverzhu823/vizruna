import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCase } from '@shared/agent-case'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (request: Record<string, unknown>) => Promise<unknown>>()
  return {
    handlers,
    trustedWorkspace: '/workspace',
    sqliteIndex: {
      listAgentCases: vi.fn(() => []),
      getAgentCase: vi.fn(),
      saveAgentCase: vi.fn(() => true),
    },
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

vi.mock('../../trusted-workspace', () => ({
  getTrustedWorkspaceRoot: () => mocks.trustedWorkspace,
}))

vi.mock('../../sqlite-index', () => ({ sqliteIndex: mocks.sqliteIndex }))
vi.mock('../../audit/audit-repository', () => ({
  auditRepository: { write: mocks.auditWrite },
}))

import { registerAgentCaseHandlers } from './agent-case'

const existingCase: AgentCase = {
  id: '7c2f6716-82a0-49d4-aa18-78b26d698ff5',
  name: 'Research Agent',
  tags: ['research'],
  status: 'draft',
  workspacePath: '/workspace',
  sourceSessionId: 'session-1',
  sourceSessionFile: '/sessions/session-1.jsonl',
  modelId: 'openai-codex/gpt-5.6-sol',
  thinkingLevel: 'high',
  createdAt: 100,
  updatedAt: 100,
}

describe('Agent Case IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.trustedWorkspace = '/workspace'
    mocks.sqliteIndex.getAgentCase.mockReturnValue(existingCase)
    mocks.sqliteIndex.saveAgentCase.mockReturnValue(true)
    registerAgentCaseHandlers()
  })

  it('creates a draft linked to the active trusted conversation', async () => {
    const handler = mocks.handlers.get('ipc:agentCase.create')!
    const response = (await handler({
      name: ' Research Agent ',
      tags: ['research', 'research', 'report'],
      workspacePath: '/workspace',
      sourceSessionId: 'session-1',
      sourceSessionFile: '/sessions/session-1.jsonl',
      modelId: 'openai-codex/gpt-5.6-sol',
      thinkingLevel: 'high',
    })) as { agentCase: AgentCase }

    expect(response.agentCase).toMatchObject({
      name: 'Research Agent',
      tags: ['research', 'report'],
      status: 'draft',
      workspacePath: '/workspace',
      sourceSessionId: 'session-1',
    })
    expect(response.agentCase.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(mocks.sqliteIndex.saveAgentCase).toHaveBeenCalledWith(response.agentCase)
    expect(mocks.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent-case.create', outcome: 'success' }),
    )
  })

  it('blocks a case forged from a workspace other than the active trusted one', async () => {
    const handler = mocks.handlers.get('ipc:agentCase.create')!
    await expect(
      handler({
        name: 'Other project',
        workspacePath: '/other',
        sourceSessionId: 'session-2',
        sourceSessionFile: '/sessions/session-2.jsonl',
      }),
    ).rejects.toThrow('active trusted workspace')
    expect(mocks.sqliteIndex.saveAgentCase).not.toHaveBeenCalled()
  })

  it('updates validation state without changing the source link', async () => {
    const handler = mocks.handlers.get('ipc:agentCase.update')!
    const response = (await handler({ id: existingCase.id, status: 'validated' })) as {
      agentCase: AgentCase
    }

    expect(response.agentCase).toMatchObject({
      id: existingCase.id,
      status: 'validated',
      workspacePath: existingCase.workspacePath,
      sourceSessionFile: existingCase.sourceSessionFile,
    })
  })

  it('archives without deleting the case', async () => {
    const handler = mocks.handlers.get('ipc:agentCase.archive')!
    const response = (await handler({ id: existingCase.id })) as { agentCase: AgentCase }

    expect(response.agentCase.status).toBe('archived')
    expect(mocks.sqliteIndex.saveAgentCase).toHaveBeenCalledOnce()
    expect(mocks.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent-case.archive', outcome: 'success' }),
    )
  })
})
