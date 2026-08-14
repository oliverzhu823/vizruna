import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import i18n from '@renderer/lib/i18n'
import { RightPanelTabs } from '../right-panel-tabs'

function TestIcon({ className }: { className?: string }) {
  return <svg className={className} aria-hidden="true" />
}

describe('RightPanelTabs', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('groups every panel without horizontal navigation and switches on click', async () => {
    const user = userEvent.setup()
    const setActivePanel = vi.fn()

    render(
      <RightPanelTabs
        panels={[
          { key: 'run', label: 'Run', icon: TestIcon },
          { key: 'files', label: '文件', icon: TestIcon },
          { key: 'adapter:test', label: '测试扩展', icon: TestIcon },
        ]}
        activePanel="run"
        setActivePanel={setActivePanel}
      />,
    )

    expect(screen.getByText('会话与运行')).toBeInTheDocument()
    expect(screen.getByText('项目工作区')).toBeInTheDocument()
    expect(screen.getByText('扩展工具')).toBeInTheDocument()
    expect(screen.queryByLabelText('向左浏览面板')).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: '文件' }))
    expect(setActivePanel).toHaveBeenCalledOnce()
    expect(setActivePanel).toHaveBeenCalledWith('files')
  })
})
