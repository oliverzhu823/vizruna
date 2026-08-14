import { resolve } from 'node:path'
import type {
  AgentEvaluationRun,
  AgentEvaluationSuiteBundle,
} from '@shared/agent-evaluation'
import { compareAgentEvaluationSuites } from '@shared/agent-evaluation-comparison'
import type {
  AgentVersion,
  AgentVersionGateBlocker,
  AgentVersionGateScenario,
  AgentVersionValidationGate,
} from '@shared/agent-version'
import { auditRepository } from '../../audit/audit-repository'
import {
  migrateAgentVersions,
  requireAgentVersion,
  validateAgentVersion,
} from '../../agent-version-service'
import { sqliteIndex } from '../../sqlite-index'
import { getTrustedWorkspaceRoot } from '../../trusted-workspace'
import { registerHandlerWithSchema } from '../registry'
import {
  agentVersionListSchema,
  agentVersionReadinessSchema,
  agentVersionValidateSchema,
} from '../schemas'

function assertTrustedWorkspace(workspacePath: string): void {
  const trusted = getTrustedWorkspaceRoot()
  if (!trusted || resolve(trusted) !== resolve(workspacePath)) {
    throw new Error('Agent versions can only change in the active trusted workspace')
  }
}

function runMatchesVersion(run: AgentEvaluationRun, version: AgentVersion): boolean {
  const agent = run.evidence.agent
  if (!agent) return false
  return agent.versionId
    ? agent.versionId === version.id
    : agent.snapshotDigest === version.digest
}

export function buildAgentVersionValidationGate(input: {
  version: AgentVersion
  candidate: AgentEvaluationSuiteBundle
  baselineRequired?: boolean
  baselineVersionId?: string
  baseline?: AgentEvaluationSuiteBundle
}): AgentVersionValidationGate {
  const scenarios: AgentVersionGateScenario[] = input.candidate.scenarios.map((scenario) => {
    let run: AgentEvaluationRun | undefined
    for (const candidate of input.candidate.runs) {
      if (candidate.scenarioId !== scenario.id || !runMatchesVersion(candidate, input.version)) continue
      if (!run || candidate.createdAt > run.createdAt) run = candidate
    }
    return {
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      runId: run?.id,
      verdict: run?.verdict,
      promptMatched: run?.evidence.promptMatched,
    }
  })
  const blockers = new Set<AgentVersionGateBlocker>()
  if (scenarios.length === 0) blockers.add('no-scenarios')
  for (const scenario of scenarios) {
    if (!scenario.runId) blockers.add('run-missing')
    else if (scenario.verdict === 'pending') blockers.add('review-pending')
    else if (scenario.verdict === 'failed') blockers.add('task-failed')
    if (scenario.runId && scenario.promptMatched !== true) blockers.add('prompt-drifted')
  }

  let comparisonOutcome: AgentVersionValidationGate['comparisonOutcome']
  if (input.baselineRequired) {
    if (!input.candidate.suite.baselineSuiteId) {
      blockers.add('baseline-required')
    } else if (!input.baseline) {
      blockers.add('baseline-suite-missing')
    } else if (input.baseline.suite.versionId !== input.baselineVersionId) {
      blockers.add('baseline-version-mismatch')
    } else {
      comparisonOutcome = compareAgentEvaluationSuites(input.baseline, input.candidate).outcome
      if (comparisonOutcome === 'insufficient') blockers.add('comparison-insufficient')
      if (comparisonOutcome === 'regressed') blockers.add('comparison-regressed')
      if (comparisonOutcome === 'mixed') blockers.add('comparison-mixed')
    }
  }
  return {
    eligible: blockers.size === 0,
    suiteId: input.candidate.suite.id,
    versionId: input.version.id,
    scenarios,
    blockers: [...blockers],
    baselineRequired: input.baselineRequired === true,
    baselineVersionId: input.baselineVersionId,
    baselineSuiteId: input.candidate.suite.baselineSuiteId,
    comparisonOutcome,
  }
}

