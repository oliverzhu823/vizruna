import { describe, expect, it, vi } from 'vitest'
import ts from 'typescript'
import type { AgentProfile } from '@shared/agent-profile'
import type { PiPackageStudioPlan } from '@shared/pi-package-studio'

vi.mock('./audit/audit-repository', () => ({ auditRepository: { write: vi.fn() } }))
vi.mock('./sqlite-index', () => ({ sqliteIndex: { getAgentProfile: vi.fn() } }))
vi.mock('./pi-resource-center-service', () => ({ collectPiResourceCenterSnapshot: vi.fn() }))
vi.mock('./pi-resource-manager', () => ({ mutatePiPackage: vi.fn() }))

import { renderPiPackageFiles } from './pi-package-studio-service'

describe('Pi Package Studio generator', () => {
  it('generates a Pi-native manifest and lifecycle extension without credentials', () => {
    const profile: AgentProfile = {
      id: '11111111-1111-4111-8111-111111111111',
      name: 'Research Agent',
      description: 'Research with evidence.',
      systemPrompt: 'Use sources and explain uncertainty.',
      promptMode: 'append',
      modelId: 'openai-codex/gpt-5.3-codex',
      thinkingLevel: 'high',
      tools: ['read', 'bash'],
      resourceSelection: { mode: 'selected', packageIds: [], resourceIds: [], projectContext: 'none' },
      status: 'active',
      createdAt: 1,
      updatedAt: 2,
    }
    const resourceSnapshot: PiPackageStudioPlan['resourceSnapshot'] = {
      workspacePath: '/project',
      sdkVersion: '0.84.1',
      mode: 'selected',
      projectContext: 'none',
      selectedPackageIds: [],
      selectedResourceIds: [],
      resources: [],
      missingPackageIds: [],
      missingResourceIds: [],
      disabledResourceIds: [],
      capturedAt: 3,
    }
    const plan: PiPackageStudioPlan = {
      generatedAt: 3,
      workspacePath: '/project',
      sdkVersion: '0.84.1',
      profile: { id: profile.id, name: profile.name, description: profile.description, updatedAt: profile.updatedAt },
      version: { id: 'version-1', number: 1, digest: 'abc123', status: 'validated', createdAt: 2 },
      packageName: '@vizruna/research-agent-11111111',
      packageVersion: '0.1.0',
      directoryName: 'research-agent-11111111',
      files: ['package.json', 'README.md', 'DELIVERY_CHECKLIST.md', 'vizruna-agent.json', 'extensions/agent-profile.ts'],
      installable: true,
      portable: true,
      issues: [],
      delivery: {
        status: 'ready',
        credentialsIncluded: false,
        checks: [
          { code: 'validation', status: 'ready', value: 'validated' },
          { code: 'runtime', status: 'ready', value: '0.84.1' },
        ],
      },
      dependencies: { packages: [], resources: [] },
      effectiveTools: ['read', 'bash'],
      resourceSnapshot,
    }
    const files = renderPiPackageFiles(profile, plan)
    const manifest = JSON.parse(files['package.json'])
    expect(manifest.pi.extensions).toEqual(['./extensions/agent-profile.ts'])
    expect(manifest.keywords).toContain('pi-package')
    expect(files['extensions/agent-profile.ts']).toContain('before_agent_start')
    expect(files['extensions/agent-profile.ts']).toContain('pi.setModel(model)')
    expect(files['extensions/agent-profile.ts']).toContain('pi.setThinkingLevel')
    expect(files['extensions/agent-profile.ts']).toContain('pi.setActiveTools')
    expect(files['DELIVERY_CHECKLIST.md']).toContain('Credential boundary')
    expect(files['DELIVERY_CHECKLIST.md']).toContain('v1 (abc123)')
    const metadata = JSON.parse(files['vizruna-agent.json'])
    expect(metadata.delivery.credentialsIncluded).toBe(false)
    const transpiled = ts.transpileModule(files['extensions/agent-profile.ts'], {
      compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
      reportDiagnostics: true,
    })
    expect(transpiled.diagnostics ?? []).toEqual([])
    expect(JSON.stringify(files)).not.toMatch(/"(?:apiKey|accessToken|oauthToken|proxyPassword)"\s*:/i)
  })
})
