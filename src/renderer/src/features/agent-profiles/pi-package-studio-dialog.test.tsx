import { beforeEach, describe, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import type { AgentProfile } from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'
import type { PiPackageStudioPlan } from '@shared/pi-package-studio'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { PiPackageStudioDialog } from './pi-package-studio-dialog'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({ adapters: [] }) },
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

const profile: AgentProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Delivery Agent',
  systemPrompt: 'Deliver verified work.',
  promptMode: 'append',
  modelId: 'openai-codex/gpt-5.6-sol',
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}
const version: AgentVersion = {
  id: '22222222-2222-4222-8222-222222222222',
  profileId: profile.id,
  number: 1,
  digest: 'abcdef1234567890',
  config: { name: profile.name, systemPrompt: profile.systemPrompt, promptMode: 'append' },
  status: 'validated',
  createdAt: 2,
}
const plan: PiPackageStudioPlan = {
  generatedAt: 3,
  workspacePath: '/workspace',
  sdkVersion: '0.84.1',
  profile: { id: profile.id, name: profile.name, updatedAt: profile.updatedAt },
  version: { id: version.id, number: 1, digest: version.digest, status: 'validated', createdAt: 2 },
  packageName: '@vizruna/delivery-agent',
  packageVersion: '0.1.0',
  directoryName: 'delivery-agent',
  files: ['package.json', 'README.md', 'DELIVERY_CHECKLIST.md', 'vizruna-agent.json', 'extensions/agent-profile.ts'],
  installable: true,
  portable: true,
  issues: [],
  delivery: {
    status: 'needs-setup',
    credentialsIncluded: false,
    checks: [
      { code: 'validation', status: 'ready', value: 'validated' },
      { code: 'provider-auth', status: 'action', value: 'openai-codex' },
      { code: 'project-context', status: 'action' },
    ],
  },
  dependencies: { packages: [], resources: [] },
  resourceSnapshot: {
    workspacePath: '/workspace',
    sdkVersion: '0.84.1',
    mode: 'selected',
    projectContext: 'inherit',
    selectedPackageIds: [],
    selectedResourceIds: [],
    resources: [],
    missingPackageIds: [],
    missingResourceIds: [],
    disabledResourceIds: [],
    capturedAt: 3,
  },
}

describe('PiPackageStudioDialog delivery readiness', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    useUIStore.setState({ currentWorkspace: '/workspace' })
    vi.mocked(ipcClient.invoke).mockReset()
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentVersion.list') return { versions: [version] }
      if (method === 'pi.packageStudio.preview') return { plan }
      return {}
    })
  })

  it('explains target-machine actions without implying that credentials are exported', async () => {
    render(<PiPackageStudioDialog profile={profile} onClose={vi.fn()} />)
    expect(await screen.findByText('Target environment readiness')).toBeVisible()
    expect(screen.getByText('Setup required')).toBeVisible()
    expect(screen.getByText(/Sign in to openai-codex/)).toBeVisible()
    expect(screen.getByText(/No API keys, OAuth tokens, or proxy passwords are included/)).toBeVisible()
    expect(screen.getByText('DELIVERY_CHECKLIST.md')).toBeVisible()
  })
})
