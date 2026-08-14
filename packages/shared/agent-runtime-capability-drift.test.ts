import { describe, expect, it } from 'vitest'
import { buildAgentRuntimeCapabilityDrift } from './agent-runtime-capability-drift'
import type { AgentRunHistoryItem } from './agent-run-history'

function run(overrides: Partial<AgentRunHistoryItem> = {}): AgentRunHistoryItem {
  return { sessionId: 's', sessionFile: '/s', workspacePath: '/w', title: 'Run', profileId: 'p', status: 'completed', messageCount: 1, createdAt: 1, updatedAt: 1, artifacts: [], capabilitySnapshot: { tools: ['read'], extensionTools: ['browse'], resourceSnapshot: { workspacePath: '/w', sdkVersion: '1', mode: 'selected', projectContext: 'none', selectedPackageIds: [], selectedResourceIds: [], resources: [{ id: 'skill', kind: 'skills', name: 'Research', path: '/skill', source: 'pkg', scope: 'user', origin: 'package' }], missingPackageIds: [], missingResourceIds: [], disabledResourceIds: [], capturedAt: 1 } }, runtimeEvidence: { capturedAt: 1, resourceEvidence: { capturedAt: 1, activeTools: [{ name: 'read' }, { name: 'browse' }], skills: [{ name: 'Research' }], promptTemplates: [], extensions: [], contextFiles: [], systemPromptSources: [] } }, ...overrides }
}

describe('Agent runtime capability drift', () => {
  it('recognizes an exact immutable configuration/runtime match', () => {
    expect(buildAgentRuntimeCapabilityDrift(run())).toMatchObject({ status: 'exact', missingCount: 0, unexpectedCount: 0 })
  })

  it('explains missing and unexpected capabilities', () => {
    const candidate = run()
    candidate.runtimeEvidence!.resourceEvidence!.activeTools = [{ name: 'read' }, { name: 'shell' }]
    candidate.runtimeEvidence!.resourceEvidence!.skills = []
    const result = buildAgentRuntimeCapabilityDrift(candidate)
    expect(result).toMatchObject({ status: 'drift', missingCount: 2, unexpectedCount: 1 })
    expect(result.groups.find((group) => group.group === 'tools')).toMatchObject({ missing: ['browse'], unexpected: ['shell'] })
  })

  it('marks inherited policies as partial instead of reporting false drift', () => {
    const candidate = run()
    candidate.capabilitySnapshot = { resourceSnapshot: { ...candidate.capabilitySnapshot!.resourceSnapshot!, projectContext: 'inherit' } }
    expect(buildAgentRuntimeCapabilityDrift(candidate).status).toBe('partial')
  })

  it('does not infer runtime state when older runs have no evidence', () => {
    expect(buildAgentRuntimeCapabilityDrift(run({ runtimeEvidence: undefined })).status).toBe('no-evidence')
  })
})
