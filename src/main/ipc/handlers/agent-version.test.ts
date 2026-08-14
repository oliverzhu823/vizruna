import { describe, expect, it, vi } from 'vitest'
import type {
  AgentEvaluationRun,
  AgentEvaluationSuiteBundle,
} from '@shared/agent-evaluation'
import type { AgentVersion } from '@shared/agent-version'

vi.mock('../../trusted-workspace', () => ({ getTrustedWorkspaceRoot: vi.fn() }))
vi.mock('../../audit/audit-repository', () => ({ auditRepository: { write: vi.fn() } }))
vi.mock('../../sqlite-index', () => ({ sqliteIndex: {} }))
vi.mock('../../agent-version-service', () => ({
  migrateAgentVersions: vi.fn(),
  requireAgentVersion: vi.fn(),
  validateAgentVersion: vi.fn(),
}))
vi.mock('../registry', () => ({ registerHandlerWithSchema: vi.fn() }))
import {
  buildAgentVersionValidationGate,
  latestValidatedBaseline,
} from './agent-version'

const version: AgentVersion = {
  id: 'version-1',
  profileId: 'profile-1',
  number: 1,
  digest: 'digest-1',
  config: { name: 'Agent', systemPrompt: 'Do it', promptMode: 'append' },
  status: 'candidate',
  createdAt: 1,
}

function run(overrides: Partial<AgentEvaluationRun> = {}): AgentEvaluationRun {
  return {
    id: 'run-1',
    suiteId: 'suite-1',
    scenarioId: 'scenario-1',
    sourceCaseId: 'case-1',
    verdict: 'passed',
    createdAt: 3,
    updatedAt: 3,
    evidence: {
      capturedAt: 3,
      piRuntimeVersion: '0.84.1',
      sourceSessionId: 'session-1',
      sourceSessionFile: '/session.jsonl',
      actualPrompt: 'task',
      promptMatched: true,
      outputText: 'done',
      agent: {
        profileId: 'profile-1',
        name: 'Agent',
        versionId: version.id,
        versionNumber: 1,
        snapshotCapturedAt: 2,
        snapshotDigest: version.digest,
        snapshot: {
          profileId: 'profile-1',
          versionId: version.id,
          versionNumber: 1,
          versionDigest: version.digest,
          name: 'Agent',
          systemPrompt: 'Do it',
          promptMode: 'append',
          capturedAt: 2,
        },
      },
      metrics: {
        durationMs: 10,
        inputTokens: 1,
        outputTokens: 1,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cost: 0,
        toolCalls: 0,
        failedToolCalls: 0,
        assistantMessages: 1,
      },
    },
    ...overrides,
  }
}

function bundle(input: {
  versionId?: string
  baselineSuiteId?: string
  runs?: AgentEvaluationRun[]
} = {}): AgentEvaluationSuiteBundle {
  return {
    suite: {
      id: input.baselineSuiteId ? 'suite-2' : 'suite-1',
      name: 'Regression',
      workspacePath: '/workspace',
      profileId: version.profileId,
      versionId: input.versionId ?? version.id,
      baselineSuiteId: input.baselineSuiteId,
      status: 'active',
      createdAt: 1,
      updatedAt: 1,
    },
    scenarios: [{
      id: 'scenario-1',
      suiteId: input.baselineSuiteId ? 'suite-2' : 'suite-1',
      name: 'Task one',
      prompt: 'task',
      tags: [],
      sortOrder: 0,
      createdAt: 1,
      updatedAt: 1,
    }],
    runs: input.runs ?? [run()],
  }
}

describe('Agent version validation gate', () => {
  it('requires every task to pass with the exact prompt and version', () => {
    const gate = buildAgentVersionValidationGate({
      version,
      candidate: bundle(),
    })
    expect(gate.eligible).toBe(true)
    expect(gate.blockers).toEqual([])
    expect(gate.scenarios[0].runId).toBe('run-1')
  })

  it('rejects prompt drift and runs from another version', () => {
    expect(buildAgentVersionValidationGate({
      version,
      candidate: bundle({ runs: [run({ evidence: { ...run().evidence, promptMatched: false } })] }),
    }).eligible).toBe(false)
    expect(buildAgentVersionValidationGate({
      version,
      candidate: bundle({ runs: [run({ evidence: { ...run().evidence, agent: { ...run().evidence.agent!, versionId: 'version-2' } } })] }),
    }).eligible).toBe(false)
  })

  it('uses the latest exact-version run instead of stale passing evidence', () => {
    const stale = run({ id: 'old', createdAt: 2 })
    const latest = run({ id: 'new', verdict: 'failed', createdAt: 4 })
    const gate = buildAgentVersionValidationGate({
      version,
      candidate: bundle({ runs: [stale, latest] }),
    })
    expect(gate.eligible).toBe(false)
    expect(gate.scenarios[0]).toMatchObject({ runId: 'new', verdict: 'failed' })
    expect(gate.blockers).toContain('task-failed')
  })

  it('requires a comparable baseline and rejects a regression', () => {
    const candidate = bundle({ baselineSuiteId: 'suite-baseline' })
    candidate.runs = [run({ id: 'candidate-run', verdict: 'failed' })]
    const baseline = bundle({ versionId: 'version-baseline' })
    baseline.suite.id = 'suite-baseline'
    baseline.runs = [run({
      id: 'baseline-run',
      verdict: 'passed',
      evidence: {
        ...run().evidence,
        agent: { ...run().evidence.agent!, versionId: 'version-baseline' },
      },
    })]
    const gate = buildAgentVersionValidationGate({
      version,
      candidate,
      baselineRequired: true,
      baselineVersionId: 'version-baseline',
      baseline,
    })
    expect(gate.eligible).toBe(false)
    expect(gate.comparisonOutcome).toBe('regressed')
    expect(gate.blockers).toEqual(expect.arrayContaining(['task-failed', 'comparison-regressed']))
  })

  it('allows an equivalent candidate against the required validated baseline', () => {
    const candidate = bundle({ baselineSuiteId: 'suite-baseline' })
    const baseline = bundle({ versionId: 'version-baseline' })
    baseline.suite.id = 'suite-baseline'
    baseline.runs = [run({
      id: 'baseline-run',
      evidence: {
        ...run().evidence,
        agent: { ...run().evidence.agent!, versionId: 'version-baseline' },
      },
    })]
    const gate = buildAgentVersionValidationGate({
      version,
      candidate,
      baselineRequired: true,
      baselineVersionId: 'version-baseline',
      baseline,
    })
    expect(gate).toMatchObject({
      eligible: true,
      blockers: [],
      comparisonOutcome: 'equivalent',
      baselineRequired: true,
    })
  })

  it('does not allow a later version to bypass the validated baseline', () => {
    const gate = buildAgentVersionValidationGate({
      version,
      candidate: bundle(),
      baselineRequired: true,
      baselineVersionId: 'version-baseline',
    })
    expect(gate.eligible).toBe(false)
    expect(gate.blockers).toContain('baseline-required')
  })

  it('selects the newest earlier validated or released version as the mandatory baseline', () => {
    const candidate = { ...version, id: 'version-4', number: 4 }
    const versions: AgentVersion[] = [
      candidate,
      { ...version, id: 'version-3', number: 3, status: 'candidate' },
      { ...version, id: 'version-1', number: 1, status: 'released' },
      { ...version, id: 'version-2', number: 2, status: 'validated' },
      { ...version, id: 'version-5', number: 5, status: 'released' },
    ]
    expect(latestValidatedBaseline(versions, candidate)?.id).toBe('version-2')
  })
})
