import { describe, expect, it } from 'vitest'
import { buildAgentCapabilityManifest } from './agent-capability-manifest'
import type { AgentProfile, AgentProfilePreviewResponse } from './agent-profile'

const profile: AgentProfile = { id: 'agent', name: 'Research', systemPrompt: 'Research', promptMode: 'append', tools: ['read', 'bash'], resourceSelection: { mode: 'selected', packageIds: ['pkg'], resourceIds: ['skill'], projectContext: 'inherit' }, status: 'active', createdAt: 1, updatedAt: 1 }
const preview: AgentProfilePreviewResponse = {
  resourceSnapshot: { workspacePath: '/workspace', sdkVersion: '0.84.1', mode: 'selected', projectContext: 'inherit', selectedPackageIds: ['pkg'], selectedResourceIds: ['skill'], resources: [{ id: 'skill', kind: 'skills', name: 'Research skill', path: '/skill', source: 'pkg', scope: 'user', origin: 'package', packageId: 'pkg' }, { id: 'ext', kind: 'extensions', name: 'Browser extension', path: '/ext', source: 'pkg', scope: 'user', origin: 'package', packageId: 'pkg' }], missingPackageIds: [], missingResourceIds: [], disabledResourceIds: [], capturedAt: 1 },
  warnings: [],
  catalog: { generatedAt: 1, workspacePath: '/workspace', runtime: { sdkVersion: '0.84.1', workerLoaded: true, projectTrusted: true }, summary: { packages: 1, installedPackages: 1, extensions: 1, skills: 1, prompts: 0, themes: 0, enabledResources: 2, projectResources: 0 }, packages: [{ id: 'pkg', source: 'npm:pkg', name: 'pkg', scope: 'user', type: 'npm', pinned: false, filtered: false, installed: true, resources: { extensions: 1, skills: 1, prompts: 0, themes: 0 } }], resources: { extensions: [{ id: 'ext', kind: 'extensions', name: 'Browser extension', path: '/ext', source: 'pkg', scope: 'user', origin: 'package', enabled: true, configurable: true, packageId: 'pkg', tools: ['browse', 'screenshot'] }], skills: [{ id: 'skill', kind: 'skills', name: 'Research skill', path: '/skill', source: 'pkg', scope: 'user', origin: 'package', enabled: true, configurable: true, packageId: 'pkg' }], prompts: [], themes: [] }, warnings: [] },
}

describe('Agent capability manifest', () => {
  it('groups resolved Pi capabilities with provenance and extension tools', () => {
    const result = buildAgentCapabilityManifest(profile, preview)
    expect(result.groups.tools.map((item) => item.name)).toEqual(['read', 'bash'])
    expect(result.groups.skills[0]).toMatchObject({ name: 'Research skill', packageId: 'pkg', status: 'ready' })
    expect(result.groups.extensions[0].details).toEqual(['browse', 'screenshot'])
    expect(result.groups.packages[0]).toMatchObject({ name: 'pkg', source: 'npm:pkg', status: 'ready' })
    expect(result.canRun).toBe(true)
  })

  it('surfaces missing packages, disabled resources and untrusted context as blockers', () => {
    const result = buildAgentCapabilityManifest({ ...profile, tools: undefined }, { ...preview, warnings: [{ code: 'project-untrusted' }, { code: 'package-missing', ids: ['pkg'] }, { code: 'resource-disabled', ids: ['skill'] }], resourceSnapshot: { ...preview.resourceSnapshot, resources: [], missingPackageIds: ['pkg'], disabledResourceIds: ['skill'] } })
    expect(result.groups.tools[0].status).toBe('inherited')
    expect(result.groups.packages[0].status).toBe('blocked')
    expect(result.groups.skills[0].status).toBe('blocked')
    expect(result.groups.context[0].status).toBe('blocked')
    expect(result.canRun).toBe(false)
  })
})
