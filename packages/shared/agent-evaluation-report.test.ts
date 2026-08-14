import { describe, expect, it } from 'vitest'
import type { AgentEvaluationRun, AgentEvaluationSuiteBundle } from './agent-evaluation'
import { compareAgentEvaluationSuites } from './agent-evaluation-comparison'
import { buildAgentEvaluationMarkdownReport } from './agent-evaluation-report'
import type { AgentVersion } from './agent-version'

function bundle(id: string, versionId: string, verdict: 'passed' | 'failed', output: string): AgentEvaluationSuiteBundle {
  const scenarioId = `${id}-scenario`
  const run: AgentEvaluationRun = {
    id: `${id}-run`, suiteId: id, scenarioId, sourceCaseId: `${id}-case`, verdict, createdAt: 2, updatedAt: 2,
    evidence: {
      capturedAt: 2, piRuntimeVersion: '0.84.1', sourceSessionId: `${id}-session`, sourceSessionFile: `/secret/${id}.jsonl`,
      actualPrompt: 'Confidential task input', promptMatched: true, outputText: output, modelId: 'provider/model',
      metrics: { durationMs: 1_000, inputTokens: 100, outputTokens: 50, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.01, toolCalls: 1, failedToolCalls: 0, assistantMessages: 1 },
    },
  }
  return {
    suite: { id, name: `${id} suite`, workspacePath: '/workspace', profileId: 'profile', versionId, status: 'active', createdAt: 1, updatedAt: 2 },
    scenarios: [{ id: scenarioId, suiteId: id, name: 'Research report', prompt: 'Confidential task input', expectedOutcome: 'Private acceptance rule', tags: [], sortOrder: 0, createdAt: 1, updatedAt: 1 }],
    runs: [run],
  }
}

function version(id: string, number: number, prompt: string): AgentVersion {
  return { id, profileId: 'profile', number, digest: id.repeat(32).slice(0, 64), status: 'candidate', createdAt: 1, config: { name: 'Research Agent', systemPrompt: prompt, promptMode: 'append' } }
}

describe('Agent evaluation Markdown report', () => {
  const baseline = bundle('baseline', 'a', 'failed', 'Private baseline output')
  const candidate = bundle('candidate', 'b', 'passed', 'Private candidate output')
  const comparison = compareAgentEvaluationSuites(baseline, candidate)
  const common = {
    baseline, candidate, comparison,
    profile: { id: 'profile', name: 'Research Agent', systemPrompt: 'LATEST SECRET PROMPT', promptMode: 'append' as const, status: 'active' as const, createdAt: 1, updatedAt: 2 },
    baselineVersion: version('a', 1, 'BASELINE SECRET PROMPT'),
    candidateVersion: version('b', 2, 'CANDIDATE SECRET PROMPT'),
    locale: 'en' as const,
    generatedAt: 1,
  }

  it('keeps shareable summaries free of authored content and local session paths', () => {
    const report = buildAgentEvaluationMarkdownReport({ ...common, includeContent: false })
    expect(report).toContain('Candidate improved')
    expect(report).toContain('| systemPrompt |')
    expect(report).not.toContain('SECRET PROMPT')
    expect(report).not.toContain('Confidential task input')
    expect(report).not.toContain('Private candidate output')
    expect(report).not.toContain('/secret/')
  })

  it('includes task content only after explicit opt-in while still excluding System Prompts', () => {
    const report = buildAgentEvaluationMarkdownReport({ ...common, includeContent: true })
    expect(report).toContain('Confidential task input')
    expect(report).toContain('Private acceptance rule')
    expect(report).toContain('Private baseline output')
    expect(report).toContain('Private candidate output')
    expect(report).not.toContain('SECRET PROMPT')
    expect(report).not.toContain('/secret/')
  })
})
