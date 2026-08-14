import type {
  AgentEvaluationComparisonDelta,
  AgentEvaluationComparisonOutcome,
  AgentEvaluationRun,
  AgentEvaluationRunDigest,
  AgentEvaluationScenario,
  AgentEvaluationScenarioComparison,
  AgentEvaluationSuiteBundle,
  AgentEvaluationVersionComparison,
} from './agent-evaluation'
import { normalizeEvaluationPrompt } from './agent-evaluation-metrics'

function normalizeOptional(value?: string): string {
  return normalizeEvaluationPrompt(value || '')
}

/** Stable identity for the user-authored task, independent of database ids. */
export function evaluationScenarioKey(scenario: AgentEvaluationScenario): string {
  return JSON.stringify([
    normalizeEvaluationPrompt(scenario.name),
    normalizeEvaluationPrompt(scenario.prompt),
    normalizeOptional(scenario.expectedOutcome),
    [...new Set(scenario.tags.map((tag) => tag.trim()).filter(Boolean))].sort(),
  ])
}

function latestRun(runs: AgentEvaluationRun[], scenarioId: string): AgentEvaluationRun | undefined {
  let latest: AgentEvaluationRun | undefined
  for (const run of runs) {
    if (run.scenarioId !== scenarioId) continue
    if (!latest || run.createdAt > latest.createdAt) latest = run
  }
  return latest
}

function digest(run?: AgentEvaluationRun): AgentEvaluationRunDigest | undefined {
  if (!run) return undefined
  return {
    id: run.id,
    verdict: run.verdict,
    promptMatched: run.evidence.promptMatched,
    modelId: run.evidence.modelId,
    thinkingLevel: run.evidence.thinkingLevel,
    metrics: run.evidence.metrics,
    createdAt: run.createdAt,
  }
}

function compareScenario(input: {
  key: string
  baseline?: AgentEvaluationScenario
  candidate?: AgentEvaluationScenario
  baselineRuns: AgentEvaluationRun[]
  candidateRuns: AgentEvaluationRun[]
}): AgentEvaluationScenarioComparison {
  const baselineRun = input.baseline
    ? latestRun(input.baselineRuns, input.baseline.id)
    : undefined
  const candidateRun = input.candidate
    ? latestRun(input.candidateRuns, input.candidate.id)
    : undefined
  const reasons: AgentEvaluationScenarioComparison['reasons'] = []
  if (!input.baseline || !input.candidate) reasons.push('scenario-missing')
  if (input.baseline && !baselineRun || input.candidate && !candidateRun) reasons.push('run-missing')
  if (baselineRun?.verdict === 'pending' || candidateRun?.verdict === 'pending') {
    reasons.push('review-pending')
  }
  if (baselineRun?.evidence.promptMatched === false || candidateRun?.evidence.promptMatched === false) {
    reasons.push('prompt-drifted')
  }

  let outcome: AgentEvaluationScenarioComparison['outcome'] = 'insufficient'
  if (reasons.length === 0 && baselineRun && candidateRun) {
    if (baselineRun.verdict === 'failed' && candidateRun.verdict === 'passed') outcome = 'improved'
    else if (baselineRun.verdict === 'passed' && candidateRun.verdict === 'failed') outcome = 'regressed'
    else outcome = 'equivalent'
  }
  return {
    key: input.key,
    name: input.candidate?.name || input.baseline?.name || '',
    baselineScenarioId: input.baseline?.id,
    candidateScenarioId: input.candidate?.id,
    baselineRun: digest(baselineRun),
    candidateRun: digest(candidateRun),
    outcome,
    reasons,
  }
}

function average(values: number[]): number | null {
  if (values.length === 0) return null
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length)
}

