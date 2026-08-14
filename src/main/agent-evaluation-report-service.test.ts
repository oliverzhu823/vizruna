import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvaluationRun, AgentEvaluationSuiteBundle } from '@shared/agent-evaluation'

const mocks = vi.hoisted(() => ({
  bundles: new Map<string, AgentEvaluationSuiteBundle>(),
  audit: vi.fn(),
}))

vi.mock('./sqlite-index', () => ({
  sqliteIndex: {
    getAgentEvaluationSuite: vi.fn((id: string) => mocks.bundles.get(id)?.suite ?? null),
    listAgentEvaluationScenarios: vi.fn((id: string) => mocks.bundles.get(id)?.scenarios ?? []),
    listAgentEvaluationRuns: vi.fn((id: string) => mocks.bundles.get(id)?.runs ?? []),
    getAgentProfile: vi.fn(() => ({ id: 'profile', name: 'Research / Agent', systemPrompt: 'secret', promptMode: 'append', status: 'active', createdAt: 1, updatedAt: 1 })),
  },
}))
vi.mock('./agent-version-service', () => ({
  requireAgentVersion: vi.fn((id: string) => ({ id, profileId: 'profile', number: id === 'v1' ? 1 : 2, digest: id.repeat(32), status: 'candidate', createdAt: 1, config: { name: 'Research Agent', systemPrompt: 'secret', promptMode: 'append' } })),
}))
vi.mock('./audit/audit-repository', () => ({ auditRepository: { write: mocks.audit } }))

import { exportAgentEvaluationReport } from './agent-evaluation-report-service'

function bundle(id: string, versionId: string, verdict: 'failed' | 'passed'): AgentEvaluationSuiteBundle {
  const scenarioId = `${id}-scenario`
  const run: AgentEvaluationRun = {
    id: `${id}-run`, suiteId: id, scenarioId, sourceCaseId: 'case', verdict, createdAt: 1, updatedAt: 1,
    evidence: { capturedAt: 1, piRuntimeVersion: '0.84.1', sourceSessionId: 'session', sourceSessionFile: '/private/session.jsonl', actualPrompt: 'Task', promptMatched: true, outputText: 'Output', metrics: { durationMs: 1, inputTokens: 1, outputTokens: 1, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, toolCalls: 0, failedToolCalls: 0, assistantMessages: 1 } },
  }
  return { suite: { id, name: id, workspacePath: '/workspace', profileId: 'profile', versionId, status: 'active', createdAt: 1, updatedAt: 1 }, scenarios: [{ id: scenarioId, suiteId: id, name: 'Task', prompt: 'Task', tags: [], sortOrder: 0, createdAt: 1, updatedAt: 1 }], runs: [run] }
}

describe('agent evaluation report export', () => {
  beforeEach(() => {
    mocks.bundles.clear()
    mocks.bundles.set('baseline', bundle('baseline', 'v1', 'failed'))
    mocks.bundles.set('candidate', bundle('candidate', 'v2', 'passed'))
    vi.clearAllMocks()
  })

  it('returns a bounded browser-native Markdown download and audits its privacy mode', () => {
    const result = exportAgentEvaluationReport({ baselineSuiteId: 'baseline', candidateSuiteId: 'candidate', locale: 'zh' })
    expect(result.outcome).toBe('improved')
    expect(result.download.filename).toMatch(/^Research-Agent-v1-to-v2-\d{4}-\d{2}-\d{2}\.md$/)
    expect(result.download.mimeType).toBe('text/markdown;charset=utf-8')
    expect(Buffer.from(result.download.base64, 'base64').toString('utf8')).toContain('新版进步')
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'agent-evaluation.report.export',
      details: expect.objectContaining({ includeContent: false, outcome: 'improved' }),
    }))
  })
})
