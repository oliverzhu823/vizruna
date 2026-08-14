import type { AgentCase } from './agent-case'
import type { AgentEvaluationSuiteBundle } from './agent-evaluation'
import type { AgentVersionValidationGate } from './agent-version'

export type AgentWorkspaceNextAction =
  | 'edit-agent'
  | 'create-evaluation'
  | 'add-scenarios'
  | 'run-evaluation'
  | 'review-runs'
  | 'fix-validation'
  | 'validate-version'
  | 'package'
  | 'run'

export interface AgentWorkspaceEvidence {
  cases: number
  reproducibleCases: number
  suites: number
  scenarios: number
  completedScenarios: number
  passedScenarios: number
  failedScenarios: number
  pendingReviewScenarios: number
  activeSuiteId?: string
  validationBlockers: AgentVersionValidationGate['blockers']
  validationEligible: boolean
  nextAction: AgentWorkspaceNextAction
}

export function buildAgentWorkspaceEvidence(input: {
  profileId: string
  latestVersionId?: string
  latestVersionStatus?: 'candidate' | 'validated' | 'released'
  packageAvailable: boolean
  cases: AgentCase[]
  suites: AgentEvaluationSuiteBundle[]
  gate?: AgentVersionValidationGate
}): AgentWorkspaceEvidence {
  const cases = input.cases.filter((item) => item.provenance?.agent?.profileId === input.profileId)
  const suites = input.suites.filter((item) => item.suite.profileId === input.profileId)
  const active = suites.find((item) => (
    item.suite.status === 'active' && item.suite.versionId === input.latestVersionId
  ))
  const latestRuns = new Map<string, AgentEvaluationSuiteBundle['runs'][number]>()
  for (const run of active?.runs ?? []) {
    const previous = latestRuns.get(run.scenarioId)
    if (!previous || run.updatedAt > previous.updatedAt) latestRuns.set(run.scenarioId, run)
  }
  const runs = [...latestRuns.values()]
  const scenarios = active?.scenarios.length ?? 0
  const validationBlockers = input.gate?.blockers ?? []

  let nextAction: AgentWorkspaceNextAction
  if (!input.latestVersionId || !input.latestVersionStatus) {
    nextAction = 'edit-agent'
  } else if (input.latestVersionStatus === 'candidate') {
    if (!active) nextAction = 'create-evaluation'
    else if (scenarios === 0) nextAction = 'add-scenarios'
    else if (runs.length < scenarios) nextAction = 'run-evaluation'
    else if (runs.some((run) => run.verdict === 'pending')) nextAction = 'review-runs'
    else if (input.gate?.eligible) nextAction = 'validate-version'
    else nextAction = 'fix-validation'
  } else if (!input.packageAvailable) {
    nextAction = 'package'
  } else {
    nextAction = 'run'
  }

  return {
    cases: cases.length,
    reproducibleCases: cases.filter((item) => item.lastVerification?.reproducible).length,
    suites: suites.length,
    scenarios,
    completedScenarios: runs.length,
    passedScenarios: runs.filter((run) => run.verdict === 'passed').length,
    failedScenarios: runs.filter((run) => run.verdict === 'failed').length,
    pendingReviewScenarios: runs.filter((run) => run.verdict === 'pending').length,
    activeSuiteId: active?.suite.id,
    validationBlockers,
    validationEligible: input.gate?.eligible ?? false,
    nextAction,
  }
}
