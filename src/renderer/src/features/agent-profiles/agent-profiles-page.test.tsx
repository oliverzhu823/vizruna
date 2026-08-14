import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { AgentProfile } from '@shared/agent-profile'
import i18n from '@renderer/lib/i18n'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useAgentProfileStore } from '@renderer/stores/agent-profile-store'
import { useUIStore } from '@renderer/stores/ui-store'
import { AgentProfilesPage } from './agent-profiles-page'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}))

const agent: AgentProfile = {
  id: '7c2f6716-82a0-49d4-aa18-78b26d698ff5',
  name: 'Research Agent',
  description: 'Evidence-first market research',
  systemPrompt: 'Use citations.',
  promptMode: 'append',
  modelId: 'openai-codex/gpt-5.6-sol',
  thinkingLevel: 'high',
  tools: ['read', 'grep'],
  status: 'active',
  createdAt: 100,
  updatedAt: 100,
}

describe('AgentProfilesPage', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
    vi.mocked(ipcClient.invoke).mockReset()
    useAgentProfileStore.setState({
      profiles: [],
      selectedProfileId: null,
      activeBinding: null,
      loading: false,
      loaded: false,
      bindingLoading: false,
    })
    useUIStore.setState({ currentWorkspace: '/workspace' })
    window.sessionStorage.clear()
  })

  it('lists configurations and starts a new conversation with the chosen Agent', async () => {
    vi.mocked(ipcClient.invoke).mockResolvedValue({ profiles: [agent] })
    const onUseAgent = vi.fn()

    render(<AgentProfilesPage onUseAgent={onUseAgent} />)

    expect(await screen.findByText('Research Agent')).toBeVisible()
    expect(screen.getByText('Evidence-first market research')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Use this Agent' }))
    expect(onUseAgent).toHaveBeenCalledWith(agent.id)
  })

  it('shows overlapping lifecycle evidence and filters delivered Agent assets', async () => {
    const building = { ...agent, id: '11111111-1111-4111-8111-111111111111', name: 'Building Agent' }
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentProfile.list') return { profiles: [agent, building] }
      if (method === 'agentAsset.list') return {
        catalog: {
          counts: { all: 2, building: 1, validated: 1, delivered: 1 },
          assets: [
            {
              profileId: agent.id,
              latestVersion: { id: 'v3', profileId: agent.id, number: 3, digest: '3', config: { name: agent.name, systemPrompt: agent.systemPrompt, promptMode: 'append' }, status: 'candidate', createdAt: 3 },
              latestValidatedVersion: { id: 'v2', profileId: agent.id, number: 2, digest: '2', config: { name: agent.name, systemPrompt: agent.systemPrompt, promptMode: 'append' }, status: 'released', createdAt: 2 },
              latestReleasedVersion: { id: 'v2', profileId: agent.id, number: 2, digest: '2', config: { name: agent.name, systemPrompt: agent.systemPrompt, promptMode: 'append' }, status: 'released', createdAt: 2 },
              building: true,
              validated: true,
              delivered: true,
              package: { status: 'missing', versionId: 'v2', versionNumber: 2 },
            },
            {
              profileId: building.id,
              latestVersion: { id: 'v1', profileId: building.id, number: 1, digest: '1', config: { name: building.name, systemPrompt: building.systemPrompt, promptMode: 'append' }, status: 'candidate', createdAt: 1 },
              building: true,
              validated: false,
              delivered: false,
              package: { status: 'not-exported' },
            },
          ],
        },
      }
      if (method === 'agentProfile.preview') return {
        resourceSnapshot: { workspacePath: '/workspace', sdkVersion: '0.84.1', mode: 'selected', projectContext: 'inherit', selectedPackageIds: ['pkg'], selectedResourceIds: ['skill'], resources: [{ id: 'skill', kind: 'skills', name: 'Research skill', path: '/skill', source: 'npm:research', scope: 'user', origin: 'package', packageId: 'pkg' }, { id: 'extension', kind: 'extensions', name: 'Browser extension', path: '/extension', source: 'npm:research', scope: 'user', origin: 'package', packageId: 'pkg' }], missingPackageIds: [], missingResourceIds: [], disabledResourceIds: [], capturedAt: 1 },
        warnings: [],
        catalog: { packages: [{ id: 'pkg', name: 'research-kit', source: 'npm:research', scope: 'user' }], resources: { extensions: [{ id: 'extension', name: 'Browser extension', kind: 'extensions', source: 'npm:research', scope: 'user', tools: ['browse'] }], skills: [], prompts: [], themes: [] } },
      }
      if (method === 'model.list') return { models: [{ id: 'gpt-5.6-sol', provider: 'openai-codex', reasoning: true, input: ['text'], contextWindow: 200000 }] }
      return {}
    })
    render(<AgentProfilesPage onUseAgent={vi.fn()} />)
    expect(await screen.findByText('Research Agent')).toBeVisible()
    expect(screen.getByText('v2 was exported; files are missing')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Delivery versions/ }))
    expect(screen.getByText('Research Agent')).toBeVisible()
    expect(screen.queryByText('Building Agent')).not.toBeInTheDocument()
    expect(screen.getByText('Showing 1 of 2 Agents')).toBeVisible()
  })

  it('opens an Agent-centered workspace with evidence-derived lifecycle and actions', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentProfile.list') return { profiles: [agent] }
      if (method === 'agentAsset.list') return {
        catalog: {
          counts: { all: 1, building: 1, validated: 0, delivered: 0 },
          assets: [{
            profileId: agent.id,
            latestVersion: { id: 'v1', profileId: agent.id, number: 1, digest: 'digest', config: { name: agent.name, systemPrompt: agent.systemPrompt, promptMode: 'append' }, status: 'candidate', createdAt: 1 },
            building: true,
            validated: false,
            delivered: false,
            package: { status: 'not-exported' },
          }],
        },
      }
      if (method === 'agentProfile.preview') return {
        resourceSnapshot: { workspacePath: '/workspace', sdkVersion: '0.84.1', mode: 'selected', projectContext: 'inherit', selectedPackageIds: ['pkg'], selectedResourceIds: ['skill'], resources: [{ id: 'skill', kind: 'skills', name: 'Research skill', path: '/skill', source: 'npm:research', scope: 'user', origin: 'package', packageId: 'pkg' }, { id: 'extension', kind: 'extensions', name: 'Browser extension', path: '/extension', source: 'npm:research', scope: 'user', origin: 'package', packageId: 'pkg' }], missingPackageIds: [], missingResourceIds: [], disabledResourceIds: [], capturedAt: 1 },
        warnings: [],
        catalog: { packages: [{ id: 'pkg', name: 'research-kit', source: 'npm:research', scope: 'user' }], resources: { extensions: [{ id: 'extension', name: 'Browser extension', kind: 'extensions', source: 'npm:research', scope: 'user', tools: ['browse'] }], skills: [], prompts: [], themes: [] } },
      }
      if (method === 'model.list') return { models: [{ id: 'gpt-5.6-sol', provider: 'openai-codex', reasoning: true, input: ['text'], contextWindow: 200000 }] }
      if (method === 'agentRun.list') return { runs: [{
        sessionId: 'session-1', sessionFile: '/sessions/one.jsonl', workspacePath: '/workspace', title: 'Research competitors', prompt: 'Research competitors in depth', profileId: agent.id, versionId: 'v1', versionNumber: 1, modelId: agent.modelId, thinkingLevel: agent.thinkingLevel, status: 'completed', messageCount: 8, createdAt: 1, updatedAt: 2, artifacts: [{ kind: 'file', name: 'report.md', path: '/workspace/report.md' }], capabilitySnapshot: { tools: ['read'], extensionTools: ['browse'], resourceSnapshot: { workspacePath: '/workspace', sdkVersion: '0.84.1', mode: 'selected', projectContext: 'none', selectedPackageIds: [], selectedResourceIds: [], resources: [{ id: 'skill', kind: 'skills', name: 'Research skill', path: '/skill', source: 'pkg', scope: 'user', origin: 'package' }], missingPackageIds: [], missingResourceIds: [], disabledResourceIds: [], capturedAt: 1 } }, runtimeEvidence: { capturedAt: 2, resourceEvidence: { capturedAt: 2, activeTools: [{ name: 'read' }, { name: 'browse' }], skills: [{ name: 'Research skill' }], promptTemplates: [], extensions: [], contextFiles: [], systemPromptSources: [] } }, turns: [{ runId: 'run-1', turnId: 'turn-1', status: 'completed', startedAt: 1, endedAt: 101, usage: { input: 100, output: 20, cacheRead: 10, cacheWrite: 0, cost: 0.01 }, tools: [{ name: 'read', calls: 2, failed: 0 }], compactions: { count: 0, tokensSaved: 0 }, files: ['/workspace/report.md'], errors: [] }],
      }, {
        sessionId: 'session-0', sessionFile: '/sessions/zero.jsonl', workspacePath: '/workspace', title: 'Earlier research', prompt: 'Earlier research', profileId: agent.id, versionId: 'v1', versionNumber: 1, status: 'failed', failureReason: 'quota', messageCount: 5, createdAt: 0, updatedAt: 1, artifacts: [],
      }] }
      if (method === 'agentCase.create') return { agentCase: { id: 'case-1' } }
      return {}
    })

    const evaluationRequest = vi.fn()
    const onOpenRunSource = vi.fn().mockResolvedValue(undefined)
    const onOpenRunArtifact = vi.fn().mockResolvedValue(undefined)
    window.addEventListener('vizruna:open-agent-evaluations', evaluationRequest, { once: true })
    render(<AgentProfilesPage onUseAgent={vi.fn()} onOpenRunSource={onOpenRunSource} onOpenRunArtifact={onOpenRunArtifact} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Research Agent' }))
    expect(screen.getByText('Agent lifecycle')).toBeVisible()
    expect(await screen.findByText('Next: create evaluation suite')).toBeVisible()
    expect(screen.getByRole('button', { name: /Create version evaluation/ })).toBeEnabled()
    expect(screen.getByText('openai-codex/gpt-5.6-sol')).toBeVisible()
    expect(await screen.findByText('Pi capabilities and dependencies')).toBeVisible()
    expect(screen.getByText('Research skill')).toBeVisible()
    expect(screen.getAllByText('browse').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('Matches configuration')).toBeVisible()
    expect(screen.getByText('Actual: read, browse')).toBeVisible()
    expect(screen.getByText('Pi evidence diagnosis')).toBeVisible()
    expect(screen.getByText('No actionable issue was found in the currently stored Pi evidence.')).toBeVisible()
    expect(screen.getByText('Per-turn Pi evidence')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: /Turn 1/ }))
    expect(screen.getByText('Actual tools: read×2')).toBeVisible()
    fireEvent.change(screen.getByRole('combobox', { name: 'Compare with another run' }), { target: { value: '/sessions/zero.jsonl' } })
    expect(screen.getByText('Pi run differences')).toBeVisible()
    expect(screen.getByText('Incomplete evidence')).toBeVisible()
    const resourcesRequest = vi.fn()
    window.addEventListener('vizruna:open-pi-resources', resourcesRequest, { once: true })
    fireEvent.click(screen.getByRole('button', { name: 'Manage Pi resources' }))
    expect(resourcesRequest).toHaveBeenCalledOnce()
    expect((await screen.findAllByText('Research competitors')).length).toBe(2)
    fireEvent.click(screen.getByRole('button', { name: 'report.md' }))
    expect(onOpenRunArtifact).toHaveBeenCalledWith('/workspace', '/workspace/report.md')
    fireEvent.click(screen.getByRole('button', { name: 'Open' }))
    expect(onOpenRunSource).toHaveBeenCalledWith('/workspace', 'session-1', '/sessions/one.jsonl')
    fireEvent.click(screen.getByRole('button', { name: 'Save case' }))
    await waitFor(() => expect(ipcClient.invoke).toHaveBeenCalledWith('agentCase.create', expect.objectContaining({ sourceSessionId: 'session-1' })))
    fireEvent.click(screen.getByRole('button', { name: 'Create evaluation' }))
    expect(evaluationRequest).toHaveBeenCalledOnce()
    fireEvent.click(screen.getByRole('button', { name: 'Back to library' }))
    expect(screen.getByText('Agent Studio')).toBeVisible()
    expect(window.sessionStorage.getItem('vizruna:agent-workspace-profile')).toBeNull()
  })

  it('blocks launch and routes repair when the local model is not authorized', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentProfile.list') return { profiles: [{ ...agent, modelId: 'provider/missing' }] }
      if (method === 'agentAsset.list') return { catalog: { counts: { all: 1, building: 0, validated: 1, delivered: 1 }, assets: [{ profileId: agent.id, latestVersion: { id: 'v1', profileId: agent.id, number: 1, digest: 'digest', config: { name: agent.name, systemPrompt: agent.systemPrompt, promptMode: 'append' }, status: 'released', createdAt: 1 }, latestValidatedVersion: { id: 'v1', profileId: agent.id, number: 1, digest: 'digest', config: { name: agent.name, systemPrompt: agent.systemPrompt, promptMode: 'append' }, status: 'released', createdAt: 1 }, latestReleasedVersion: { id: 'v1', profileId: agent.id, number: 1, digest: 'digest', config: { name: agent.name, systemPrompt: agent.systemPrompt, promptMode: 'append' }, status: 'released', createdAt: 1 }, building: false, validated: true, delivered: true, package: { status: 'available', versionId: 'v1', versionNumber: 1 } }] } }
      if (method === 'agentProfile.preview') return { resourceSnapshot: { workspacePath: '/workspace', sdkVersion: '0.84.1', mode: 'inherit', projectContext: 'inherit', selectedPackageIds: [], selectedResourceIds: [], resources: [], missingPackageIds: [], missingResourceIds: [], disabledResourceIds: [], capturedAt: 1 }, warnings: [], catalog: {} }
      if (method === 'model.list') return { models: [] }
      if (method === 'agentCase.list') return { cases: [] }
      if (method === 'agentEvaluation.list') return { suites: [] }
      return {}
    })
    const authRequest = vi.fn()
    window.addEventListener('pi-enterprise-desktop:open-provider-auth', authRequest, { once: true })
    render(<AgentProfilesPage onUseAgent={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'Research Agent' }))
    expect(await screen.findByText('Next: repair local run conditions')).toBeVisible()
    expect(window.sessionStorage.getItem('vizruna:agent-workspace-profile')).toBe(agent.id)
    expect(screen.getByRole('button', { name: 'Run latest version' })).toBeDisabled()
    window.dispatchEvent(new CustomEvent('vizruna:provider-auth-completed', { detail: { providerId: 'provider' } }))
    await waitFor(() => {
      expect(vi.mocked(ipcClient.invoke).mock.calls.filter(([method]) => method === 'model.list').length).toBeGreaterThanOrEqual(2)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Repair now' }))
    expect(authRequest).toHaveBeenCalledOnce()
  })

  it('creates an append-mode Agent with inherited runtime settings', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentProfile.list') return { profiles: [] }
      if (method === 'model.list') return { models: [] }
      if (method === 'agentProfile.preview') {
        return {
          resourceSnapshot: {
            workspacePath: '/workspace',
            sdkVersion: '0.84.1',
            mode: 'inherit',
            projectContext: 'inherit',
            selectedPackageIds: [],
            selectedResourceIds: [],
            resources: [],
            missingPackageIds: [],
            missingResourceIds: [],
            disabledResourceIds: [],
            capturedAt: 100,
          },
          warnings: [],
          catalog: {
            generatedAt: 100,
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
          },
        }
      }
      if (method === 'agentProfile.create') return { profile: agent }
      return {}
    })

    render(<AgentProfilesPage onUseAgent={vi.fn()} />)
    expect(await screen.findByText('No custom Agents yet')).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'New Agent' }))
    fireEvent.change(screen.getByPlaceholderText('For example: Market Research Agent'), {
      target: { value: 'Research Agent' },
    })
    fireEvent.change(
      screen.getByPlaceholderText(
        "Describe the Agent's role, goals, boundaries, and output requirements…",
      ),
      { target: { value: 'Use citations.' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith('agentProfile.create', {
        name: 'Research Agent',
        description: undefined,
        systemPrompt: 'Use citations.',
        promptMode: 'append',
        modelId: undefined,
        thinkingLevel: undefined,
        tools: undefined,
        resourceSelection: {
          mode: 'inherit',
          packageIds: [],
          resourceIds: [],
          projectContext: 'inherit',
        },
      })
    })
  })

  it('persists a selected Pi Package as part of the Agent configuration', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string, request?: unknown) => {
      if (method === 'agentProfile.list') return { profiles: [] }
      if (method === 'model.list') return { models: [] }
      if (method === 'agentProfile.create') return { profile: agent }
      if (method === 'agentProfile.preview') {
        const resourceSelection = (
          request as { resourceSelection?: AgentProfile['resourceSelection'] }
        )?.resourceSelection
        return {
          resourceSnapshot: {
            workspacePath: '/workspace',
            sdkVersion: '0.84.1',
            mode: resourceSelection?.mode ?? 'inherit',
            projectContext: resourceSelection?.projectContext ?? 'inherit',
            selectedPackageIds: resourceSelection?.packageIds ?? [],
            selectedResourceIds: resourceSelection?.resourceIds ?? [],
            resources: [],
            missingPackageIds: [],
            missingResourceIds: [],
            disabledResourceIds: [],
            capturedAt: 100,
          },
          warnings: [],
          catalog: {
            generatedAt: 100,
            workspacePath: '/workspace',
            runtime: { sdkVersion: '0.84.1', workerLoaded: false, projectTrusted: true },
            summary: {
              packages: 1,
              installedPackages: 1,
              extensions: 1,
              skills: 0,
              prompts: 0,
              themes: 0,
              enabledResources: 1,
              projectResources: 0,
            },
            packages: [
              {
                id: 'user:npm:research-kit',
                source: 'npm:research-kit',
                name: 'research-kit',
                scope: 'user',
                type: 'npm',
                pinned: false,
                filtered: false,
                installed: true,
                resources: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
              },
            ],
            resources: { extensions: [], skills: [], prompts: [], themes: [] },
            warnings: [],
          },
        }
      }
      return {}
    })

    render(<AgentProfilesPage onUseAgent={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New Agent' }))
    fireEvent.click(screen.getByRole('button', { name: /Use selected resources only/ }))
    fireEvent.click(await screen.findByRole('checkbox', { name: /research-kit/ }))
    fireEvent.change(screen.getByPlaceholderText('For example: Market Research Agent'), {
      target: { value: 'Research Agent' },
    })
    fireEvent.change(
      screen.getByPlaceholderText(
        "Describe the Agent's role, goals, boundaries, and output requirements…",
      ),
      { target: { value: 'Use citations.' } },
    )
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith(
        'agentProfile.create',
        expect.objectContaining({
          resourceSelection: {
            mode: 'selected',
            packageIds: ['user:npm:research-kit'],
            resourceIds: [],
            projectContext: 'inherit',
          },
        }),
      )
    })
  })

  it('blocks an incompatible model and persists verified capability requirements', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string) => {
      if (method === 'agentProfile.list') return { profiles: [] }
      if (method === 'model.list') {
        return {
          models: [
            {
              id: 'text-only',
              provider: 'provider',
              name: 'Text only',
              reasoning: false,
              input: ['text'],
              contextWindow: 32_000,
            },
            {
              id: 'vision-reasoning',
              provider: 'provider',
              name: 'Vision reasoning',
              reasoning: true,
              input: ['text', 'image'],
              contextWindow: 200_000,
            },
          ],
        }
      }
      if (method === 'agentProfile.preview') {
        return {
          resourceSnapshot: {
            workspacePath: '/workspace',
            sdkVersion: '0.84.1',
            mode: 'inherit',
            projectContext: 'inherit',
            selectedPackageIds: [],
            selectedResourceIds: [],
            resources: [],
            missingPackageIds: [],
            missingResourceIds: [],
            disabledResourceIds: [],
            capturedAt: 100,
          },
          warnings: [],
          catalog: {
            generatedAt: 100,
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
          },
        }
      }
      if (method === 'agentProfile.create') return { profile: agent }
      return {}
    })

    render(<AgentProfilesPage onUseAgent={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New Agent' }))
    fireEvent.change(screen.getByPlaceholderText('For example: Market Research Agent'), {
      target: { value: 'Vision Agent' },
    })
    fireEvent.change(
      screen.getByPlaceholderText(
        "Describe the Agent's role, goals, boundaries, and output requirements…",
      ),
      { target: { value: 'Inspect the supplied image.' } },
    )
    fireEvent.click(screen.getByRole('checkbox', { name: /Requires reasoning/ }))
    fireEvent.click(screen.getByRole('checkbox', { name: /Requires image input/ }))
    fireEvent.change(screen.getByPlaceholderText('128000'), { target: { value: '128000' } })

    await waitFor(() => {
      expect(screen.getByText('Select a fixed model before enabling capability requirements.')).toBeVisible()
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
    })

    fireEvent.change(screen.getByLabelText('Default model'), {
      target: { value: 'provider/text-only' },
    })
    expect(
      screen.getByText(
        'The selected model does not provide the reasoning capability this Agent requires.',
      ),
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()

    fireEvent.change(screen.getByLabelText('Default model'), {
      target: { value: 'provider/vision-reasoning' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith(
        'agentProfile.create',
        expect.objectContaining({
          modelId: 'provider/vision-reasoning',
          providerRequirements: {
            reasoning: true,
            imageInput: true,
            minContextWindow: 128_000,
          },
        }),
      )
    })
  })

  it('persists a fine-grained allowlist for tools registered by selected Extensions', async () => {
    vi.mocked(ipcClient.invoke).mockImplementation(async (method: string, request?: unknown) => {
      if (method === 'agentProfile.list') return { profiles: [] }
      if (method === 'model.list') return { models: [] }
      if (method === 'agentProfile.create') return { profile: agent }
      if (method === 'agentProfile.preview') {
        const resourceSelection = (
          request as { resourceSelection?: AgentProfile['resourceSelection'] }
        )?.resourceSelection
        return {
          resourceSnapshot: {
            workspacePath: '/workspace',
            sdkVersion: '0.84.1',
            mode: resourceSelection?.mode ?? 'inherit',
            projectContext: resourceSelection?.projectContext ?? 'inherit',
            selectedPackageIds: resourceSelection?.packageIds ?? [],
            selectedResourceIds: resourceSelection?.resourceIds ?? [],
            resources: [],
            missingPackageIds: [],
            missingResourceIds: [],
            disabledResourceIds: [],
            capturedAt: 100,
          },
          warnings: [],
          catalog: {
            generatedAt: 100,
            workspacePath: '/workspace',
            runtime: { sdkVersion: '0.84.1', workerLoaded: false, projectTrusted: true },
            summary: {
              packages: 0,
              installedPackages: 0,
              extensions: 1,
              skills: 0,
              prompts: 0,
              themes: 0,
              enabledResources: 1,
              projectResources: 0,
            },
            packages: [],
            resources: {
              extensions: [
                {
                  id: 'extensions:user:/extensions/search.ts',
                  kind: 'extensions',
                  name: 'search',
                  path: '/extensions/search.ts',
                  source: 'user',
                  scope: 'user',
                  origin: 'top-level',
                  enabled: true,
                  configurable: false,
                  tools: ['web_search', 'web_fetch'],
                  commands: ['search'],
                },
              ],
              skills: [],
              prompts: [],
              themes: [],
            },
            warnings: [],
          },
        }
      }
      return {}
    })

    render(<AgentProfilesPage onUseAgent={vi.fn()} />)
    fireEvent.click(await screen.findByRole('button', { name: 'New Agent' }))
    fireEvent.change(screen.getByPlaceholderText('For example: Market Research Agent'), {
      target: { value: 'Search Agent' },
    })
    fireEvent.change(
      screen.getByPlaceholderText(
        "Describe the Agent's role, goals, boundaries, and output requirements…",
      ),
      { target: { value: 'Search safely.' } },
    )
    fireEvent.click(screen.getByRole('button', { name: /Use selected resources only/ }))
    const extensionLabel = (await screen.findByText('2 registered tools')).closest('label')
    fireEvent.click(extensionLabel!.querySelector('input')!)
    fireEvent.click(screen.getByRole('button', { name: 'Choose tools' }))
    const chooseToolsButtons = screen.getAllByRole('button', { name: 'Choose tools' })
    fireEvent.click(chooseToolsButtons.at(-1)!)
    fireEvent.click(screen.getByRole('checkbox', { name: 'web_search' }))
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() => {
      expect(ipcClient.invoke).toHaveBeenCalledWith(
        'agentProfile.create',
        expect.objectContaining({
          tools: ['read', 'bash', 'edit', 'write'],
          extensionTools: ['web_search'],
          resourceSelection: expect.objectContaining({
            mode: 'selected',
            resourceIds: ['extensions:user:/extensions/search.ts'],
          }),
        }),
      )
    })
  })
})
