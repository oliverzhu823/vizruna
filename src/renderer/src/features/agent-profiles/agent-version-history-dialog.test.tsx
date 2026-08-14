import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentProfile } from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { AgentVersionHistoryDialog } from './agent-version-history-dialog'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({ adapters: [] }) },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const profile: AgentProfile = {
  id: '31c04a55-bebf-41c2-ad5a-4fe4cdd90a48',
  name: 'Report Agent',
  systemPrompt: 'Current prompt',
  promptMode: 'append',
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}
const versions: AgentVersion[] = [
  {
    id: '00000000-0000-4000-8000-000000000002',
    profileId: profile.id,
    number: 2,
    digest: 'bbbbbbbbbbbbbbbb',
    config: { name: profile.name, systemPrompt: 'Current prompt', promptMode: 'append' },
    status: 'candidate',
    createdAt: 2,
  },
  {
    id: '00000000-0000-4000-8000-000000000001',
    profileId: profile.id,
    number: 1,
    digest: 'aaaaaaaaaaaaaaaa',
    config: { name: profile.name, systemPrompt: 'Old prompt', promptMode: 'append' },
    status: 'validated',
    createdAt: 1,
  },
]

describe('AgentVersionHistoryDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useUIStore.setState({ currentWorkspace: '/workspace' })
    vi.mocked(ipcClient.invoke).mockReset()
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentVersion.list') return { versions }
      if (method === 'agentEvaluation.list') {
        return {
          suites: [{
            suite: {
              id: 'cc93f860-8c3f-4f68-a8d5-315ebadfbccd',
              name: 'Regression',
              workspacePath: '/workspace',
              profileId: profile.id,
              versionId: versions[0].id,
              status: 'active',
              createdAt: 1,
              updatedAt: 1,
            },
            scenarios: [],
            runs: [],
          }],
        }
      }
      if (method === 'agentVersion.readiness') return { gate: { eligible: true, suiteId: 'cc93f860-8c3f-4f68-a8d5-315ebadfbccd', versionId: versions[0].id, scenarios: [], blockers: [], baselineRequired: false } }
      if (method === 'agentVersion.validate') return { version: { ...versions[0], status: 'validated' }, gate: { eligible: true, suiteId: 'suite', versionId: versions[0].id, scenarios: [], blockers: [], baselineRequired: false } }
      return {}
    })
  })

  it('shows immutable versions, configuration differences, and runs a chosen version', async () => {
    const onUse = vi.fn()
    render(<AgentVersionHistoryDialog profile={profile} onClose={vi.fn()} onUse={onUse} onChanged={vi.fn()} />)
    expect(await screen.findByText('Configuration changes from v1')).toBeVisible()
    expect(screen.getByText('Current prompt')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Use v2' }))
    expect(onUse).toHaveBeenCalledWith(versions[0].id)
  })

  it('delegates validation to the evaluation gate for the exact version', async () => {
    render(<AgentVersionHistoryDialog profile={profile} onClose={vi.fn()} onUse={vi.fn()} onChanged={vi.fn()} />)
    const button = await screen.findByRole('button', { name: 'Mark validated' })
    await waitFor(() => expect(button).toBeEnabled())
    fireEvent.click(button)
    await waitFor(() => expect(ipcClient.invoke).toHaveBeenCalledWith('agentVersion.validate', {
      versionId: versions[0].id,
      suiteId: 'cc93f860-8c3f-4f68-a8d5-315ebadfbccd',
    }))
  })

  it('explains regression blockers and prevents validation', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentVersion.list') return { versions }
      if (method === 'agentEvaluation.list') return {
        suites: [{
          suite: {
            id: 'cc93f860-8c3f-4f68-a8d5-315ebadfbccd',
            name: 'Regression',
            workspacePath: '/workspace',
            profileId: profile.id,
            versionId: versions[0].id,
            status: 'active',
            createdAt: 1,
            updatedAt: 1,
          },
          scenarios: [],
          runs: [],
        }],
      }
      if (method === 'agentVersion.readiness') return {
        gate: {
          eligible: false,
          suiteId: 'cc93f860-8c3f-4f68-a8d5-315ebadfbccd',
          versionId: versions[0].id,
          scenarios: [],
          blockers: ['comparison-regressed'],
          baselineRequired: true,
          comparisonOutcome: 'regressed',
        },
      }
      return {}
    })
    render(<AgentVersionHistoryDialog profile={profile} onClose={vi.fn()} onUse={vi.fn()} onChanged={vi.fn()} />)
    expect(await screen.findByText(/The candidate regresses against the latest validated version\./)).toBeVisible()
    expect(screen.getByText('Result against the validated baseline: regressed')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Mark validated' })).toBeDisabled()
  })
})
