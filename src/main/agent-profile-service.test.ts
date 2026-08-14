import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from '@shared/agent-profile'

const mocks = vi.hoisted(() => ({
  sqliteIndex: {
    getAgentProfile: vi.fn(),
    bindSessionAgent: vi.fn(() => true),
    getSessionAgentBinding: vi.fn(),
    getLatestAgentVersion: vi.fn(),
    getAgentVersion: vi.fn(),
    saveAgentVersion: vi.fn(() => true),
  },
  collectPiResourceCenterSnapshot: vi.fn(),
  getAvailableModels: vi.fn(),
}))

vi.mock('./sqlite-index', () => ({ sqliteIndex: mocks.sqliteIndex }))
vi.mock('./pi-resource-center-service', () => ({
  collectPiResourceCenterSnapshot: mocks.collectPiResourceCenterSnapshot,
}))
vi.mock('./ipc/sdk-session', () => ({
  getActiveSdkModule: async () => ({
    ModelRuntime: {
      create: async () => ({ getAvailable: mocks.getAvailableModels }),
    },
  }),
}))

import {
  requireActiveAgentProfileSnapshot,
  resolveActiveAgentProfileSnapshot,
  inheritSessionAgentBinding,
  saveSessionAgentBinding,
  snapshotAgentProfile,
} from './agent-profile-service'

const profile: AgentProfile = {
  id: '7c2f6716-82a0-49d4-aa18-78b26d698ff5',
  name: 'Research Agent',
  systemPrompt: 'Use citations.',
  promptMode: 'append',
  tools: ['read'],
  status: 'active',
  createdAt: 10,
  updatedAt: 20,
}

