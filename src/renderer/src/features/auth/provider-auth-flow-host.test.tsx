import { act, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProviderAuthFlowEvent } from '@shared/provider-auth'
import i18n from '@renderer/lib/i18n'
import { ProviderAuthFlowHost } from './provider-auth-flow-host'

const mocks = vi.hoisted(() => ({
  invoke: vi.fn(),
  listener: null as ((event: ProviderAuthFlowEvent) => void) | null,
  toastInfo: vi.fn(),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: mocks.invoke },
  onProviderAuthFlow: vi.fn((listener: (event: ProviderAuthFlowEvent) => void) => {
    mocks.listener = listener
    return () => {
      mocks.listener = null
    }
  }),
}))

vi.mock('sonner', () => ({
  toast: {
    info: mocks.toastInfo,
    success: vi.fn(),
    error: vi.fn(),
    message: vi.fn(),
  },
}))

function emit(event: ProviderAuthFlowEvent): void {
  const listener = mocks.listener
  if (!listener) throw new Error('provider auth listener is not mounted')
  act(() => listener(event))
}

describe('ProviderAuthFlowHost', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
    mocks.invoke.mockReset()
    mocks.invoke.mockResolvedValue({ active: false })
    mocks.toastInfo.mockReset()
    mocks.listener = null
  })

  it('replaces the provider chooser with immediate, priority feedback', () => {
    const onFlowStarted = vi.fn()
    render(<ProviderAuthFlowHost onFlowStarted={onFlowStarted} />)

    emit({
      phase: 'started',
      flowId: '7e9e8a04-4a73-4bb7-af2f-01d15373abcc',
      providerId: 'openai-codex',
      authType: 'oauth',
    })

    expect(onFlowStarted).toHaveBeenCalledOnce()
    expect(mocks.invoke).toHaveBeenCalledWith('providerAuth.resume')
    expect(screen.getByText('正在准备登录')).toBeInTheDocument()
    expect(screen.getByText('正在启动 openai-codex 的授权流程…')).toBeInTheDocument()
    expect(screen.getByRole('dialog').parentElement).toHaveClass('z-[140]')
  })

  it('brings Pi prompt steps to the front and then shows browser waiting state', () => {
    render(<ProviderAuthFlowHost />)
    const flowId = '7e9e8a04-4a73-4bb7-af2f-01d15373abcc'

    emit({ phase: 'started', flowId, providerId: 'openai-codex', authType: 'oauth' })
    emit({
      phase: 'prompt',
      flowId,
      providerId: 'openai-codex',
      promptId: '38b27a36-e787-4b57-935f-f93f0785065c',
      prompt: {
        type: 'select',
        message: '选择授权方式',
        options: [{ id: 'browser', label: '网页授权' }],
      },
    })

    expect(screen.getByText('选择授权方式')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '网页授权' })).toBeInTheDocument()
    expect(screen.queryByText('正在准备登录')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog').parentElement).toHaveClass('z-[140]')

    emit({
      phase: 'prompt-dismiss',
      flowId,
      providerId: 'openai-codex',
      promptId: '38b27a36-e787-4b57-935f-f93f0785065c',
    })
    emit({
      phase: 'notification',
      flowId,
      providerId: 'openai-codex',
      notification: { type: 'auth_url', url: 'https://example.com/oauth' },
    })

    expect(screen.getByText('完成网页授权')).toBeInTheDocument()
    expect(screen.getByText('正在等待浏览器授权结果…')).toBeInTheDocument()
    expect(mocks.toastInfo).toHaveBeenCalledOnce()
  })
})
