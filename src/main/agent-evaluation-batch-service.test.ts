import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvaluationBatch, AgentEvaluationSuite } from '@shared/agent-evaluation'

const mocks = vi.hoisted(() => {
  const batches = new Map<string, AgentEvaluationBatch>()
  return {
    batches,
    scenarios: [{
      id: 'scenario-1',
      suiteId: 'suite-1',
      name: 'Evidence report',
      prompt: 'Produce evidence',
      tags: [],
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
    }],
    saveRun: vi.fn(() => true),
    createSession: vi.fn(),
    prompt: vi.fn(),
    getState: vi.fn(),
    stop: vi.fn(),
    abort: vi.fn(),
    configure: vi.fn(),
    saveBinding: vi.fn(),
    capture: vi.fn(),
  }
})

vi.mock('./sqlite-index', () => ({
  sqliteIndex: {
    saveAgentEvaluationBatch: vi.fn((batch: AgentEvaluationBatch) => {
      mocks.batches.set(batch.id, structuredClone(batch))
      return true
    }),
    getAgentEvaluationBatch: vi.fn((id: string) => mocks.batches.get(id) ?? null),
    getLatestAgentEvaluationBatch: vi.fn((suiteId: string) => [...mocks.batches.values()].filter((item) => item.suiteId === suiteId).at(-1) ?? null),
    listAgentEvaluationScenarios: vi.fn(() => mocks.scenarios),
    saveAgentEvaluationRun: mocks.saveRun,
  },
}))
vi.mock('./agent-version-service', () => ({ requireAgentVersion: vi.fn(() => ({ id: 'version-1', profileId: 'profile-1' })) }))
vi.mock('./system-prompt-preset-service', () => ({
  resolveConversationConfigSnapshot: vi.fn(async () => ({
    profileId: 'profile-1',
    name: 'Research Agent',
    versionId: 'version-1',
    versionNumber: 1,
    modelId: 'openai-codex/gpt-5.3-codex',
    thinkingLevel: 'high',
    capturedAt: 1,
  })),
  saveConversationConfigBinding: mocks.saveBinding,
}))
vi.mock('./agent-evaluation-evidence', () => ({ captureAgentEvaluationSessionEvidence: mocks.capture }))
vi.mock('./worker-manager', () => ({
  workerManager: {
    createConfiguredBackgroundSession: mocks.createSession,
    promptBackgroundSession: mocks.prompt,
    getState: mocks.getState,
    stopBackgroundSession: mocks.stop,
    abortBackgroundSession: mocks.abort,
    configureBackgroundSession: mocks.configure,
  },
}))
vi.mock('./audit/audit-repository', () => ({ auditRepository: { write: vi.fn() } }))

import { cancelAgentEvaluationBatch, getAgentEvaluationBatch, startAgentEvaluationBatch } from './agent-evaluation-batch-service'

const suite: AgentEvaluationSuite = {
  id: 'suite-1',
  name: 'Regression',
  workspacePath: '/workspace',
  profileId: 'profile-1',
  versionId: 'version-1',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}

async function waitForTerminal(id: string): Promise<AgentEvaluationBatch> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const batch = getAgentEvaluationBatch(id)
    if (batch.status !== 'queued' && batch.status !== 'running') return batch
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
  throw new Error('batch did not finish')
}

describe('agent evaluation batch service', () => {
  beforeEach(() => {
    mocks.batches.clear()
    vi.clearAllMocks()
    mocks.createSession.mockResolvedValue({ sessionId: 'session-1', sessionFile: '/tmp/session.jsonl' })
    mocks.prompt.mockResolvedValue(undefined)
    mocks.stop.mockResolvedValue(undefined)
    mocks.abort.mockResolvedValue(undefined)
    mocks.configure.mockResolvedValue(undefined)
    mocks.getState.mockResolvedValueOnce({ isStreaming: true }).mockResolvedValue({ isStreaming: false })
    mocks.capture.mockResolvedValue({
      sourceSessionId: 'session-1',
      sourceSessionFile: '/tmp/session.jsonl',
      promptMatched: true,
      agent: { versionId: 'version-1' },
      metrics: {},
    })
  })

  it('runs fixed tasks in an isolated configured Pi session and persists evidence', async () => {
    const started = startAgentEvaluationBatch(suite)
    const completed = await waitForTerminal(started.id)

    expect(completed.status).toBe('completed')
    expect(completed.items[0]).toMatchObject({ status: 'completed', sessionId: 'session-1' })
    expect(mocks.createSession).toHaveBeenCalledWith('/workspace', expect.objectContaining({ versionId: 'version-1' }))
    expect(mocks.prompt).toHaveBeenCalledWith('/tmp/session.jsonl', 'Produce evidence')
    expect(mocks.configure).toHaveBeenCalledWith('/tmp/session.jsonl', {
      model: 'openai-codex/gpt-5.3-codex',
      thinkingLevel: 'high',
    })
    expect(mocks.saveRun).toHaveBeenCalledWith(expect.objectContaining({
      suiteId: 'suite-1',
      scenarioId: 'scenario-1',
      sourceCaseId: `batch:${started.id}`,
      verdict: 'pending',
    }))
    expect(mocks.stop).toHaveBeenCalledWith('/tmp/session.jsonl')
  })

  it('isolates one task failure and records an honest failed item', async () => {
    mocks.createSession.mockRejectedValueOnce(new Error('provider unavailable'))
    const started = startAgentEvaluationBatch(suite)
    const completed = await waitForTerminal(started.id)

    expect(completed.status).toBe('completed')
    expect(completed.items[0]).toMatchObject({ status: 'failed', error: 'provider unavailable' })
    expect(mocks.saveRun).not.toHaveBeenCalled()
  })

  it('can cancel the active Pi turn', async () => {
    mocks.getState.mockReset()
    mocks.getState.mockResolvedValue({ isStreaming: true })
    const started = startAgentEvaluationBatch(suite)
    for (let attempt = 0; attempt < 50 && !mocks.prompt.mock.calls.length; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 5))
    }
    await cancelAgentEvaluationBatch(started.id)
    const completed = await waitForTerminal(started.id)

    expect(mocks.abort).toHaveBeenCalledWith('/tmp/session.jsonl')
    expect(completed.status).toBe('cancelled')
    expect(completed.items[0].status).toBe('cancelled')
  })
})
