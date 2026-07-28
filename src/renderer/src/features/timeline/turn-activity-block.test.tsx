import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import i18n from '@renderer/lib/i18n'
import { useUIStore } from '@renderer/stores/ui-store'
import type { TimelineDisplayItem } from './timeline-display-items'
import { TurnActivityBlock } from './turn-activity-block'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn((..._args: unknown[]) => Promise.resolve<unknown>({ adapters: [] })),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: (...args: unknown[]) => mocks.invoke(...args) },
}))

const blocks: TimelineDisplayItem[] = [
  {
    kind: 'single',
    item: { id: 'assistant-1', type: 'assistant-message', text: 'done' },
  },
]

describe('TurnActivityBlock artifact opening', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue({ ok: true })
    useUIStore.setState({
      currentWorkspace: '/workspace',
      fileChanges: [
        {
          path: '/private/tmp/HBM国产市场与头部公司尽调报告.md',
          source: 'write',
          changeType: 'created',
        },
      ],
    })
  })

  it('shows a directly reachable default-app action for an outside artifact', async () => {
    render(<TurnActivityBlock blocks={blocks} />)

    const openButton = screen.getByRole('button', { name: '用默认应用打开' })
    expect(openButton).toBeVisible()
    fireEvent.click(openButton)

    await waitFor(() => {
      expect(mocks.invoke).toHaveBeenCalledWith('shell.openPath', {
        path: '/private/tmp/HBM国产市场与头部公司尽调报告.md',
      })
    })
  })
})
