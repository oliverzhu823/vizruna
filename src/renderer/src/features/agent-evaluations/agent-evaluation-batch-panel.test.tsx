import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentEvaluationBatch, AgentEvaluationSuiteBundle } from '@shared/agent-evaluation'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn() } }))
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string, values?: Record<string, unknown>) => values ? `${key}:${JSON.stringify(values)}` : key }) }))

import { ipcClient } from '@renderer/lib/ipc-client'
import { AgentEvaluationBatchPanel } from './agent-evaluation-batch-panel'

const bundle: AgentEvaluationSuiteBundle = {
  suite: {
    id: '3b220caf-acdd-4cf4-9903-95fb12022c2c',
    name: 'Regression',
    workspacePath: '/workspace',
    profileId: '415a3d97-d6c6-4b10-a258-2a3c914d4685',
    versionId: '7319b6c4-7780-4eef-b2b9-e8836f63600d',
    status: 'active',
    createdAt: 1,
    updatedAt: 1,
  },
  scenarios: [{
    id: '31f8d5a5-3202-4785-8ee5-29af30fa5ab1',
    suiteId: '3b220caf-acdd-4cf4-9903-95fb12022c2c',
    name: 'Evidence report',
    prompt: 'Produce evidence',
    tags: [],
    sortOrder: 0,
    createdAt: 1,
    updatedAt: 1,
  }],
  runs: [],
}

const queued: AgentEvaluationBatch = {
  id: '3d418345-71d1-4e5c-87da-a95064f10a11',
  suiteId: bundle.suite.id,
  workspacePath: '/workspace',
  profileId: bundle.suite.profileId,
  versionId: bundle.suite.versionId!,
  status: 'queued',
  items: [{ scenarioId: bundle.scenarios[0].id, scenarioName: 'Evidence report', status: 'pending' }],
  createdAt: 1,
}

describe('AgentEvaluationBatchPanel', () => {
  beforeEach(() => vi.clearAllMocks())

  it('requires explicit cost confirmation before starting real Pi runs', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method) => {
      if (method === 'agentEvaluation.batch.latest') return { batch: null }
      if (method === 'agentEvaluation.batch.start') return { batch: queued }
      throw new Error(`unexpected ${method}`)
    })
    render(<AgentEvaluationBatchPanel bundle={bundle} canRun onRunsChanged={vi.fn()} />)
    await waitFor(() => expect(ipcClient.invoke).toHaveBeenCalledWith('agentEvaluation.batch.latest', { suiteId: bundle.suite.id }))

    fireEvent.click(screen.getByRole('button', { name: 'batch.start' }))
    expect(screen.getByRole('dialog', { name: 'batch.confirmTitle' })).toBeInTheDocument()
    expect(screen.getByText('batch.costNotice')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'batch.confirm' }))

    await waitFor(() => expect(ipcClient.invoke).toHaveBeenCalledWith('agentEvaluation.batch.start', { suiteId: bundle.suite.id }))
    expect(await screen.findByText('batch.status.queued')).toBeInTheDocument()
  })
})
