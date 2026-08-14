import { describe, expect, it } from 'vitest'
import type { AgentEvaluationRun } from './agent-evaluation'
import {
  compareAgentEvaluationRuns,
  normalizeEvaluationPrompt,
  summarizeAgentEvaluationRuns,
} from './agent-evaluation-metrics'

function run(overrides: Partial<AgentEvaluationRun> = {}): AgentEvaluationRun {
  return {
    id: 'run-1',
    suiteId: 'suite-1',
    scenarioId: 'scenario-1',
    sourceCaseId: 'case-1',
    verdict: 'pending',
    createdAt: 1,
    updatedAt: 1,
    evidence: {
      capturedAt: 1,
      piRuntimeVersion: '0.84.1',
      sourceSessionId: 'session-1',
      sourceSessionFile: '/sessions/one.jsonl',
      actualPrompt: 'Write a report',
      promptMatched: true,
      outputText: 'Done',
      metrics: {
        durationMs: 1_000,
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0.01,
        toolCalls: 2,
        failedToolCalls: 0,
        assistantMessages: 1,
      },
    },
    ...overrides,
  }
}

describe('agent evaluation metrics', () => {
  it('normalizes harmless prompt whitespace without changing content', () => {
    expect(normalizeEvaluationPrompt('  Write\r\n\n a   report  ')).toBe('Write a report')
  })

  it('summarizes human verdicts and real Pi metrics', () => {
    const summary = summarizeAgentEvaluationRuns([
      run({ verdict: 'passed' }),
      run({ id: 'run-2', verdict: 'failed', evidence: {
        ...run().evidence,
        metrics: { ...run().evidence.metrics, durationMs: 3_000, toolCalls: 4, failedToolCalls: 1 },
      } }),
    ])
    expect(summary).toEqual({
      total: 2,
      passed: 1,
      failed: 1,
      pending: 0,
      passRate: 0.5,
      averageDurationMs: 2_000,
      totalToolCalls: 6,
      failedToolCalls: 1,
      totalInputTokens: 200,
      totalOutputTokens: 100,
      totalCost: 0.02,
    })
  })

  it('compares two observations without pretending to judge quality', () => {
    const comparison = compareAgentEvaluationRuns(
      run(),
      run({ id: 'run-2', evidence: {
        ...run().evidence,
        metrics: { ...run().evidence.metrics, durationMs: 800, outputTokens: 40, toolCalls: 1 },
      } }),
    )
    expect(comparison).toMatchObject({
      durationMs: -200,
      outputTokens: -10,
      toolCalls: -1,
    })
  })
})