function metricDelta(scenarios: AgentEvaluationScenarioComparison[]): {
  pairedRuns: number
  delta: AgentEvaluationComparisonDelta
} {
  let pairedRuns = 0
  let baselinePassed = 0
  let candidatePassed = 0
  let baselineDecided = 0
  let candidateDecided = 0
  const baselineDurations: number[] = []
  const candidateDurations: number[] = []
  const delta: AgentEvaluationComparisonDelta = {
    passRatePoints: null,
    averageDurationMs: null,
    inputTokens: 0,
    outputTokens: 0,
    cost: 0,
    toolCalls: 0,
    failedToolCalls: 0,
  }
  for (const scenario of scenarios) {
    const before = scenario.baselineRun
    const after = scenario.candidateRun
    if (!before || !after || !before.promptMatched || !after.promptMatched) continue
    pairedRuns += 1
    if (before.verdict !== 'pending') {
      baselineDecided += 1
      if (before.verdict === 'passed') baselinePassed += 1
    }
    if (after.verdict !== 'pending') {
      candidateDecided += 1
      if (after.verdict === 'passed') candidatePassed += 1
    }
    if (before.metrics.durationMs != null && after.metrics.durationMs != null) {
      baselineDurations.push(before.metrics.durationMs)
      candidateDurations.push(after.metrics.durationMs)
    }
    delta.inputTokens += after.metrics.inputTokens - before.metrics.inputTokens
    delta.outputTokens += after.metrics.outputTokens - before.metrics.outputTokens
    delta.cost += after.metrics.cost - before.metrics.cost
    delta.toolCalls += after.metrics.toolCalls - before.metrics.toolCalls
    delta.failedToolCalls += after.metrics.failedToolCalls - before.metrics.failedToolCalls
  }
  if (baselineDecided > 0 && candidateDecided > 0) {
    delta.passRatePoints = (candidatePassed / candidateDecided - baselinePassed / baselineDecided) * 100
  }
  const baselineAverage = average(baselineDurations)
  const candidateAverage = average(candidateDurations)
  if (baselineAverage != null && candidateAverage != null) {
    delta.averageDurationMs = candidateAverage - baselineAverage
  }
  return { pairedRuns, delta }
}

function overallOutcome(
  counts: AgentEvaluationVersionComparison['counts'],
): AgentEvaluationComparisonOutcome {
  if (counts.improved > 0 && counts.regressed > 0) return 'mixed'
  if (counts.regressed > 0) return 'regressed'
  if (counts.insufficient > 0) return 'insufficient'
  if (counts.improved > 0) return 'improved'
  if (counts.equivalent > 0) return 'equivalent'
  return 'insufficient'
}

export function compareAgentEvaluationSuites(
  baseline: AgentEvaluationSuiteBundle,
  candidate: AgentEvaluationSuiteBundle,
): AgentEvaluationVersionComparison {
  if (baseline.suite.profileId !== candidate.suite.profileId) {
    throw new Error('Evaluation suites must target the same Agent profile')
  }
  if (!baseline.suite.versionId || !candidate.suite.versionId) {
    throw new Error('Evaluation suites must target immutable Agent versions')
  }
  if (baseline.suite.versionId === candidate.suite.versionId) {
    throw new Error('Evaluation suites must target different Agent versions')
  }

  const baselineMap = new Map(baseline.scenarios.map((scenario) => [evaluationScenarioKey(scenario), scenario]))
  const candidateMap = new Map(candidate.scenarios.map((scenario) => [evaluationScenarioKey(scenario), scenario]))
  const keys = [...new Set([...baselineMap.keys(), ...candidateMap.keys()])]
  const scenarios = keys.map((key) => compareScenario({
    key,
    baseline: baselineMap.get(key),
    candidate: candidateMap.get(key),
    baselineRuns: baseline.runs,
    candidateRuns: candidate.runs,
  }))
  const counts: AgentEvaluationVersionComparison['counts'] = {
    improved: 0,
    equivalent: 0,
    regressed: 0,
    insufficient: 0,
  }
  for (const scenario of scenarios) counts[scenario.outcome] += 1
  const metrics = metricDelta(scenarios)
  return {
    baselineSuiteId: baseline.suite.id,
    candidateSuiteId: candidate.suite.id,
    baselineVersionId: baseline.suite.versionId,
    candidateVersionId: candidate.suite.versionId,
    outcome: overallOutcome(counts),
    counts,
    pairedRuns: metrics.pairedRuns,
    delta: metrics.delta,
    scenarios,
  }
}
