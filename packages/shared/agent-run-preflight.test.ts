import { describe, expect, it } from 'vitest'
import { buildAgentRunPreflight } from './agent-run-preflight'

const profile = { id: 'a', name: 'Agent', systemPrompt: 'Do it', promptMode: 'append' as const, modelId: 'p/m', tools: ['read'], resourceSelection: { mode: 'selected' as const, packageIds: ['pkg'], resourceIds: [], projectContext: 'none' as const }, status: 'active' as const, createdAt: 1, updatedAt: 1 }
const preview = { resourceSnapshot: { workspacePath: '/w', sdkVersion: '0.84.1', mode: 'selected' as const, projectContext: 'none' as const, selectedPackageIds: ['pkg'], selectedResourceIds: [], resources: [], missingPackageIds: [], missingResourceIds: [], disabledResourceIds: [], capturedAt: 1 }, warnings: [], catalog: {} as never }
const model = { id: 'm', provider: 'p', reasoning: false, input: ['text' as const], contextWindow: 1000 }

describe('buildAgentRunPreflight', () => {
  it('allows a fully explicit locally available Agent', () => {
    expect(buildAgentRunPreflight({ profile, preview, availableModels: [model] })).toMatchObject({ status: 'ready', canRun: true })
  })

  it('blocks unavailable explicit models and missing resources', () => {
    const result = buildAgentRunPreflight({ profile, preview: { ...preview, warnings: [{ code: 'package-missing', ids: ['pkg'] }] }, availableModels: [] })
    expect(result.status).toBe('blocked')
    expect(result.checks.filter((check) => check.status === 'blocked').map((check) => check.code)).toEqual(['model', 'resources'])
  })

  it('keeps inherited values runnable but marks them as machine-dependent setup', () => {
    const inherited = { ...profile, modelId: undefined, tools: undefined, resourceSelection: undefined }
    const result = buildAgentRunPreflight({ profile: inherited, preview: { ...preview, resourceSnapshot: { ...preview.resourceSnapshot, mode: 'inherit' } }, availableModels: [] })
    expect(result.status).toBe('needs-setup')
    expect(result.canRun).toBe(true)
  })
})
