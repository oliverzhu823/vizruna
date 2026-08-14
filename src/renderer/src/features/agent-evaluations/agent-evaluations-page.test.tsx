import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentCase } from '@shared/agent-case'
import type {
  AgentEvaluationRun,
  AgentEvaluationScenario,
  AgentEvaluationSuite,
} from '@shared/agent-evaluation'
import type { AgentProfile } from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { AgentEvaluationsPage } from './agent-evaluations-page'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))
vi.mock('@renderer/lib/browser-download', () => ({ saveBrowserDownload: vi.fn(() => true) }))

const profile: AgentProfile = {
  id: '31c04a55-bebf-41c2-ad5a-4fe4cdd90a48',
  name: 'Report Agent',
  systemPrompt: 'Be precise',
  promptMode: 'append',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}
const version: AgentVersion = {
  id: '00000000-0000-4000-8000-000000000001',
  profileId: profile.id,
  number: 1,
  digest: '1234567890abcdef',
  config: { name: profile.name, systemPrompt: profile.systemPrompt, promptMode: 'append' },
  status: 'candidate',
  createdAt: 1,
}
const version2: AgentVersion = {
  ...version,
  id: '00000000-0000-4000-8000-000000000002',
  number: 2,
  digest: 'fedcba0987654321',
  status: 'validated',
  createdAt: 2,
}
const suite: AgentEvaluationSuite = {
  id: 'cc93f860-8c3f-4f68-a8d5-315ebadfbccd',
  name: 'Report regression',
  workspacePath: '/workspace',
  profileId: profile.id,
  versionId: version.id,
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}
const scenario: AgentEvaluationScenario = {
  id: '5efee0c2-ecf7-42ed-883a-0d620f8d466d',
  suiteId: suite.id,
  name: 'Weekly report',
  prompt: 'Write the weekly report',
  expectedOutcome: 'Includes facts and recommendations',
  tags: ['report'],
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
}
const agentCase: AgentCase = {
  id: '2a630ef4-a3aa-47fd-a245-6927df7c2068',
  name: 'Weekly report case',
  tags: [],
  status: 'validated',
  workspacePath: '/workspace',
  sourceSessionId: 'session-1',
  sourceSessionFile: '/sessions/one.jsonl',
  provenance: {
    capturedAt: 1,
    piRuntimeVersion: '0.84.1',
    agent: {
      profileId: profile.id,
      name: profile.name,
      versionId: version.id,
      versionNumber: version.number,
      snapshotCapturedAt: 1,
      snapshotDigest: 'abc',
    },
    packages: [],
  },
  createdAt: 1,
  updatedAt: 1,
}
const run: AgentEvaluationRun = {
  id: 'c97bd345-bf94-4013-b0ea-37493bd3ee41',
  suiteId: suite.id,
  scenarioId: scenario.id,
  sourceCaseId: 'different-case',
  verdict: 'passed',
  notes: 'Meets criteria',
  createdAt: 2,
  updatedAt: 2,
  evidence: {
    capturedAt: 2,
    piRuntimeVersion: '0.84.1',
    sourceSessionId: 'session-0',
    sourceSessionFile: '/sessions/zero.jsonl',
    actualPrompt: scenario.prompt,
    promptMatched: true,
    outputText: 'A complete weekly report',
    modelId: 'openai/gpt-5',
    agent: {
      profileId: profile.id,
      name: profile.name,
      versionId: version.id,
      versionNumber: version.number,
      snapshotCapturedAt: 1,
      snapshotDigest: '1234567890abcdef',
      snapshot: {
        profileId: profile.id,
        versionId: version.id,
        versionNumber: version.number,
        versionDigest: version.digest,
        name: profile.name,
        systemPrompt: profile.systemPrompt,
        promptMode: 'append',
        capturedAt: 1,
      },
    },
    metrics: {
      durationMs: 2_500,
      inputTokens: 100,
      outputTokens: 50,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      cost: 0.02,
      toolCalls: 2,
      failedToolCalls: 0,
      assistantMessages: 1,
    },
  },
}

