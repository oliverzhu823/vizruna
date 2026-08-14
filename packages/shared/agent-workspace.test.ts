import { describe, expect, it } from 'vitest'
import { buildAgentWorkspaceEvidence } from './agent-workspace'

const suite = {
  suite: { id: 'suite', name: 'Regression', workspacePath: '/w', profileId: 'agent', versionId: 'v1', status: 'active' as const, createdAt: 1, updatedAt: 1 },
  scenarios: [
    { id: 's1', suiteId: 'suite', name: 'One', prompt: 'one', tags: [], sortOrder: 0, createdAt: 1, updatedAt: 1 },
    { id: 's2', suiteId: 'suite', name: 'Two', prompt: 'two', tags: [], sortOrder: 1, createdAt: 1, updatedAt: 1 },
  ],
  runs: [{ id: 'r1', suiteId: 'suite', scenarioId: 's1', sourceCaseId: 'case', verdict: 'passed' as const, evidence: {} as never, createdAt: 1, updatedAt: 1 }],
}

describe('buildAgentWorkspaceEvidence', () => {
  it('does not suggest delivery when no immutable version exists', () => {
    const evidence = buildAgentWorkspaceEvidence({ profileId: 'agent', packageAvailable: false, cases: [], suites: [] })
    expect(evidence.nextAction).toBe('edit-agent')
  })

  it('guides a candidate through missing runs before validation', () => {
    const evidence = buildAgentWorkspaceEvidence({ profileId: 'agent', latestVersionId: 'v1', latestVersionStatus: 'candidate', packageAvailable: false, cases: [], suites: [suite] })
    expect(evidence.scenarios).toBe(2)
    expect(evidence.completedScenarios).toBe(1)
    expect(evidence.nextAction).toBe('run-evaluation')
  })

  it('uses only the latest run per scenario and exposes validation blockers', () => {
    const evidence = buildAgentWorkspaceEvidence({
      profileId: 'agent', latestVersionId: 'v1', latestVersionStatus: 'candidate', packageAvailable: false, cases: [],
      suites: [{ ...suite, runs: [...suite.runs, { ...suite.runs[0], id: 'r2', verdict: 'failed', updatedAt: 2 }, { ...suite.runs[0], id: 'r3', scenarioId: 's2', verdict: 'passed', updatedAt: 2 }] }],
      gate: { eligible: false, suiteId: 'suite', versionId: 'v1', scenarios: [], blockers: ['task-failed'], baselineRequired: false },
    })
    expect(evidence.completedScenarios).toBe(2)
    expect(evidence.failedScenarios).toBe(1)
    expect(evidence.validationBlockers).toEqual(['task-failed'])
    expect(evidence.nextAction).toBe('fix-validation')
  })

  it('moves an eligible candidate to validation and a mature asset to delivery', () => {
    const eligible = buildAgentWorkspaceEvidence({
      profileId: 'agent', latestVersionId: 'v1', latestVersionStatus: 'candidate', packageAvailable: false, cases: [],
      suites: [{ ...suite, runs: [{ ...suite.runs[0], scenarioId: 's1' }, { ...suite.runs[0], id: 'r2', scenarioId: 's2' }] }],
      gate: { eligible: true, suiteId: 'suite', versionId: 'v1', scenarios: [], blockers: [], baselineRequired: false },
    })
    expect(eligible.nextAction).toBe('validate-version')
    const mature = buildAgentWorkspaceEvidence({ profileId: 'agent', latestVersionId: 'v1', latestVersionStatus: 'validated', packageAvailable: false, cases: [], suites: [] })
    expect(mature.nextAction).toBe('package')
  })
})
