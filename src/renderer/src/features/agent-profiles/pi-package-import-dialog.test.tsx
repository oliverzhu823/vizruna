import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { PiPackageImportDialog } from './pi-package-import-dialog'

vi.mock('@renderer/lib/ipc-client', () => ({ ipcClient: { invoke: vi.fn().mockResolvedValue({ adapters: [] }) } }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const plan = {
  inspectedAt: 1,
  workspacePath: '/workspace',
  packagePath: '/workspace/incoming',
  packageName: '@vizruna/imported',
  packageVersion: '0.2.0',
  sdkVersionAtExport: '0.84.1',
  artifactValid: true,
  artifactErrors: [],
  profile: { id: 'profile', name: 'Imported Agent', modelId: 'openai-codex/gpt-5.6-sol' },
  version: { id: 'version', number: 2, digest: 'abcdef1234567890', status: 'released', createdAt: 1 },
  identityStatus: 'new',
  localVersionStatus: 'candidate',
  readiness: { status: 'needs-setup', credentialsIncluded: false, checks: [
    { code: 'validation', status: 'blocked', value: 'candidate' },
    { code: 'provider-auth', status: 'action', value: 'openai-codex' },
  ] },
  missingPackageSources: ['npm:dependency'],
  canApply: true,
  credentialsIncluded: false,
} as const

describe('PiPackageImportDialog', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useUIStore.setState({ currentWorkspace: '/workspace' })
    vi.mocked(ipcClient.invoke).mockReset()
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'pi.packageStudio.import.preview') return { plan }
      if (method === 'pi.packageStudio.import.apply') return { ok: true, plan, installedSources: [] }
      return { adapters: [] }
    })
  })

  it('shows local re-evaluation and credential boundaries before applying', async () => {
    render(<PiPackageImportDialog onClose={vi.fn()} onImported={vi.fn()} />)
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'incoming' } })
    fireEvent.click(screen.getByRole('button', { name: 'Inspect' }))
    expect(await screen.findByText('Imported Agent · v2')).toBeVisible()
    expect(screen.getByText(/never marks the imported local version as validated/)).toBeVisible()
    expect(screen.getByText(/No credentials are imported/)).toBeVisible()
    expect(screen.getByText(/1 declared Package dependencies/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Apply reproduction plan' }))
    await waitFor(() => expect(ipcClient.invoke).toHaveBeenCalledWith('pi.packageStudio.import.apply', expect.objectContaining({ confirmed: true, importConfiguration: true })))
  })
})
