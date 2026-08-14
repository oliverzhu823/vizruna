import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'

const mocks = vi.hoisted(() => ({
  getAgentProfile: vi.fn(),
  requireAgentVersion: vi.fn(),
  profileAtAgentVersion: vi.fn(),
  collect: vi.fn(),
  createRuntime: vi.fn(),
}))
vi.mock('./audit/audit-repository', () => ({ auditRepository: { write: vi.fn() } }))
vi.mock('./sqlite-index', () => ({ sqliteIndex: { getAgentProfile: mocks.getAgentProfile } }))
vi.mock('./agent-version-service', () => ({
  requireAgentVersion: mocks.requireAgentVersion,
  profileAtAgentVersion: mocks.profileAtAgentVersion,
  releaseAgentVersion: vi.fn(),
}))
vi.mock('./pi-resource-center-service', () => ({ collectPiResourceCenterSnapshot: mocks.collect }))
vi.mock('./pi-resource-manager', () => ({ mutatePiPackage: vi.fn() }))
vi.mock('./ipc/sdk-session', () => ({
  getActiveSdkModule: vi.fn(async () => ({ ModelRuntime: { create: mocks.createRuntime } })),
}))

import { buildPiPackageStudioPlan } from './pi-package-studio-service'

const profile: AgentProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Delivery Agent',
  systemPrompt: 'Work carefully.',
  promptMode: 'append',
  modelId: 'openai-codex/gpt-5.6-sol',
  thinkingLevel: 'high',
  tools: ['read'],
  resourceSelection: { mode: 'selected', packageIds: [], resourceIds: [], projectContext: 'none' },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}
const version: AgentVersion = {
  id: '22222222-2222-4222-8222-222222222222',
  profileId: profile.id,
  number: 2,
  digest: 'delivery-digest',
  config: {
    name: profile.name,
    systemPrompt: profile.systemPrompt,
    promptMode: profile.promptMode,
    modelId: profile.modelId,
    thinkingLevel: profile.thinkingLevel,
    tools: profile.tools,
    resourceSelection: profile.resourceSelection,
  },
  status: 'validated',
  validation: { suiteId: 'suite', runIds: ['run'], validatedAt: 3 },
  createdAt: 2,
}

describe('Pi Package target-environment readiness', () => {
  beforeEach(() => {
    mocks.getAgentProfile.mockReturnValue(profile)
    mocks.requireAgentVersion.mockReturnValue(version)
    mocks.profileAtAgentVersion.mockReturnValue(profile)
    mocks.collect.mockResolvedValue({
      generatedAt: 4,
      workspacePath: '/workspace',
      runtime: { sdkVersion: '0.84.1', workerLoaded: false, projectTrusted: true },
      summary: { packages: 0, installedPackages: 0, extensions: 0, skills: 0, prompts: 0, themes: 0, enabledResources: 0, projectResources: 0 },
      packages: [],
      resources: { extensions: [], skills: [], prompts: [], themes: [] },
      warnings: [],
    })
    mocks.createRuntime.mockResolvedValue({
      getModel: vi.fn(() => ({ id: 'gpt-5.6-sol', provider: 'openai-codex' })),
      checkAuth: vi.fn(async () => undefined),
    })
  })

  it('allows export while explicitly requiring separate target Provider authorization', async () => {
    const plan = await buildPiPackageStudioPlan({
      profileId: profile.id,
      versionId: version.id,
      workspaceId: '/workspace',
    }, 5)
    expect(plan.installable).toBe(true)
    expect(plan.delivery).toMatchObject({
      status: 'needs-setup',
      credentialsIncluded: false,
    })
    expect(plan.delivery.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'model', status: 'ready', value: profile.modelId }),
      expect.objectContaining({ code: 'provider-auth', status: 'action', value: 'openai-codex' }),
    ]))
    expect(plan.files).toContain('DELIVERY_CHECKLIST.md')
  })
})
