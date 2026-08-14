import type { AgentEvaluationRun } from './agent-evaluation'

export interface AgentEvaluationSummary {
  total: number
  passed: number
  failed: number
  pending: number
  passRate: number | null
  averageDurationMs: number | null
  totalToolCalls: number
  failedToolCalls: number
  totalInputTokens: number
  totalOutputTokens: number
  totalCost: number
}

export interface AgentEvaluationRunComparison {
  durationMs: number | null
  inputTokens: number
  outputTokens: number
  cost: number
  toolCalls: number
  failedToolCalls: number
}

export function normalizeEvaluationPrompt(value: string): string {
  return value.replace(/\s+/g, ' ').trim()
}

export function summarizeAgentEvaluationRuns(
  runs: AgentEvaluationRun[],
): AgentEvaluationSummary {
  let passed = 0
  let failed = 0
  let pending = 0
  let durationTotal = 0
  let durationCount = 0
  let totalToolCalls = 0
  let failedToolCalls = 0
  let totalInputTokens = 0
  let totalOutputTokens = 0
  let totalCost = 0
  for (const run of runs) {
    if (run.verdict === 'passed') passed += 1
    else if (run.verdict === 'failed') failed += 1
    else pending += 1
    const metrics = run.evidence.metrics
    if (metrics.durationMs != null) {
      durationTotal += metrics.durationMs
      durationCount += 1
    }
    totalToolCalls += metrics.toolCalls
    failedToolCalls += metrics.failedToolCalls
    totalInputTokens += metrics.inputTokens
    totalOutputTokens += metrics.outputTokens
    totalCost += metrics.cost
  }
  const decided = passed + failed
  return {
    total: runs.length,
    passed,
    failed,
    pending,
    passRate: decided > 0 ? passed / decided : null,
    averageDurationMs: durationCount > 0 ? Math.round(durationTotal / durationCount) : null,
    totalToolCalls,
    failedToolCalls,
    totalInputTokens,
    totalOutputTokens,
    totalCost,
  }
}

export function compareAgentEvaluationRuns(
  baseline: AgentEvaluationRun,
  candidate: AgentEvaluationRun,
): AgentEvaluationRunComparison {
  const before = baseline.evidence.metrics
  const after = candidate.evidence.metrics
  return {
    durationMs:
      before.durationMs == null || after.durationMs == null
        ? null
        : after.durationMs - before.durationMs,
    inputTokens: after.inputTokens - before.inputTokens,
    outputTokens: after.outputTokens - before.outputTokens,
    cost: after.cost - before.cost,
    toolCalls: after.toolCalls - before.toolCalls,
    failedToolCalls: after.failedToolCalls - before.failedToolCalls,
  }
}
