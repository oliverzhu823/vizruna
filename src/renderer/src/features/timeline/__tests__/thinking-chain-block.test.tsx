import { beforeEach, describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '@renderer/lib/i18n'
import { ThinkingChainBlock } from '../thinking-chain-block'

describe('ThinkingChainBlock', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
  })

  it('uses a clear fixed label while waiting for or streaming a response', () => {
    const { rerender } = render(
      <ThinkingChainBlock text="" streaming placeholder />,
    )

    expect(screen.getByText('正在思考')).toBeInTheDocument()
    expect(screen.queryByText('短暂思考')).not.toBeInTheDocument()

    rerender(<ThinkingChainBlock text="分析中" streaming />)

    expect(screen.getByText('正在思考')).toBeInTheDocument()
    expect(screen.queryByText('短暂思考')).not.toBeInTheDocument()
  })
})
