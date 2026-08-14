import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile, SessionAgentBinding } from '@shared/agent-profile'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (request: Record<string, unknown>) => Promise<unknown>>()
  return {
    handlers,
    sqliteIndex: {
      listAgentProfiles: vi.fn(() => []),
      getAgentProfile: vi.fn(),
      saveAgentProfile: vi.fn(() => true),
    },
    getSessionAgentBinding: vi.fn(),
    collectPiResourceCenterSnapshot: vi.fn(),
    buildPiPackageStudioPlan: vi.fn(),
    exportPiPackage: vi.fn(),
    previewPiPackageImport: vi.fn(),
    applyPiPackageImport: vi.fn(),
    auditWrite: vi.fn(),
    ensureAgentVersion: vi.fn((profile: AgentProfile) => ({
      id: '00000000-0000-4000-8000-000000000001',
      profileId: profile.id,
      number: 1,
      digest: 'digest-1',
      config: {},
      status: 'candidate',
      createdAt: profile.updatedAt,
    })),
  }
})

vi.mock('../registry', () => ({
  registerHandlerWithSchema: (
    channel: string,
    schema: { parse: (request: unknown) => Record<string, unknown> },
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => {
    mocks.handlers.set(channel, (request) => handler(schema.parse(request)))
  },
}))

vi.mock('../../sqlite-index', () => ({ sqliteIndex: mocks.sqliteIndex }))
vi.mock('../../agent-profile-service', () => ({
  getSessionAgentBinding: mocks.getSessionAgentBinding,
}))
vi.mock('../../agent-version-service', () => ({
  ensureAgentVersion: mocks.ensureAgentVersion,
}))
vi.mock('../../pi-resource-center-service', () => ({
  collectPiResourceCenterSnapshot: mocks.collectPiResourceCenterSnapshot,
}))
vi.mock('../../pi-package-studio-service', () => ({
  buildPiPackageStudioPlan: mocks.buildPiPackageStudioPlan,
  exportPiPackage: mocks.exportPiPackage,
}))
vi.mock('../../pi-package-import-service', () => ({
  previewPiPackageImport: mocks.previewPiPackageImport,
  applyPiPackageImport: mocks.applyPiPackageImport,
}))
vi.mock('../../audit/audit-repository', () => ({
  auditRepository: { write: mocks.auditWrite },
}))

import { registerAgentProfileHandlers } from './agent-profile'

const profileId = '7c2f6716-82a0-49d4-aa18-78b26d698ff5'
const existingProfile: AgentProfile = {
  id: profileId,
  name: 'Research Agent',
  description: 'Research with citations',
  systemPrompt: 'Use authoritative sources and cite every conclusion.',
  promptMode: 'append',
  modelId: 'openai-codex/gpt-5.6-sol',
  thinkingLevel: 'high',
  tools: ['read', 'grep'],
  status: 'active',
  createdAt: 100,
  updatedAt: 100,
}

describe('Agent Profile IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.sqliteIndex.getAgentProfile.mockReturnValue(existingProfile)
    mocks.sqliteIndex.saveAgentProfile.mockReturnValue(true)
    registerAgentProfileHandlers()
  })

  it('creates a reusable active Agent configuration', async () => {
    const handler = mocks.handlers.get('ipc:agentProfile.create')!
    const response = (await handler({
      name: ' Research Agent ',
      description: ' Evidence-first research ',
      systemPrompt: ' Always cite sources. ',
      promptMode: 'append',
      modelId: 'openai-codex/gpt-5.6-sol',
      thinkingLevel: 'high',
      tools: ['read', 'read', 'grep'],
      extensionTools: ['web_search', 'web_search'],
      resourceSelection: {
        mode: 'selected',
        packageIds: ['user:npm:research-kit'],
        resourceIds: [],
        projectContext: 'inherit',
      },
      providerRequirements: {
        reasoning: true,
        imageInput: false,
        minContextWindow: 128000,
      },
    })) as { profile: AgentProfile }

    expect(response.profile).toMatchObject({
      name: 'Research Agent',
      description: 'Evidence-first research',
      systemPrompt: 'Always cite sources.',
      promptMode: 'append',
      status: 'active',
      tools: ['read', 'grep'],
      extensionTools: ['web_search'],
      resourceSelection: {
        mode: 'selected',
        packageIds: ['user:npm:research-kit'],
      },
      providerRequirements: {
        reasoning: true,
        imageInput: false,
        minContextWindow: 128000,
      },
    })
    expect(response.profile.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(mocks.sqliteIndex.saveAgentProfile).toHaveBeenCalledWith(response.profile)
    expect(mocks.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent-profile.create', outcome: 'success' }),
    )
  })

  it('can clear inherited model, thinking and tool overrides while editing', async () => {
    const handler = mocks.handlers.get('ipc:agentProfile.update')!
    const response = (await handler({
      id: profileId,
      modelId: null,
      thinkingLevel: null,
      tools: null,
      extensionTools: null,
    })) as { profile: AgentProfile }

    expect(response.profile.modelId).toBeUndefined()
    expect(response.profile.thinkingLevel).toBeUndefined()
    expect(response.profile.tools).toBeUndefined()
    expect(response.profile.extensionTools).toBeUndefined()
    expect(response.profile.systemPrompt).toBe(existingProfile.systemPrompt)
  })

  it('requires a fixed model when provider capability requirements are enabled', async () => {
    const handler = mocks.handlers.get('ipc:agentProfile.create')!

    await expect(
      handler({
        name: 'Vision Agent',
        systemPrompt: 'Inspect images.',
        promptMode: 'append',
        providerRequirements: { reasoning: false, imageInput: true },
      }),
    ).rejects.toThrow('AGENT_MODEL_REQUIRED')
    expect(mocks.sqliteIndex.saveAgentProfile).not.toHaveBeenCalled()
  })

  it('archives without deleting profiles', async () => {
    const handler = mocks.handlers.get('ipc:agentProfile.archive')!
    const response = (await handler({ id: profileId })) as { profile: AgentProfile }

    expect(response.profile.status).toBe('archived')
    expect(mocks.sqliteIndex.saveAgentProfile).toHaveBeenCalledOnce()
    expect(mocks.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'agent-profile.archive', outcome: 'success' }),
    )
  })

  it('previews the Pi resources that would be frozen into a new session', async () => {
    mocks.collectPiResourceCenterSnapshot.mockResolvedValue({
      generatedAt: 10,
      workspacePath: '/workspace',
      runtime: { sdkVersion: '0.84.1', workerLoaded: false, projectTrusted: true },
      summary: {
        packages: 0,
        installedPackages: 0,
        extensions: 0,
        skills: 0,
        prompts: 0,
        themes: 0,
        enabledResources: 0,
        projectResources: 0,
      },
      packages: [],
      resources: { extensions: [], skills: [], prompts: [], themes: [] },
      warnings: [],
    })
    const handler = mocks.handlers.get('ipc:agentProfile.preview')!

    const response = await handler({
      workspaceId: '/workspace',
      resourceSelection: {
        mode: 'selected',
        packageIds: [],
        resourceIds: [],
        projectContext: 'inherit',
      },
    })

    expect(response).toMatchObject({
      resourceSnapshot: { workspacePath: '/workspace', mode: 'selected', resources: [] },
      warnings: [{ code: 'empty-selection' }],
    })
  })

  it('returns the immutable Agent snapshot bound to a conversation', async () => {
    const binding: SessionAgentBinding = {
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      profileId,
      snapshot: {
        profileId,
        name: existingProfile.name,
        systemPrompt: existingProfile.systemPrompt,
        promptMode: existingProfile.promptMode,
        capturedAt: 120,
      },
      createdAt: 120,
    }
    mocks.getSessionAgentBinding.mockReturnValue(binding)
    const handler = mocks.handlers.get('ipc:agentProfile.binding.get')!

    await expect(
      handler({ sessionId: 'session-1', sessionFile: '/sessions/session-1.jsonl' }),
    ).resolves.toEqual({ binding })
  })

  it('delegates Package Studio preview and confirmed export through typed handlers', async () => {
    const plan = { profile: { id: profileId }, installable: true }
    mocks.buildPiPackageStudioPlan.mockResolvedValue(plan)
    mocks.exportPiPackage.mockResolvedValue({ ok: true, plan, packagePath: '/workspace/package' })

    await expect(
      mocks.handlers.get('ipc:pi.packageStudio.preview')!({
        profileId,
        versionId: '00000000-0000-4000-8000-000000000001',
        workspaceId: '/workspace',
      }),
    ).resolves.toEqual({ plan })
    await expect(
      mocks.handlers.get('ipc:pi.packageStudio.export')!({
        profileId,
        versionId: '00000000-0000-4000-8000-000000000001',
        workspaceId: '/workspace',
        install: true,
        confirmed: true,
      }),
    ).resolves.toMatchObject({ ok: true, packagePath: '/workspace/package' })
  })

  it('delegates Package import inspection and confirmed reproduction through typed handlers', async () => {
    const plan = { packagePath: '/workspace/incoming', artifactValid: true, canApply: true }
    mocks.previewPiPackageImport.mockResolvedValue(plan)
    mocks.applyPiPackageImport.mockResolvedValue({ ok: true, plan, installedSources: [] })
    await expect(mocks.handlers.get('ipc:pi.packageStudio.import.preview')!({
      workspaceId: '/workspace',
      packagePath: 'incoming',
    })).resolves.toEqual({ plan })
    await expect(mocks.handlers.get('ipc:pi.packageStudio.import.apply')!({
      workspaceId: '/workspace',
      packagePath: 'incoming',
      installAgentPackage: true,
      installDependencies: true,
      importConfiguration: true,
      confirmed: true,
    })).resolves.toMatchObject({ ok: true, plan })
  })

  it('rejects invalid prompt modes before storage', async () => {
    const handler = mocks.handlers.get('ipc:agentProfile.create')!

    expect(() =>
      handler({
        name: 'Unsafe Agent',
        systemPrompt: 'Prompt',
        promptMode: 'dynamic',
      }),
    ).toThrow()
    expect(mocks.sqliteIndex.saveAgentProfile).not.toHaveBeenCalled()
  })
})