function bundleForSuite(suiteId: string): AgentEvaluationSuiteBundle | undefined {
  const suite = sqliteIndex.getAgentEvaluationSuite(suiteId)
  if (!suite) return undefined
  return {
    suite,
    scenarios: sqliteIndex.listAgentEvaluationScenarios(suite.id),
    runs: sqliteIndex.listAgentEvaluationRuns(suite.id),
  }
}

export function latestValidatedBaseline(
  versions: AgentVersion[],
  candidate: AgentVersion,
): AgentVersion | undefined {
  return versions
    .filter((item) => item.number < candidate.number && item.status !== 'candidate')
    .sort((left, right) => right.number - left.number)[0]
}

function readinessFor(version: AgentVersion, suiteId: string): AgentVersionValidationGate {
  const candidate = bundleForSuite(suiteId)
  if (!candidate) throw new Error('Agent evaluation suite not found')
  if (candidate.suite.profileId !== version.profileId || candidate.suite.versionId !== version.id) {
    throw new Error('Evaluation suite does not target this Agent version')
  }
  const baselineVersion = latestValidatedBaseline(
    sqliteIndex.listAgentVersions(version.profileId),
    version,
  )
  const baseline = candidate.suite.baselineSuiteId
    ? bundleForSuite(candidate.suite.baselineSuiteId)
    : undefined
  return buildAgentVersionValidationGate({
    version,
    candidate,
    baselineRequired: Boolean(baselineVersion),
    baselineVersionId: baselineVersion?.id,
    baseline,
  })
}

export function registerAgentVersionHandlers(): void {
  migrateAgentVersions()

  registerHandlerWithSchema('ipc:agentVersion.list', agentVersionListSchema, async (request) => ({
    versions: sqliteIndex.listAgentVersions(request.profileId),
  }))

  registerHandlerWithSchema(
    'ipc:agentVersion.readiness',
    agentVersionReadinessSchema,
    async (request) => {
      const version = requireAgentVersion(request.versionId)
      const suite = sqliteIndex.getAgentEvaluationSuite(request.suiteId)
      if (!suite) throw new Error('Agent evaluation suite not found')
      assertTrustedWorkspace(suite.workspacePath)
      if (suite.status === 'archived') throw new Error('Archived evaluation suite is read-only')
      return { gate: readinessFor(version, suite.id) }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentVersion.validate',
    agentVersionValidateSchema,
    async (request) => {
      const version = requireAgentVersion(request.versionId)
      const suite = sqliteIndex.getAgentEvaluationSuite(request.suiteId)
      if (!suite) throw new Error('Agent evaluation suite not found')
      assertTrustedWorkspace(suite.workspacePath)
      if (suite.status === 'archived') throw new Error('Archived evaluation suite is read-only')
      const gate = readinessFor(version, suite.id)
      if (!gate.eligible) {
        throw new Error(`Agent version is not ready for validation: ${gate.blockers.join(', ')}`)
      }
      const next = validateAgentVersion(version, {
        suiteId: suite.id,
        runIds: gate.scenarios.flatMap((scenario) => scenario.runId ? [scenario.runId] : []),
        validatedAt: Date.now(),
        baselineVersionId: gate.baselineVersionId,
        baselineSuiteId: gate.baselineSuiteId,
        comparisonOutcome: gate.comparisonOutcome === 'improved' || gate.comparisonOutcome === 'equivalent'
          ? gate.comparisonOutcome
          : undefined,
      })
      auditRepository.write({
        category: 'operation',
        action: 'agent-version.validate',
        outcome: 'success',
        workspaceId: suite.workspacePath,
        details: {
          profileId: next.profileId,
          versionId: next.id,
          versionNumber: next.number,
          suiteId: suite.id,
          comparisonOutcome: gate.comparisonOutcome,
          baselineVersionId: gate.baselineVersionId,
        },
      })
      return { version: next, gate }
    },
  )
}

export const agentVersionHandlerTestApi = {
  runMatchesVersion,
}
