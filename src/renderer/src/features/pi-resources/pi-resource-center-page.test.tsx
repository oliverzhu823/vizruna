import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import type { PiResourceCenterSnapshot } from '@shared/pi-resource-center'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { PiResourceCenterPage } from './pi-resource-center-page'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
  onPiResourceOperationProgress: vi.fn(() => () => {}),
}))

const snapshot: PiResourceCenterSnapshot = {
  generatedAt: 100,
  workspacePath: '/workspace',
  runtime: { sdkVersion: '0.82.1', workerLoaded: false, projectTrusted: true },
  summary: {
    packages: 1,
    installedPackages: 1,
    extensions: 1,
    skills: 2,
    prompts: 1,
    themes: 0,
    enabledResources: 4,
    projectResources: 1,
  },
  packages: [
    {
      id: 'user:npm:@example/pi-tools@1.0.0',
      source: 'npm:@example/pi-tools@1.0.0',
      name: '@example/pi-tools',
      version: '1.0.0',
      description: 'Useful Pi resources',
      scope: 'user',
      type: 'npm',
      pinned: true,
      filtered: false,
      installed: true,
      installedPath: '/agent/npm/node_modules/@example/pi-tools',
      resources: { extensions: 1, skills: 2, prompts: 1, themes: 0 },
    },
  ],
  resources: { extensions: [], skills: [], prompts: [], themes: [] },
  warnings: [],
}

describe('PiResourceCenterPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.mocked(ipcClient.invoke).mockReset()
    vi.mocked(ipcClient.invoke).mockResolvedValue({ snapshot })
    useUIStore.setState({ currentWorkspace: '/workspace' })
  })

  it('shows Pi-native resource composition and configured package details', async () => {
    render(<PiResourceCenterPage />)

    expect(await screen.findByText('Effective resource composition')).toBeVisible()
    expect(screen.getByText('0.82.1')).toBeVisible()
    expect(ipcClient.invoke).toHaveBeenCalledWith('pi.resources.center.get', {
      workspaceId: '/workspace',
    })

    fireEvent.click(screen.getByRole('button', { name: /Packages 1/ }))
    expect(await screen.findByText('@example/pi-tools')).toBeVisible()
    expect(screen.getByText('Pinned version')).toBeVisible()
    expect(screen.getByText('Installed')).toBeVisible()
  })

  it('requires confirmation before delegating Package installation to Pi', async () => {
    render(<PiResourceCenterPage />)
    await screen.findByText('Effective resource composition')
    fireEvent.click(screen.getByRole('button', { name: /Packages 1/ }))

    const source = await screen.findByRole('textbox', { name: 'Package source' })
    fireEvent.change(source, { target: { value: 'npm:@example/new-tools' } })
    fireEvent.click(screen.getByRole('button', { name: 'Install' }))

    const dialog = screen.getByRole('dialog', { name: 'Confirm Pi Package installation' })
    expect(dialog).toBeVisible()
    expect(ipcClient.invoke).not.toHaveBeenCalledWith(
      'pi.resources.package.mutate',
      expect.anything(),
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'OK' }))
    await waitFor(() => expect(ipcClient.invoke).toHaveBeenCalledWith(
      'pi.resources.package.mutate',
      {
        workspaceId: '/workspace',
        action: 'install',
        source: 'npm:@example/new-tools',
        scope: 'user',
        confirmed: true,
      },
    ))
  })
})