describe('Agent profile session snapshots', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.sqliteIndex.bindSessionAgent.mockReturnValue(true)
    mocks.sqliteIndex.getLatestAgentVersion.mockReturnValue(null)
    mocks.getAvailableModels.mockResolvedValue([])
  })

  it('copies profile values so later edits cannot change an existing conversation', () => {
    const source = { ...profile, tools: ['read'] }
    const snapshot = snapshotAgentProfile(source, 100)

    source.tools.push('bash')
    expect(snapshot).toMatchObject({
      profileId: profile.id,
      name: 'Research Agent',
      systemPrompt: 'Use citations.',
      promptMode: 'append',
      tools: ['read'],
      capturedAt: 100,
    })
  })

  it('does not allow an archived Agent to start a new conversation', () => {
    mocks.sqliteIndex.getAgentProfile.mockReturnValue({ ...profile, status: 'archived' })

    expect(() => requireActiveAgentProfileSnapshot(profile.id)).toThrow('archived')
  })

  it('persists the captured snapshot against the new session identity', () => {
    const snapshot = snapshotAgentProfile(profile, 100)
    const binding = saveSessionAgentBinding({
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      snapshot,
    })

    expect(binding).toMatchObject({
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      profileId: profile.id,
      snapshot,
    })
    expect(mocks.sqliteIndex.bindSessionAgent).toHaveBeenCalledWith(binding)
  })

  it('resolves and freezes the effective Pi resources when a session starts', async () => {
    const selectedProfile: AgentProfile = {
      ...profile,
      resourceSelection: {
        mode: 'selected',
        packageIds: [],
        resourceIds: ['skills:user:/skills/research/SKILL.md'],
        projectContext: 'none',
      },
    }
    mocks.sqliteIndex.getAgentProfile.mockReturnValue(selectedProfile)
    mocks.collectPiResourceCenterSnapshot.mockResolvedValue({
      generatedAt: 10,
      workspacePath: '/workspace',
      runtime: { sdkVersion: '0.84.1', workerLoaded: false, projectTrusted: true },
      summary: {
        packages: 0,
        installedPackages: 0,
        extensions: 0,
        skills: 1,
        prompts: 0,
        themes: 0,
        enabledResources: 1,
        projectResources: 0,
      },
      packages: [],
      resources: {
        extensions: [],
        skills: [
          {
            id: 'skills:user:/skills/research/SKILL.md',
            kind: 'skills',
            name: 'research',
            path: '/skills/research/SKILL.md',
            source: 'user',
            scope: 'user',
            origin: 'top-level',
            enabled: true,
            configurable: false,
          },
        ],
        prompts: [],
        themes: [],
      },
      warnings: [],
    })

    const snapshot = await resolveActiveAgentProfileSnapshot(profile.id, '/workspace')

    expect(snapshot.resourceSnapshot).toMatchObject({
      mode: 'selected',
      projectContext: 'none',
      resources: [{ id: 'skills:user:/skills/research/SKILL.md', kind: 'skills' }],
    })
  })

  it('rejects a session when explicitly selected Pi resources are missing', async () => {
    mocks.sqliteIndex.getAgentProfile.mockReturnValue({
      ...profile,
      resourceSelection: {
        mode: 'selected',
        packageIds: ['user:npm:missing-kit'],
        resourceIds: ['skills:user:/missing/SKILL.md'],
        projectContext: 'none',
      },
    })
    mocks.collectPiResourceCenterSnapshot.mockResolvedValue({
      generatedAt: 10,
      workspacePath: '/workspace',
      runtime: { sdkVersion: '0.84.1', workerLoaded: false, projectTrusted: true },
      summary: { packages: 0, installedPackages: 0, extensions: 0, skills: 0, prompts: 0, themes: 0, enabledResources: 0, projectResources: 0 },
      packages: [],
      resources: { extensions: [], skills: [], prompts: [], themes: [] },
      warnings: [],
    })

    await expect(resolveActiveAgentProfileSnapshot(profile.id, '/workspace')).rejects.toThrow(
      'AGENT_PI_RESOURCES_UNMET:package-missing,resource-missing',
    )
  })

  it('rejects a session when the authorized model does not meet the Agent requirements', async () => {
    mocks.sqliteIndex.getAgentProfile.mockReturnValue({
      ...profile,
      modelId: 'provider/text-only',
      providerRequirements: { reasoning: true, imageInput: true, minContextWindow: 128_000 },
    })
    mocks.getAvailableModels.mockResolvedValue([
      {
        id: 'text-only',
        provider: 'provider',
        reasoning: false,
        input: ['text'],
        contextWindow: 32_000,
      },
    ])

    await expect(resolveActiveAgentProfileSnapshot(profile.id, '/workspace')).rejects.toThrow(
      'AGENT_PROVIDER_REQUIREMENTS_UNMET:reasoning-required,image-required,context-window-required',
    )
    expect(mocks.collectPiResourceCenterSnapshot).not.toHaveBeenCalled()
  })

  it('freezes verified provider requirements into the session snapshot', async () => {
    mocks.sqliteIndex.getAgentProfile.mockReturnValue({
      ...profile,
      modelId: 'provider/multimodal',
      providerRequirements: { reasoning: true, imageInput: true, minContextWindow: 128_000 },
    })
    mocks.getAvailableModels.mockResolvedValue([
      {
        id: 'multimodal',
        provider: 'provider',
        reasoning: true,
        input: ['text', 'image'],
        contextWindow: 200_000,
      },
    ])
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

    const snapshot = await resolveActiveAgentProfileSnapshot(profile.id, '/workspace')

    expect(snapshot.providerRequirements).toEqual({
      reasoning: true,
      imageInput: true,
      minContextWindow: 128_000,
    })
  })

  it('can start a conversation from an immutable historical Agent version', async () => {
    mocks.sqliteIndex.getAgentProfile.mockReturnValue(profile)
    mocks.sqliteIndex.getAgentVersion.mockReturnValue({
      id: '00000000-0000-4000-8000-000000000001',
      profileId: profile.id,
      number: 1,
      digest: 'version-digest',
      config: {
        name: profile.name,
        systemPrompt: 'Historical instructions',
        promptMode: 'append',
        tools: ['read'],
      },
      status: 'validated',
      createdAt: 10,
    })
    mocks.collectPiResourceCenterSnapshot.mockResolvedValue({
      generatedAt: 10,
      workspacePath: '/workspace',
      runtime: { sdkVersion: '0.84.1', workerLoaded: false, projectTrusted: true },
      summary: { packages: 0, installedPackages: 0, extensions: 0, skills: 0, prompts: 0, themes: 0, enabledResources: 0, projectResources: 0 },
      packages: [],
      resources: { extensions: [], skills: [], prompts: [], themes: [] },
      warnings: [],
    })

    const snapshot = await resolveActiveAgentProfileSnapshot(
      profile.id,
      '/workspace',
      '00000000-0000-4000-8000-000000000001',
    )

    expect(snapshot).toMatchObject({
      versionId: '00000000-0000-4000-8000-000000000001',
      versionNumber: 1,
      versionDigest: 'version-digest',
      systemPrompt: 'Historical instructions',
    })
  })

  it('carries the same snapshot into forks and clones', () => {
    const snapshot = snapshotAgentProfile(profile, 100)
    mocks.sqliteIndex.getSessionAgentBinding.mockReturnValue({
      sessionId: 'source',
      sessionFile: '/sessions/source.jsonl',
      profileId: profile.id,
      snapshot,
      createdAt: 100,
    })

    const binding = inheritSessionAgentBinding({
      sourceSessionFile: '/sessions/source.jsonl',
      sessionId: 'fork',
      sessionFile: '/sessions/fork.jsonl',
    })

    expect(binding?.snapshot).toEqual(snapshot)
    expect(binding).toMatchObject({
      sessionId: 'fork',
      sessionFile: '/sessions/fork.jsonl',
      profileId: profile.id,
    })
  })
})
