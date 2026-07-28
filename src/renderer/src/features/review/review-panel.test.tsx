import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import { ReviewPanel } from './review-panel'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn((..._args: unknown[]) => Promise.resolve<unknown>({ adapters: [] })),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => mocks.invoke(...args) },
  onGitWorkspaceChanged: () => () => {},
}))

describe('ReviewPanel artifact content', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
    mocks.invoke.mockReset()
    mocks.invoke.mockImplementation((method: unknown) => {
      if (method === 'review.readArtifactText') {
        return Promise.resolve({ ok: true, content: '# HBM 尽调报告\n\n正文', size: 22 })
      }
      return Promise.resolve({ ok: true })
    })
    useUIStore.setState({
      currentWorkspace: '/workspace',
      fileChanges: [
        {
          path: '/private/tmp/HBM国产市场与头部公司尽调报告.md',
          source: 'write',
          changeType: 'created',
        },
      ],
      reviewFileOpenRequest: null,
    })
  })

  it('consumes a pending Review request and displays an outside Markdown artifact', async () => {
    useUIStore.getState().requestReviewFileOpen(
      'session',
      '/private/tmp/HBM国产市场与头部公司尽调报告.md',
    )

    render(<ReviewPanel />)

    expect(await screen.findByRole('heading', { name: 'HBM 尽调报告' })).toBeVisible()
    expect(screen.getByText('正文')).toBeVisible()
    await waitFor(() => expect(useUIStore.getState().reviewFileOpenRequest).toBeNull())
    expect(mocks.invoke).toHaveBeenCalledWith('review.readArtifactText', {
      path: '/private/tmp/HBM国产市场与头部公司尽调报告.md',
      maxBytes: 1024 * 1024,
    })
  })

  it('uses the clicked timeline artifact when history did not restore fileChanges', async () => {
    useUIStore.setState({ fileChanges: [] })
    useUIStore.getState().requestReviewFileOpen(
      'session',
      '/private/tmp/HBM国产市场与头部公司尽调报告.md',
    )

    render(<ReviewPanel />)

    expect(await screen.findByRole('heading', { name: 'HBM 尽调报告' })).toBeVisible()
    expect(screen.getByText('本对话累计 1 个文件')).toBeVisible()
  })
})
