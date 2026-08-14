import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCase } from '@shared/agent-case'
import type {
  AgentEvaluationRun,
  AgentEvaluationScenario,
  AgentEvaluationSuite,
} from '@shared/agent-evaluation'
import type { AgentProfile } from '@shared/agent-profile'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (request: Record<string, unknown>) => Promise<unknown>>()
  return {
    handlers,
    trusted: { value: '/workspace' },
    sqlite: {
      getAgentProfile: vi.fn(),
      getAgentCase: vi.fn(),
      getAgentEvaluationSuite: vi.fn(),
      listAgentEvaluationSuites: vi.fn(() => []),
      saveAgentEvaluationSuite: vi.fn(() => true),
      saveAgentEvaluationSuiteClone: vi.fn(() => true),
      getAgentEvaluationScenario: vi.fn(),
      listAgentEvaluationScenarios: vi.fn<(id: string) => AgentEvaluationScenario[]>(() => []),
      saveAgentEvaluationScenario: vi.fn(() => true),
      getAgentEvaluationRun: vi.fn(),
      listAgentEvaluationRuns: vi.fn<(id: string) => AgentEvaluationRun[]>(() => []),
      saveAgentEvaluationRun: vi.fn(() => true),
    },
    capture: vi.fn(),
    audit: vi.fn(),
    requireAgentVersion: vi.fn(),
    batchStart: vi.fn(),
    batchGet: vi.fn(),
    batchLatest: vi.fn(),
    batchCancel: vi.fn(),
    reportExport: vi.fn(),
  }
})

