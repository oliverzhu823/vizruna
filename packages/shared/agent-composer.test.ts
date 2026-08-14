import { describe, expect, it } from 'vitest'
import type { PiResourceCenterSnapshot } from './pi-resource-center'
import {
  normalizeAgentPiResourceSelection,
  resolveAgentPiResourceSnapshot,
} from './agent-composer'

const catalog: PiResourceCenterSnapshot = {
  generatedAt: 10,
  workspacePath: '/workspace',
  runtime: { sdkVersion: '0.84.1', workerLoaded: false, projectTrusted: true },
  summary: {
    packages: 1,
    installedPackages: 1,
    extensions: 1,
    skills: 2,
    prompts: 1,
    themes: 0,
    enabledResources: 3,
    projectResources: 1,
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
      resources: { extensions: 1, skills: 1, prompts: 1, themes: 0 },
    },
  ],
  resources: {
    extensions: [
      {
        id: 'extensions:user:/pkg/research.ts',
        kind: 'extensions',
        name: 'research',
        path: '/pkg/research.ts',
        source: 'npm:research-kit',
        scope: 'user',
        origin: 'package',
        enabled: true,
        packageId: 'user:npm:research-kit',
        configurable: true,
      },
    ],
    skills: [
      {
        id: 'skills:user:/pkg/citations/SKILL.md',
        kind: 'skills',
        name: 'citations',
        path: '/pkg/citations/SKILL.md',
        source: 'npm:research-kit',
        scope: 'user',
        origin: 'package',
        enabled: true,
        packageId: 'user:npm:research-kit',
        configurable: true,
      },
      {
        id: 'skills:project:/workspace/.pi/skills/private/SKILL.md',
        kind: 'skills',
        name: 'private',
        path: '/workspace/.pi/skills/private/SKILL.md',
        source: 'project',
        scope: 'project',
        origin: 'top-level',
        enabled: false,
        configurable: false,
      },
    ],
    prompts: [
      {
        id: 'prompts:user:/pkg/report.md',
        kind: 'prompts',
        name: 'report',
        path: '/pkg/report.md',
        source: 'npm:research-kit',
        scope: 'user',
        origin: 'package',
        enabled: true,
        packageId: 'user:npm:research-kit',
        configurable: true,
      },
    ],
    themes: [],
  },
  warnings: [],
}

describe('Agent Composer Pi resource resolution', () => {
  it('keeps legacy profiles on Pi inheritance defaults', () => {
    expect(normalizeAgentPiResourceSelection()).toEqual({
      mode: 'inherit',
      packageIds: [],
      resourceIds: [],
      projectContext: 'inherit',
    })
    const result = resolveAgentPiResourceSnapshot(undefined, catalog, 100)
    expect(result.resourceSnapshot.resources).toHaveLength(3)
    expect(result.resourceSnapshot.capturedAt).toBe(100)
  })

  it('expands a selected package into its enabled Pi-native resources', () => {
    const result = resolveAgentPiResourceSnapshot(
      {
        mode: 'selected',
        packageIds: ['user:npm:research-kit'],
        resourceIds: [],
        projectContext: 'none',
      },
      catalog,
      100,
    )

    expect(result.resourceSnapshot.resources.map((resource) => resource.kind).sort()).toEqual([
      'extensions',
      'prompts',
      'skills',
    ])
    expect(result.resourceSnapshot.projectContext).toBe('none')
    expect(result.warnings).toEqual([])
  })

  it('reports disabled and missing selectors without pretending they load', () => {
    const result = resolveAgentPiResourceSnapshot(
      {
        mode: 'selected',
        packageIds: ['user:npm:missing'],
        resourceIds: [
          'skills:project:/workspace/.pi/skills/private/SKILL.md',
          'skills:user:/missing/SKILL.md',
        ],
        projectContext: 'inherit',
      },
      catalog,
      100,
    )

    expect(result.resourceSnapshot.resources).toEqual([])
    expect(result.warnings.map((warning) => warning.code).sort()).toEqual([
      'package-missing',
      'resource-disabled',
      'resource-missing',
    ])
  })
})
