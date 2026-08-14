import { describe, expect, it } from 'vitest'
import type {
  AgentEvaluationRun,
  AgentEvaluationScenario,
  AgentEvaluationSuiteBundle,
  AgentEvaluationVerdict,
} from './agent-evaluation'
import {
  compareAgentEvaluationSuites,
  evaluationScenarioKey,
} from './agent-evaluation-comparison'

function scenario(id: string, suiteId: string, prompt = 'Write a report'): AgentEvaluationScenario {
  return {
    id,
    suiteId,
    name: 'Report',
    prompt,
    expectedOutcome: 'Accurate and sourced',
    tags: ['research'],
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
  }
}

function run(
  id: string,
  suiteId: string,
  scenarioId: string,
  verdict: AgentEvaluationVerdict,
  overrides: Partial<AgentEvaluationRun['evidence']['metrics']> = {},
): AgentEvaluationRun {
  return {
    id,
    suiteId,
    scenarioId,
    sourceCaseId: `case-${id}`,
    verdict,
    createdAt: Number(id.replace(/\D/g, '')) || 1,
    updatedAt: 1,
    evidence: {
      capturedAt: 1,
      piRuntimeVersion: '0.84.1',
      sourceSessionId: `session-${id}`,
      sourceSessionFile: `/sessions/${id}.jsonl`,
      actualPrompt: 'Write a report',
      promptMatched: true,
      outputText: 'Done',
      modelId: 'provider/model',
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
        ...overrides,
      },
    },
  }
}

function bundle(
  id: string,
  versionId: string,
  scenarios: AgentEvaluationScenario[],
  runs: AgentEvaluationRun[],
): AgentEvaluationSuiteBundle {
  return {
    suite: {
      id,
      name: id,
      workspacePath: '/workspace',
      profileId: 'profile-1',
      versionId,
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
    scenarios,
    runs,
  }
}

describe('Agent evaluation version comparison', () => {
  it('matches cloned scenarios by authored content instead of database ids', () => {
    expect(evaluationScenarioKey(scenario('before', 'suite-1'))).toBe(
      evaluationScenarioKey(scenario('after', 'suite-2', '  Write   a report ')),
    )
  })

  it('reports a human-reviewed quality improvement and metric deltas', () => {
    const beforeScenario = scenario('before', 'baseline')
    const afterScenario = scenario('after', 'candidate')
    const comparison = compareAgentEvaluationSuites(
      bundle('baseline', 'version-1', [beforeScenario], [
        run('run-1', 'baseline', beforeScenario.id, 'failed'),
      ]),
      bundle('candidate', 'version-2', [afterScenario], [
        run('run-2', 'candidate', afterScenario.id, 'passed', {
          durationMs: 800,
          inputTokens: 90,
          cost: 0.008,
        }),
      ]),
    )
    expect(comparison.outcome).toBe('improved')
    expect(comparison.counts.improved).toBe(1)
    expect(comparison.delta).toMatchObject({
      passRatePoints: 100,
      averageDurationMs: -200,
      inputTokens: -10,
    })
    expect(comparison.delta.cost).toBeCloseTo(-0.002)
  })

  it('uses only the latest run for each fixed task', () => {
    const beforeScenario = scenario('before', 'baseline')
    const afterScenario = scenario('after', 'candidate')
    const comparison = compareAgentEvaluationSuites(
      bundle('baseline', 'version-1', [beforeScenario], [
        run('run-1', 'baseline', beforeScenario.id, 'passed'),
      ]),
      bundle('candidate', 'version-2', [afterScenario], [
        run('run-2', 'candidate', afterScenario.id, 'failed'),
        run('run-3', 'candidate', afterScenario.id, 'passed'),
      ]),
    )
    expect(comparison.outcome).toBe('equivalent')
    expect(comparison.scenarios[0]?.candidateRun?.id).toBe('run-3')
  })

  it('refuses to claim improvement when review or matching evidence is incomplete', () => {
    const beforeScenario = scenario('before', 'baseline')
    const afterScenario = scenario('after', 'candidate')
    const pending = run('run-2', 'candidate', afterScenario.id, 'pending')
    pending.evidence.promptMatched = false
    const comparison = compareAgentEvaluationSuites(
      bundle('baseline', 'version-1', [beforeScenario], [
        run('run-1', 'baseline', beforeScenario.id, 'failed'),
      ]),
      bundle('candidate', 'version-2', [afterScenario], [pending]),
    )
    expect(comparison.outcome).toBe('insufficient')
    expect(comparison.scenarios[0]?.reasons).toEqual([
      'review-pending',
      'prompt-drifted',
    ])
  })

  it('reports mixed results when one task improves and another regresses', () => {
    const beforeA = scenario('before-a', 'baseline', 'Task A')
    const beforeB = scenario('before-b', 'baseline', 'Task B')
    const afterA = scenario('after-a', 'candidate', 'Task A')
    const afterB = scenario('after-b', 'candidate', 'Task B')
    const comparison = compareAgentEvaluationSuites(
      bundle('baseline', 'version-1', [beforeA, beforeB], [
        run('run-1', 'baseline', beforeA.id, 'failed'),
        run('run-2', 'baseline', beforeB.id, 'passed'),
      ]),
      bundle('candidate', 'version-2', [afterA, afterB], [
        run('run-3', 'candidate', afterA.id, 'passed'),
        run('run-4', 'candidate', afterB.id, 'failed'),
      ]),
    )
    expect(comparison.outcome).toBe('mixed')
    expect(comparison.counts).toMatchObject({ improved: 1, regressed: 1 })
  })
})
