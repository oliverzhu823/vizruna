import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import i18n from '@renderer/lib/i18n'
import type { ProviderAuthStatus } from '@shared/provider-auth'
import { ipcClient } from '@renderer/lib/ipc-client'
import { ProviderAuthSettings } from './provider-auth-settings'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn() },
}))

const providers: ProviderAuthStatus[] = [
  {
    providerId: 'openai-codex',
    name: 'OpenAI Codex',
    methods: ['oauth'],
    configured: true,
    configuredType: 'oauth',
    storedCredential: true,
    source: 'stored',
    routeMode: 'profile',
    routeLabel: 'profile:V2RayN',
  },
  {
    providerId: 'anthropic',
    name: 'Anthropic',
    methods: ['api_key'],
    configured: true,
    configuredType: 'api_key',
    storedCredential: false,
    source: 'environment',
    sourceLabel: 'ANTHROPIC_API_KEY',
    routeMode: 'direct',
    routeLabel: 'direct',
  },
  {
    providerId: 'openrouter',
    name: 'OpenRouter',
    methods: ['oauth', 'api_key'],
    configured: false,
    storedCredential: false,
    routeMode: 'system',
    routeLabel: 'system',
  },
]

describe('ProviderAuthSettings', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('zh')
    vi.mocked(ipcClient.invoke).mockReset()
    vi.mocked(ipcClient.invoke).mockResolvedValue({ providers })
  })

  it('separates stored OAuth, ambient auth, and disconnected providers', async () => {
    render(<ProviderAuthSettings showHeader={false} />)

    expect(await screen.findByText('已登录 · OAuth 账号')).toBeInTheDocument()
    expect(screen.getByText('可用 · 环境变量 ANTHROPIC_API_KEY')).toBeInTheDocument()
    expect(screen.getByText('未登录')).toBeInTheDocument()

    // Pi /logout can remove only the credential stored in auth.json.
    expect(screen.getAllByRole('button', { name: '退出登录' })).toHaveLength(1)
  })

  it('shows only removable stored credentials in logout mode', async () => {
    render(<ProviderAuthSettings mode="logout" showHeader={false} />)

    expect(await screen.findByText('OpenAI Codex')).toBeInTheDocument()
    expect(screen.queryByText('Anthropic')).not.toBeInTheDocument()
    expect(screen.queryByText('OpenRouter')).not.toBeInTheDocument()
  })
})
