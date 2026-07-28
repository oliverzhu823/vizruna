import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '@renderer/lib/i18n'
import { openWorkspaceRelativePath } from '@renderer/lib/open-workspace-path'
import { useUIStore } from '@renderer/stores/ui-store'
import { WorkspaceFilesPanel } from './workspace-files-panel'

const mocks = vi.hoisted(() => ({
  listDir: vi.fn(),
  readText: vi.fn(),
  invoke: vi.fn((..._args: unknown[]) => Promise.resolve<unknown>({ adapters: [] })),
}))

vi.mock('./use-workspace-fs', () => ({
  useWorkspaceFs: () => ({
    listDir: mocks.listDir,
    readText: mocks.readText,
  }),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => mocks.invoke(...args) },
}))

describe('WorkspaceFilesPanel cross-panel file opening', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
    mocks.listDir.mockReset()
    mocks.listDir.mockResolvedValue({ ok: true, entries: [] })
    mocks.readText.mockReset()
    mocks.readText.mockResolvedValue({
      ok: true,
      content: '# HBM 国产市场报告',
      size: 24,
    })
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue({ ok: true })
    useUIStore.setState({
      currentWorkspace: '/workspace',
      activePanel: 'review',
      rightPanelCollapsed: true,
      workspaceFileOpenRequest: null,
      filesPreviewChatExpand: false,
    })
  })

  it('keeps the file request until the lazily mounted Files panel consumes it', async () => {
    openWorkspaceRelativePath('/workspace/reports/HBM国产市场报告.md')

    expect(useUIStore.getState()).toMatchObject({
      activePanel: 'files',
      rightPanelCollapsed: false,
      workspaceFileOpenRequest: {
        rel: 'reports/HBM国产市场报告.md',
        name: 'HBM国产市场报告.md',
      },
    })

    render(<WorkspaceFilesPanel />)

    expect(await screen.findByText('HBM 国产市场报告')).toBeInTheDocument()
    expect(mocks.readText).toHaveBeenCalledWith('reports/HBM国产市场报告.md', {
      maxBytes: expect.any(Number),
    })
    await waitFor(() => {
      expect(useUIStore.getState().workspaceFileOpenRequest).toBeNull()
    })
  })

  it('opens the selected preview with the operating-system default app', async () => {
    openWorkspaceRelativePath('reports/HBM国产市场报告.md')
    render(<WorkspaceFilesPanel />)

    const openButton = await screen.findByRole('button', { name: '用默认应用打开' })
    fireEvent.click(openButton)

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('shell.openPath', {
        path: '/workspace/reports/HBM国产市场报告.md',
      })
    })
  })
})
