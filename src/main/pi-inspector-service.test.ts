import { describe, expect, it, vi } from 'vitest'

vi.mock('./config-store', () => ({ configStore: {} }))
vi.mock('../extension-compat/extension-probe', () => ({ probeExtensions: vi.fn() }))
vi.mock('./system-prompt-preset-service', () => ({ getConversationConfigBinding: vi.fn() }))
vi.mock('./pi-info', () => ({ readPiInfo: vi.fn() }))
vi.mock('./pi-agent-settings-read', () => ({ readPiAgentGlobalSettingsFromDisk: vi.fn() }))
vi.mock('./provider-routing/provider-routing-service', () => ({
  getProviderRoutingService: vi.fn(),
}))
vi.mock('./worker-manager', () => ({ workerManager: {} }))
vi.mock('./pi-resources-editor', () => ({
  listSkillsOnDisk: vi.fn(() => []),
  skillStorageKey: vi.fn(),
}))
vi.mock('./pi-skill-overrides', () => ({
  getDesktopSkillOverrides: vi.fn(() => ({})),
  isSkillEnabled: vi.fn(() => true),
}))
vi.mock('./pi-prompt-catalog', () => ({
  listAgentsContextFiles: vi.fn(() => []),
  listPiBuiltinPromptFiles: vi.fn(() => []),
}))
import { buildPiInspectorSnapshot, type InspectorFacts } from './pi-inspector-service'

function facts(overrides: Partial<InspectorFacts> = {}): InspectorFacts {
  return {
    generatedAt: 100,
    workspacePath: '/workspace',
    request: { sessionId: 'session-1', sessionFile: '/sessions/one.jsonl' },
    piInfo: {
      sdkVersion: '0.82.1',
      agentDir: '/agent',
      sessionDir: '/agent/sessions',
      authStatus: 'configured',
      authProviders: [
        { provider: 'openai-codex', type: 'oauth', configured: true },
      ],
      settingsFile: '/agent/settings.json',
      modelsFile: '/agent/models.json',
    },
    runtimeState: {
      sessionId: 'session-1',
      sessionFile: '/sessions/one.jsonl',
      sessionName: 'Harness work',
      model: 'openai-codex/gpt-5.6-codex',
      thinkingLevel: 'high',
      messageCount: 4,
      isStreaming: true,
      tools: [
        { name: 'read', description: 'Read files' },
        { name: 'deploy', description: 'Deploy safely' },
      ],
    },
    persistedSession: undefined,
    contextPrompts: {
      projectTrusted: true,
      builtSystemPreview: 'Pi base prompt plus project context',
    },
    contextCatalog: [
      {
        id: 'agents:/workspace/AGENTS.md',
        category: 'agents_context',
        name: 'AGENTS.md',
        description: 'Project context',
        path: '/workspace/AGENTS.md',
        command: '',
        editable: true,
        inSystemContext: true,
      },
    ],
    skills: [
      {
        id: 'skill-1',
        name: 'release',
        source: 'project',
        enabled: true,
        loaded: true,
      },
    ],
    prompts: [
      { name: 'review', path: '/workspace/.pi/prompts/review.md', source: 'project' },
    ],
    extensions: [
      {
        id: 'project:deploy',
        name: 'deploy',
        source: 'project',
        registeredTools: ['deploy'],
        registeredCommands: [],
        hasUI: false,
        compatibility: 'headless',
        enabled: true,
        piEnabled: true,
      },
    ],
    commands: [],
    packages: [],
    routeConfig: {
      profiles: [{
        id: 'proxy-1',
        name: 'V2Ray',
        protocol: 'http',
        host: '127.0.0.1',
        port: 10809,
        passwordConfigured: false,
      }],
      routes: [{ provider: 'openai-codex', mode: 'profile', profileId: 'proxy-1' }],
      providers: [],
      systemProxyDetected: false,
    },
    binding: {
      kind: 'agent',
      sessionId: 'session-1',
      sessionFile: '/sessions/one.jsonl',
      createdAt: 90,
      snapshot: {
        profileId: 'agent-1',
        name: 'Research Agent',
        systemPrompt: 'Research carefully',
        promptMode: 'append',
        tools: ['read', 'deploy'],
        capturedAt: 80,
      },
    },
    ...overrides,
  }
}

describe('Pi inspector snapshot', () => {
  it('reports the effective runtime, route, binding, and loaded resources', () => {
    const snapshot = buildPiInspectorSnapshot(facts())

    expect(snapshot.runtime).toMatchObject({
      sdkVersion: '0.82.1',
      model: 'openai-codex/gpt-5.6-codex',
      provider: 'openai-codex',
      thinkingLevel: 'high',
      auth: { configured: true, type: 'oauth' },
      route: { mode: 'profile', label: 'V2Ray' },
    })
    expect(snapshot.configuration).toMatchObject({
      kind: 'agent',
      name: 'Research Agent',
      mode: 'append',
      toolsMode: 'custom',
    })
    expect(snapshot.resources.tools.map((tool) => tool.name)).toEqual(['read', 'deploy'])
    expect(snapshot.resources.extensions[0]).toMatchObject({ loaded: true, enabled: true })
    expect(snapshot.context.sources.at(-1)).toMatchObject({
      kind: 'agent-profile',
      label: 'Research Agent',
    })
    expect(snapshot.warnings).toEqual([])
  })

  it('does not borrow another session and explains an unloaded requested session', () => {
    const snapshot = buildPiInspectorSnapshot(
      facts({
        runtimeState: { sessionFile: '/sessions/one.jsonl', isStreaming: false },
        persistedSession: {
          model: 'zai-coding-cn/glm-5.2',
          thinkingLevel: 'high',
          messageCount: 2,
        },
        binding: null,
        contextPrompts: { projectTrusted: false },
      }),
    )

    expect(snapshot.session.loaded).toBe(false)
    expect(snapshot.runtime.model).toBe('zai-coding-cn/glm-5.2')
    expect(snapshot.runtime.thinkingLevel).toBe('high')
    expect(snapshot.session.messageCount).toBe(2)
    expect(snapshot.configuration.kind).toBe('general')
    expect(snapshot.warnings.map((warning) => warning.code)).toEqual([
      'session-not-loaded',
      'project-untrusted',
    ])
    expect(snapshot.resources.extensions[0]?.loaded).toBe(false)
  })

  it('does not report a configured package extension as loaded without a Worker', () => {
    const snapshot = buildPiInspectorSnapshot(
      facts({
        runtimeState: {},
        extensions: [
          {
            id: 'global:theme-only',
            name: 'theme-only',
            source: 'global',
            registeredTools: [],
            registeredCommands: [],
            hasUI: false,
            compatibility: 'headless',
            enabled: true,
            piEnabled: true,
            inSettingsPackages: true,
          },
        ],
      }),
    )

    expect(snapshot.resources.extensions[0]).toMatchObject({
      source: 'global',
      enabled: true,
      loaded: false,
    })
  })
})
