import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type {
  AgentEvaluationRun,
  AgentEvaluationScenario,
  AgentEvaluationSuite,
  AgentEvaluationSuiteBundle,
} from '@shared/agent-evaluation'
import { compareAgentEvaluationSuites } from '@shared/agent-evaluation-comparison'
import { auditRepository } from '../../audit/audit-repository'
import { captureAgentEvaluationEvidence } from '../../agent-evaluation-evidence'
import {
  cancelAgentEvaluationBatch,
  getAgentEvaluationBatch,
  getLatestAgentEvaluationBatch,
  startAgentEvaluationBatch,
} from '../../agent-evaluation-batch-service'
import { requireAgentVersion } from '../../agent-version-service'
import { exportAgentEvaluationReport } from '../../agent-evaluation-report-service'
import { sqliteIndex } from '../../sqlite-index'
import { getTrustedWorkspaceRoot } from '../../trusted-workspace'
import { registerHandlerWithSchema } from '../registry'
import {
  agentEvaluationArchiveSchema,
  agentEvaluationAssessSchema,
  agentEvaluationAttachCaseSchema,
  agentEvaluationBatchCancelSchema,
  agentEvaluationBatchGetSchema,
  agentEvaluationBatchLatestSchema,
  agentEvaluationBatchStartSchema,
  agentEvaluationCompareSchema,
  agentEvaluationListSchema,
  agentEvaluationReportExportSchema,
  agentEvaluationScenarioCreateSchema,
  agentEvaluationSuiteCloneVersionSchema,
  agentEvaluationSuiteCreateSchema,
} from '../schemas'

function requireSuite(id: string): AgentEvaluationSuite {
  const suite = sqliteIndex.getAgentEvaluationSuite(id)
  if (!suite) throw new Error('Agent evaluation suite not found')
  return suite
}

function requireScenario(id: string): AgentEvaluationScenario {
  const scenario = sqliteIndex.getAgentEvaluationScenario(id)
  if (!scenario) throw new Error('Agent evaluation scenario not found')
  return scenario
}

function requireRun(id: string): AgentEvaluationRun {
  const run = sqliteIndex.getAgentEvaluationRun(id)
  if (!run) throw new Error('Agent evaluation run not found')
  return run
}

function assertTrustedWorkspace(workspacePath: string): void {
  const trusted = getTrustedWorkspaceRoot()
  if (!trusted || resolve(trusted) !== resolve(workspacePath)) {
    throw new Error('Agent evaluations can only change the active trusted workspace')
  }
}

function saveSuite(suite: AgentEvaluationSuite): AgentEvaluationSuite {
  if (!sqliteIndex.saveAgentEvaluationSuite(suite)) {
    throw new Error('Agent evaluation metadata store is unavailable')
  }
  return suite
}

function saveScenario(scenario: AgentEvaluationScenario): AgentEvaluationScenario {
  if (!sqliteIndex.saveAgentEvaluationScenario(scenario)) {
    throw new Error('Agent evaluation metadata store is unavailable')
  }
  return scenario
}

function saveRun(run: AgentEvaluationRun): AgentEvaluationRun {
  if (!sqliteIndex.saveAgentEvaluationRun(run)) {
    throw new Error('Agent evaluation metadata store is unavailable')
  }
  return run
}

function bundle(suite: AgentEvaluationSuite): AgentEvaluationSuiteBundle {
  return {
    suite,
    scenarios: sqliteIndex.listAgentEvaluationScenarios(suite.id),
    runs: sqliteIndex.listAgentEvaluationRuns(suite.id),
  }
}