vi.mock('../registry', () => ({
  registerHandlerWithSchema: (
    channel: string,
    schema: { parse: (request: unknown) => Record<string, unknown> },
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => mocks.handlers.set(channel, (request) => handler(schema.parse(request))),
}))
vi.mock('../../trusted-workspace', () => ({
  getTrustedWorkspaceRoot: () => mocks.trusted.value,
}))
vi.mock('../../sqlite-index', () => ({ sqliteIndex: mocks.sqlite }))
vi.mock('../../agent-evaluation-evidence', () => ({
  captureAgentEvaluationEvidence: mocks.capture,
}))
vi.mock('../../agent-version-service', () => ({
  requireAgentVersion: mocks.requireAgentVersion,
}))
vi.mock('../../agent-evaluation-batch-service', () => ({
  startAgentEvaluationBatch: mocks.batchStart,
  getAgentEvaluationBatch: mocks.batchGet,
  getLatestAgentEvaluationBatch: mocks.batchLatest,
  cancelAgentEvaluationBatch: mocks.batchCancel,
}))
vi.mock('../../agent-evaluation-report-service', () => ({
  exportAgentEvaluationReport: mocks.reportExport,
}))
vi.mock('../../audit/audit-repository', () => ({
  auditRepository: { write: mocks.audit },
}))

import { registerAgentEvaluationHandlers } from './agent-evaluation'

const profileId = '31c04a55-bebf-41c2-ad5a-4fe4cdd90a48'
const suiteId = 'cc93f860-8c3f-4f68-a8d5-315ebadfbccd'
const scenarioId = '5efee0c2-ecf7-42ed-883a-0d620f8d466d'
const caseId = '2a630ef4-a3aa-47fd-a245-6927df7c2068'
const runId = 'c97bd345-bf94-4013-b0ea-37493bd3ee41'
const versionId = '00000000-0000-4000-8000-000000000001'
const targetVersionId = '00000000-0000-4000-8000-000000000002'

const profile: AgentProfile = {
  id: profileId,
  name: 'Report Agent',
  systemPrompt: 'Be precise',
  promptMode: 'append',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}
const suite: AgentEvaluationSuite = {
  id: suiteId,
  name: 'Report regression',
  workspacePath: '/workspace',
  profileId,
  versionId,
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}
const scenario: AgentEvaluationScenario = {
  id: scenarioId,
  suiteId,
  name: 'Weekly report',
  prompt: 'Write the weekly report',
  tags: [],
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
}
const agentCase: AgentCase = {
  id: caseId,
  name: 'Weekly report run',
  tags: [],
  status: 'validated',
  workspacePath: '/workspace',
  sourceSessionId: 'session-1',
  sourceSessionFile: '/sessions/one.jsonl',
  createdAt: 1,
  updatedAt: 1,
}
const evidence = {
  capturedAt: 2,
  piRuntimeVersion: '0.84.1',
  sourceSessionId: 'session-1',
  sourceSessionFile: '/sessions/one.jsonl',
  actualPrompt: scenario.prompt,
  promptMatched: true,
  outputText: 'Done',
  agent: {
    profileId,
    name: profile.name,
    versionId,
    versionNumber: 1,
    snapshotCapturedAt: 1,
    snapshotDigest: 'abc',
    snapshot: {
      profileId,
      versionId,
      versionNumber: 1,
      versionDigest: 'abc',
      name: profile.name,
      systemPrompt: profile.systemPrompt,
      promptMode: 'append' as const,
      capturedAt: 1,
    },
  },
  metrics: {
    durationMs: 100,
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    cost: 0,
    toolCalls: 1,
    failedToolCalls: 0,
    assistantMessages: 1,
  },
}

describe('Agent Evaluation IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.trusted.value = '/workspace'
    mocks.sqlite.getAgentProfile.mockReturnValue(profile)
    mocks.sqlite.getAgentCase.mockReturnValue(agentCase)
    mocks.sqlite.getAgentEvaluationSuite.mockReturnValue(suite)
    mocks.sqlite.getAgentEvaluationScenario.mockReturnValue(scenario)
    mocks.sqlite.listAgentEvaluationScenarios.mockReturnValue([scenario] as never)
    mocks.sqlite.listAgentEvaluationRuns.mockReturnValue([])
    mocks.capture.mockResolvedValue(evidence)
    mocks.requireAgentVersion.mockReturnValue({
      id: versionId,
      profileId,
      number: 1,
      digest: 'abc',
      status: 'candidate',
      config: {},
      createdAt: 1,
    })
    registerAgentEvaluationHandlers()
  })

  it('creates a suite only for an active Agent in the trusted workspace', async () => {
    const response = await mocks.handlers.get('ipc:agentEvaluation.suite.create')!({
      name: ' Report regression ',
      workspacePath: '/workspace',
      profileId,
      versionId,
    }) as { suite: AgentEvaluationSuite }
    expect(response.suite).toMatchObject({
      name: 'Report regression',
      profileId,
      workspacePath: '/workspace',
      status: 'active',
    })
    expect(mocks.sqlite.saveAgentEvaluationSuite).toHaveBeenCalled()
  })

  it('freezes real Pi evidence when a matching Agent case is attached', async () => {
    const response = await mocks.handlers.get('ipc:agentEvaluation.attachCase')!({
      suiteId,
      scenarioId,
      caseId,
    }) as { run: AgentEvaluationRun }
    expect(response.run).toMatchObject({
      suiteId,
      scenarioId,
      sourceCaseId: caseId,
      verdict: 'pending',
      evidence: { promptMatched: true, agent: { profileId } },
    })
    expect(mocks.capture).toHaveBeenCalledWith({ agentCase, scenario })
  })

  it('atomically clones fixed tasks for another immutable Agent version', async () => {
    mocks.requireAgentVersion.mockReturnValue({
      id: targetVersionId,
      profileId,
      number: 2,
      digest: 'def',
      status: 'candidate',
      config: {},
      createdAt: 2,
    })
    const response = await mocks.handlers.get('ipc:agentEvaluation.suite.cloneVersion')!({
      sourceSuiteId: suiteId,
      targetVersionId,
      name: 'Report regression v2',
    }) as { bundle: { suite: AgentEvaluationSuite; scenarios: AgentEvaluationScenario[] } }
    expect(response.bundle.suite).toMatchObject({
      name: 'Report regression v2',
      versionId: targetVersionId,
      baselineSuiteId: suiteId,
    })
    expect(response.bundle.scenarios).toHaveLength(1)
    expect(response.bundle.scenarios[0]).toMatchObject({
      name: scenario.name,
      prompt: scenario.prompt,
    })
    expect(response.bundle.scenarios[0]?.id).not.toBe(scenario.id)
    expect(mocks.sqlite.saveAgentEvaluationSuiteClone).toHaveBeenCalledWith(
      response.bundle.suite,
      response.bundle.scenarios,
    )
  })

  it('rejects a case produced by another Agent profile', async () => {
    mocks.capture.mockResolvedValue({
      ...evidence,
      agent: { ...evidence.agent, profileId: '4e7fdf46-e272-44f8-99cb-ed36e9691402' },
    })
    await expect(mocks.handlers.get('ipc:agentEvaluation.attachCase')!({
      suiteId,
      scenarioId,
      caseId,
    })).rejects.toThrow('suite Agent')
    expect(mocks.sqlite.saveAgentEvaluationRun).not.toHaveBeenCalled()
  })

  it('stores a human verdict without inventing an automatic score', async () => {
    const run: AgentEvaluationRun = {
      id: runId,
      suiteId,
      scenarioId,
      sourceCaseId: caseId,
      evidence,
      verdict: 'pending',
      createdAt: 1,
      updatedAt: 1,
    }
    mocks.sqlite.getAgentEvaluationRun.mockReturnValue(run)
    const response = await mocks.handlers.get('ipc:agentEvaluation.assess')!({
      runId,
      verdict: 'passed',
      notes: 'Meets the acceptance criteria',
    }) as { run: AgentEvaluationRun }
    expect(response.run).toMatchObject({
      verdict: 'passed',
      notes: 'Meets the acceptance criteria',
    })
    expect(mocks.audit).toHaveBeenCalledWith(expect.objectContaining({
      action: 'agent-evaluation.run.assess',
      outcome: 'success',
    }))
  })

  it('compares two suites from the same Agent using fixed-task evidence', async () => {
    const candidateSuiteId = '00000000-0000-4000-8000-000000000003'
    const candidateScenarioId = '00000000-0000-4000-8000-000000000004'
    const candidateSuite: AgentEvaluationSuite = {
      ...suite,
      id: candidateSuiteId,
      versionId: targetVersionId,
      baselineSuiteId: suite.id,
    }
    const candidateScenario: AgentEvaluationScenario = {
      ...scenario,
      id: candidateScenarioId,
      suiteId: candidateSuiteId,
    }
    const baselineRun: AgentEvaluationRun = {
      id: runId,
      suiteId,
      scenarioId,
      sourceCaseId: caseId,
      evidence,
      verdict: 'failed',
      createdAt: 1,
      updatedAt: 1,
    }
    const candidateRun: AgentEvaluationRun = {
      ...baselineRun,
      id: '00000000-0000-4000-8000-000000000005',
      suiteId: candidateSuiteId,
      scenarioId: candidateScenarioId,
      verdict: 'passed',
      createdAt: 2,
    }
    mocks.sqlite.getAgentEvaluationSuite.mockImplementation((id: string) => (
      id === candidateSuiteId ? candidateSuite : suite
    ))
    mocks.sqlite.listAgentEvaluationScenarios.mockImplementation((id: string) => (
      id === candidateSuiteId ? [candidateScenario] : [scenario]
    ))
    mocks.sqlite.listAgentEvaluationRuns.mockImplementation((id: string) => (
      id === candidateSuiteId ? [candidateRun] : [baselineRun]
    ))
    const response = await mocks.handlers.get('ipc:agentEvaluation.compare')!({
      baselineSuiteId: suiteId,
      candidateSuiteId,
    }) as { comparison: { outcome: string; counts: { improved: number } } }
    expect(response.comparison).toMatchObject({
      outcome: 'improved',
      counts: { improved: 1 },
    })
  })

  it('starts a background regression only for the active trusted suite', async () => {
    const batch = { id: '00000000-0000-4000-8000-000000000006', suiteId, status: 'queued' }
    mocks.sqlite.getAgentEvaluationSuite.mockReturnValue(suite)
    mocks.batchStart.mockReturnValue(batch)
    const response = await mocks.handlers.get('ipc:agentEvaluation.batch.start')!({ suiteId }) as { batch: typeof batch }
    expect(response.batch).toBe(batch)
    expect(mocks.batchStart).toHaveBeenCalledWith(suite)
  })

  it('exports a report only from the active trusted evaluation workspace', async () => {
    mocks.sqlite.getAgentEvaluationSuite.mockReturnValue(suite)
    mocks.reportExport.mockReturnValue({ bytes: 10, outcome: 'insufficient', download: {} })
    const request = {
      baselineSuiteId: suiteId,
      candidateSuiteId: '00000000-0000-4000-8000-000000000009',
      locale: 'zh',
      includeContent: false,
    }
    await mocks.handlers.get('ipc:agentEvaluation.report.export')!(request)
    expect(mocks.reportExport).toHaveBeenCalledWith(request)
  })
})
