import { describe, expect, it } from 'vitest'
import type { AgentProfile, AgentPiResourceSnapshot } from './agent-profile'
import {
  buildPiDeliveryReadiness,
  buildPiPackageStudioIssues,
  piPackageSlug,
} from './pi-package-studio'

const profile: AgentProfile = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Research Agent',
  systemPrompt: 'Research carefully.',
  promptMode: 'append',
  modelId: 'openai-codex/gpt-5.3-codex',
  thinkingLevel: 'high',
  tools: ['read', 'bash'],
  resourceSelection: {
    mode: 'selected',
    packageIds: ['project:npm:research-kit'],
    resourceIds: [],
    projectContext: 'none',
  },
  status: 'active',
  createdAt: 1,
  updatedAt: 2,
}

const snapshot: AgentPiResourceSnapshot = {
  workspacePath: '/project',
  sdkVersion: '0.84.1',
  mode: 'selected',
  projectContext: 'none',
  selectedPackageIds: ['project:npm:research-kit'],
  selectedResourceIds: [],
  resources: [{
    id: 'skills:project:/kit/SKILL.md',
    kind: 'skills',
    name: 'research',
    path: '/kit/SKILL.md',
    source: 'npm:research-kit',
    scope: 'project',
    origin: 'package',
    packageId: 'project:npm:research-kit',
  }],
  missingPackageIds: [],
  missingResourceIds: [],
  disabledResourceIds: [],
  capturedAt: 3,
}

describe('Pi Package Studio planning', () => {
  it('separates export validity from target-environment setup actions', () => {
    const delivery = buildPiDeliveryReadiness({
      versionStatus: 'validated',
      sdkVersion: '0.84.1',
      modelId: 'openai-codex/gpt-5.6-sol',
      modelFound: true,
      modelAuthenticated: false,
      toolsInherited: false,
      resourcesInherited: false,
      projectContextInherited: true,
      dependencyPackages: [{ id: 'pkg', source: 'npm:pkg', name: 'pkg', scope: 'user', installed: true }],
      missingPackageCount: 0,
      externalResourceCount: 0,
      missingResourceCount: 0,
      disabledResourceCount: 0,
    })
    expect(delivery.status).toBe('needs-setup')
    expect(delivery.credentialsIncluded).toBe(false)
    expect(delivery.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'validation', status: 'ready' }),
      expect.objectContaining({ code: 'provider-auth', status: 'action', value: 'openai-codex' }),
      expect.objectContaining({ code: 'pi-packages', status: 'action', count: 1 }),
      expect.objectContaining({ code: 'project-context', status: 'action' }),
    ]))
  })

  it('blocks a target environment with a missing fixed model or resource', () => {
    const delivery = buildPiDeliveryReadiness({
      versionStatus: 'validated',
      sdkVersion: '0.84.1',
      modelId: 'provider/missing',
      modelFound: false,
      modelAuthenticated: false,
      toolsInherited: false,
      resourcesInherited: false,
      projectContextInherited: false,
      dependencyPackages: [],
      missingPackageCount: 0,
      externalResourceCount: 0,
      missingResourceCount: 1,
      disabledResourceCount: 0,
    })
    expect(delivery.status).toBe('blocked')
    expect(delivery.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'model', status: 'blocked' }),
      expect.objectContaining({ code: 'pi-resources', status: 'blocked' }),
    ]))
  })

  it('keeps native package dependencies explicit instead of claiming full portability', () => {
    const issues = buildPiPackageStudioIssues({
      profile,
      resourceSnapshot: snapshot,
      projectTrusted: true,
      versionStatus: 'validated',
      packages: [{
        id: 'project:npm:research-kit',
        source: 'npm:research-kit',
        name: 'research-kit',
        version: '1.2.3',
        scope: 'project',
        type: 'npm',
        pinned: false,
        filtered: false,
        installed: true,
        resources: { extensions: 0, skills: 1, prompts: 0, themes: 0 },
      }],
    })
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'external-package-dependencies',
      severity: 'warning',
      count: 1,
    }))
    expect(issues.some((issue) => issue.severity === 'error')).toBe(false)
  })

  it('blocks export when a selected dependency is missing', () => {
    const issues = buildPiPackageStudioIssues({
      profile,
      resourceSnapshot: snapshot,
      projectTrusted: true,
      versionStatus: 'validated',
      packages: [],
    })
    expect(issues).toContainEqual(expect.objectContaining({
      code: 'package-missing',
      severity: 'error',
    }))
  })

  it('blocks delivery packaging until the Agent version is validated', () => {
    const issues = buildPiPackageStudioIssues({
      profile,
      resourceSnapshot: snapshot,
      projectTrusted: true,
      versionStatus: 'candidate',
      packages: [{
        id: 'project:npm:research-kit',
        source: 'npm:research-kit',
        name: 'research-kit',
        scope: 'project',
        type: 'npm',
        pinned: false,
        filtered: false,
        installed: true,
        resources: { extensions: 0, skills: 1, prompts: 0, themes: 0 },
      }],
    })
    expect(issues).toContainEqual({ code: 'version-unvalidated', severity: 'error' })
  })

  it('uses a deterministic ASCII fallback for Chinese Agent names', () => {
    expect(piPackageSlug('市场调研 Agent', profile.id)).toBe('agent')
    expect(piPackageSlug('市场调研', profile.id)).toBe('agent-11111111')
  })
})