export function registerAgentEvaluationHandlers(): void {
  registerHandlerWithSchema('ipc:agentEvaluation.list', agentEvaluationListSchema, async (request) => ({
    suites: sqliteIndex.listAgentEvaluationSuites(request).map(bundle),
  }))

  registerHandlerWithSchema(
    'ipc:agentEvaluation.suite.create',
    agentEvaluationSuiteCreateSchema,
    async (request) => {
      assertTrustedWorkspace(request.workspacePath)
      const profile = sqliteIndex.getAgentProfile(request.profileId)
      if (!profile || profile.status === 'archived') throw new Error('Active Agent profile not found')
      const version = requireAgentVersion(request.versionId, profile.id)
      const now = Date.now()
      const suite = saveSuite({
        id: randomUUID(),
        name: request.name,
        description: request.description || undefined,
        workspacePath: request.workspacePath,
        profileId: profile.id,
        versionId: version.id,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      auditRepository.write({
        category: 'operation',
        action: 'agent-evaluation.suite.create',
        outcome: 'success',
        workspaceId: suite.workspacePath,
        details: {
          suiteId: suite.id,
          profileId: suite.profileId,
          versionId: version.id,
          versionNumber: version.number,
        },
      })
      return { suite }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.suite.cloneVersion',
    agentEvaluationSuiteCloneVersionSchema,
    async (request) => {
      const source = requireSuite(request.sourceSuiteId)
      assertTrustedWorkspace(source.workspacePath)
      if (!source.versionId) throw new Error('Source evaluation suite has no immutable Agent version')
      const targetVersion = requireAgentVersion(request.targetVersionId, source.profileId)
      if (targetVersion.id === source.versionId) {
        throw new Error('Target version must be different from the source evaluation version')
      }
      const sourceScenarios = sqliteIndex.listAgentEvaluationScenarios(source.id)
      if (sourceScenarios.length === 0) {
        throw new Error('Add at least one fixed task before evaluating another Agent version')
      }
      const duplicate = sqliteIndex.listAgentEvaluationSuites({
        workspacePath: source.workspacePath,
        includeArchived: false,
      }).find((suite) => (
        suite.baselineSuiteId === source.id && suite.versionId === targetVersion.id
      ))
      if (duplicate) throw new Error('This evaluation baseline already has a suite for the target version')

      const now = Date.now()
      const suite: AgentEvaluationSuite = {
        id: randomUUID(),
        name: request.name || `${source.name} · v${targetVersion.number}`,
        description: source.description,
        workspacePath: source.workspacePath,
        profileId: source.profileId,
        versionId: targetVersion.id,
        baselineSuiteId: source.id,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }
      const scenarios: AgentEvaluationScenario[] = sourceScenarios.map((scenario) => ({
        ...scenario,
        id: randomUUID(),
        suiteId: suite.id,
        createdAt: now,
        updatedAt: now,
      }))
      if (!sqliteIndex.saveAgentEvaluationSuiteClone(suite, scenarios)) {
        throw new Error('Agent evaluation metadata store is unavailable')
      }
      auditRepository.write({
        category: 'operation',
        action: 'agent-evaluation.suite.clone-version',
        outcome: 'success',
        workspaceId: suite.workspacePath,
        details: {
          sourceSuiteId: source.id,
          suiteId: suite.id,
          profileId: suite.profileId,
          baselineVersionId: source.versionId,
          targetVersionId: targetVersion.id,
          scenarioCount: scenarios.length,
        },
      })
      return { bundle: { suite, scenarios, runs: [] } }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.scenario.create',
    agentEvaluationScenarioCreateSchema,
    async (request) => {
      const suite = requireSuite(request.suiteId)
      assertTrustedWorkspace(suite.workspacePath)
      if (suite.status === 'archived') throw new Error('Archived evaluation suite is read-only')
      const now = Date.now()
      const scenario = saveScenario({
        id: randomUUID(),
        suiteId: suite.id,
        name: request.name,
        prompt: request.prompt,
        expectedOutcome: request.expectedOutcome || undefined,
        tags: request.tags ?? [],
        sortOrder: sqliteIndex.listAgentEvaluationScenarios(suite.id).length,
        createdAt: now,
        updatedAt: now,
      })
      saveSuite({ ...suite, updatedAt: now })
      auditRepository.write({
        category: 'operation',
        action: 'agent-evaluation.scenario.create',
        outcome: 'success',
        workspaceId: suite.workspacePath,
        details: { suiteId: suite.id, scenarioId: scenario.id },
      })
      return { scenario }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.attachCase',
    agentEvaluationAttachCaseSchema,
    async (request) => {
      const suite = requireSuite(request.suiteId)
      const scenario = requireScenario(request.scenarioId)
      if (scenario.suiteId !== suite.id) throw new Error('Scenario does not belong to the evaluation suite')
      assertTrustedWorkspace(suite.workspacePath)
      if (suite.status === 'archived') throw new Error('Archived evaluation suite is read-only')
      const agentCase = sqliteIndex.getAgentCase(request.caseId)
      if (!agentCase || resolve(agentCase.workspacePath) !== resolve(suite.workspacePath)) {
        throw new Error('Agent case does not belong to the evaluation workspace')
      }
      const existing = sqliteIndex
        .listAgentEvaluationRuns(suite.id)
        .find((item) => item.scenarioId === scenario.id && item.sourceCaseId === agentCase.id)
      if (existing) throw new Error('This Agent case is already attached to the scenario')
      const evidence = await captureAgentEvaluationEvidence({ agentCase, scenario })
      if (!evidence.agent || evidence.agent.profileId !== suite.profileId) {
        throw new Error('Agent case was not produced by the evaluation suite Agent')
      }
      if (!suite.versionId || evidence.agent.versionId !== suite.versionId) {
        throw new Error('Agent case was not produced by the evaluation suite Agent version')
      }
      const now = Date.now()
      const run = saveRun({
        id: randomUUID(),
        suiteId: suite.id,
        scenarioId: scenario.id,
        sourceCaseId: agentCase.id,
        evidence,
        verdict: 'pending',
        createdAt: now,
        updatedAt: now,
      })
      saveSuite({ ...suite, updatedAt: now })
      auditRepository.write({
        category: 'operation',
        action: 'agent-evaluation.case.attach',
        outcome: 'success',
        workspaceId: suite.workspacePath,
        sessionFile: evidence.sourceSessionFile,
        details: {
          suiteId: suite.id,
          scenarioId: scenario.id,
          runId: run.id,
          caseId: agentCase.id,
          promptMatched: evidence.promptMatched,
          snapshotDigest: evidence.agent.snapshotDigest,
        },
      })
      return { run }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.compare',
    agentEvaluationCompareSchema,
    async (request) => {
      const baseline = bundle(requireSuite(request.baselineSuiteId))
      const candidate = bundle(requireSuite(request.candidateSuiteId))
      if (resolve(baseline.suite.workspacePath) !== resolve(candidate.suite.workspacePath)) {
        throw new Error('Evaluation suites must belong to the same workspace')
      }
      return { comparison: compareAgentEvaluationSuites(baseline, candidate) }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.report.export',
    agentEvaluationReportExportSchema,
    async (request) => {
      const candidate = requireSuite(request.candidateSuiteId)
      assertTrustedWorkspace(candidate.workspacePath)
      return exportAgentEvaluationReport(request)
    },
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.batch.start',
    agentEvaluationBatchStartSchema,
    async (request) => {
      const suite = requireSuite(request.suiteId)
      assertTrustedWorkspace(suite.workspacePath)
      if (suite.status === 'archived') throw new Error('Archived evaluation suite is read-only')
      return { batch: startAgentEvaluationBatch(suite) }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.batch.get',
    agentEvaluationBatchGetSchema,
    async (request) => ({ batch: getAgentEvaluationBatch(request.batchId) }),
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.batch.latest',
    agentEvaluationBatchLatestSchema,
    async (request) => ({ batch: getLatestAgentEvaluationBatch(request.suiteId) }),
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.batch.cancel',
    agentEvaluationBatchCancelSchema,
    async (request) => {
      const batch = getAgentEvaluationBatch(request.batchId)
      const suite = requireSuite(batch.suiteId)
      assertTrustedWorkspace(suite.workspacePath)
      return { batch: await cancelAgentEvaluationBatch(request.batchId) }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.assess',
    agentEvaluationAssessSchema,
    async (request) => {
      const previous = requireRun(request.runId)
      const suite = requireSuite(previous.suiteId)
      assertTrustedWorkspace(suite.workspacePath)
      if (suite.status === 'archived') throw new Error('Archived evaluation suite is read-only')
      const run = saveRun({
        ...previous,
        verdict: request.verdict,
        notes: request.notes || undefined,
        updatedAt: Date.now(),
      })
      auditRepository.write({
        category: 'operation',
        action: 'agent-evaluation.run.assess',
        outcome: 'success',
        workspaceId: suite.workspacePath,
        sessionFile: run.evidence.sourceSessionFile,
        details: { suiteId: suite.id, runId: run.id, verdict: run.verdict },
      })
      return { run }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentEvaluation.archive',
    agentEvaluationArchiveSchema,
    async (request) => {
      const previous = requireSuite(request.suiteId)
      assertTrustedWorkspace(previous.workspacePath)
      const suite = saveSuite({ ...previous, status: 'archived', updatedAt: Date.now() })
      auditRepository.write({
        category: 'operation',
        action: 'agent-evaluation.suite.archive',
        outcome: 'success',
        workspaceId: suite.workspacePath,
        details: { suiteId: suite.id },
      })
      return { suite }
    },
  )
}