describe('AgentEvaluationsPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.mocked(ipcClient.invoke).mockReset()
    useUIStore.setState({ currentWorkspace: '/workspace' })
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentEvaluation.list') {
        return { suites: [{ suite, scenarios: [scenario], runs: [run] }] }
      }
      if (method === 'agentProfile.list') return { profiles: [profile] }
      if (method === 'agentVersion.list') return { versions: [version] }
      if (method === 'agentCase.list') return { cases: [agentCase] }
      if (method === 'agentEvaluation.attachCase') {
        return { run: { ...run, id: 'new-run', sourceCaseId: agentCase.id, verdict: 'pending' } }
      }
      return {}
    })
  })

  it('shows fixed tasks and real evidence, then starts a new run with the same prompt', async () => {
    const onRunScenario = vi.fn().mockResolvedValue(undefined)
    render(<AgentEvaluationsPage onRunScenario={onRunScenario} onOpenSource={vi.fn()} />)

    expect((await screen.findAllByText('Report regression')).length).toBeGreaterThan(0)
    expect(screen.getByRole('button', { name: 'New suite' })).toBeVisible()
    expect(screen.getByText('Weekly report')).toBeVisible()
    expect(screen.getByText('A complete weekly report')).toBeInTheDocument()
    expect(screen.getByText('Version 12345678')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Run this task' }))
    expect(onRunScenario).toHaveBeenCalledWith(suite.workspacePath, profile.id, version.id, scenario.prompt)
  })

  it('attaches an eligible Agent case through the typed evaluation contract', async () => {
    render(<AgentEvaluationsPage onRunScenario={vi.fn().mockResolvedValue(undefined)} onOpenSource={vi.fn()} />)
    await screen.findByText('Weekly report')
    fireEvent.click(screen.getByRole('button', { name: 'Attach case result' }))
    expect(screen.getByRole('option', { name: agentCase.name })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Capture and attach' }))
    await waitFor(() => expect(ipcClient.invoke).toHaveBeenCalledWith('agentEvaluation.attachCase', {
      suiteId: suite.id,
      scenarioId: scenario.id,
      caseId: agentCase.id,
    }))
  })

  it('copies the fixed task set to another immutable Agent version', async () => {
    const clonedSuite = {
      ...suite,
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Report regression · v2',
      versionId: version2.id,
      baselineSuiteId: suite.id,
    }
    const clonedScenario = { ...scenario, id: '00000000-0000-4000-8000-000000000004', suiteId: clonedSuite.id }
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentEvaluation.list') return { suites: [{ suite, scenarios: [scenario], runs: [run] }] }
      if (method === 'agentProfile.list') return { profiles: [profile] }
      if (method === 'agentVersion.list') return { versions: [version2, version] }
      if (method === 'agentCase.list') return { cases: [agentCase] }
      if (method === 'agentEvaluation.suite.cloneVersion') {
        return { bundle: { suite: clonedSuite, scenarios: [clonedScenario], runs: [] } }
      }
      return {}
    })
    render(<AgentEvaluationsPage onRunScenario={vi.fn().mockResolvedValue(undefined)} onOpenSource={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Evaluate another version' }))
    expect(screen.getByRole('option', { name: /v2 · Validated/ })).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Create version evaluation' }))
    await waitFor(() => expect(ipcClient.invoke).toHaveBeenCalledWith(
      'agentEvaluation.suite.cloneVersion',
      {
        sourceSuiteId: suite.id,
        targetVersionId: version2.id,
        name: 'Report regression · v2',
      },
    ))
    expect(await screen.findByRole('heading', { name: 'Report regression · v2' })).toBeVisible()
  })

  it('shows a conservative task-level comparison against the baseline version', async () => {
    const candidateSuite = {
      ...suite,
      id: '00000000-0000-4000-8000-000000000003',
      name: 'Report regression · v2',
      versionId: version2.id,
      baselineSuiteId: suite.id,
    }
    const candidateScenario = { ...scenario, id: '00000000-0000-4000-8000-000000000004', suiteId: candidateSuite.id }
    const baselineRun = { ...run, verdict: 'failed' as const }
    const candidateRun = {
      ...run,
      id: '00000000-0000-4000-8000-000000000005',
      suiteId: candidateSuite.id,
      scenarioId: candidateScenario.id,
      verdict: 'passed' as const,
      evidence: { ...run.evidence, agent: { ...run.evidence.agent!, versionId: version2.id, versionNumber: 2 } },
    }
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentEvaluation.list') return { suites: [
        { suite: candidateSuite, scenarios: [candidateScenario], runs: [candidateRun] },
        { suite, scenarios: [scenario], runs: [baselineRun] },
      ] }
      if (method === 'agentProfile.list') return { profiles: [profile] }
      if (method === 'agentVersion.list') return { versions: [version2, version] }
      if (method === 'agentCase.list') return { cases: [] }
      if (method === 'agentEvaluation.compare') return {
        comparison: {
          baselineSuiteId: suite.id,
          candidateSuiteId: candidateSuite.id,
          baselineVersionId: version.id,
          candidateVersionId: version2.id,
          outcome: 'improved',
          counts: { improved: 1, equivalent: 0, regressed: 0, insufficient: 0 },
          pairedRuns: 1,
          delta: { passRatePoints: 100, averageDurationMs: -200, inputTokens: -10, outputTokens: 0, cost: -0.001, toolCalls: 0, failedToolCalls: 0 },
          scenarios: [{
            key: 'weekly',
            name: scenario.name,
            baselineScenarioId: scenario.id,
            candidateScenarioId: candidateScenario.id,
            baselineRun: { id: baselineRun.id, verdict: 'failed', promptMatched: true, modelId: 'openai/gpt-5', metrics: baselineRun.evidence.metrics, createdAt: 1 },
            candidateRun: { id: candidateRun.id, verdict: 'passed', promptMatched: true, modelId: 'openai/gpt-5', metrics: candidateRun.evidence.metrics, createdAt: 2 },
            outcome: 'improved',
            reasons: [],
          }],
        },
      }
      return {}
    })
    render(<AgentEvaluationsPage onRunScenario={vi.fn().mockResolvedValue(undefined)} onOpenSource={vi.fn()} />)
    expect(await screen.findByText('Agent version outcome comparison')).toBeVisible()
    expect((await screen.findAllByText('Candidate improved')).length).toBeGreaterThan(0)
    expect(screen.getByText('+100 pp')).toBeVisible()
    expect(ipcClient.invoke).toHaveBeenCalledWith('agentEvaluation.compare', {
      baselineSuiteId: suite.id,
      candidateSuiteId: candidateSuite.id,
    })
    fireEvent.click(screen.getByRole('button', { name: 'Export regression report' }))
    expect(screen.getByRole('dialog', { name: 'Export Agent regression report' })).toBeVisible()
    expect(screen.getByText(/default shareable summary/i)).toBeVisible()
  })
})
