import { describe, expect, it, vi } from 'vitest'

vi.mock('./config-store', () => ({ configStore: {} }))
vi.mock('./worker-manager', () => ({ workerManager: {} }))
vi.mock('./pi-info', () => ({ readPiInfo: vi.fn() }))
vi.mock('./ipc/sdk-session', () => ({ getActiveSdkModule: vi.fn() }))

import {
  buildPiResourceCenterSnapshot,
  type PiResourceCenterFacts,
} from './pi-resource-center-service'

function facts(overrides: Partial<PiResourceCenterFacts> = {}): PiResourceCenterFacts {
  return {
    generatedAt: 100,
    workspacePath: '/workspace',
    sdkVersion: '0.82.1',
    workerLoaded: true,
    projectTrusted: true,
    packages: [
      {
        source: 'npm:@example/pi-tools@1.2.3',
        scope: 'user',
        filtered: true,
        installedPath: '/tmp',
      },
      {
        source: 'git:github.com/example/project-agent@v2',
        scope: 'project',
        filtered: false,
      },
    ],
    resolved: {
      extensions: [
        {
          path: '/tmp/extensions/search.ts',
          enabled: true,
          metadata: {
            source: 'npm:@example/pi-tools@1.2.3',
            scope: 'user',
            origin: 'package',
            baseDir: '/tmp',
          },
        },
      ],
      skills: [
        {
          path: '/workspace/.pi/skills/release/SKILL.md',
          enabled: false,
          metadata: {
            source: '/workspace/.pi/skills/release/SKILL.md',
            scope: 'project',
            origin: 'top-level',
          },
        },
      ],
      prompts: [],
      themes: [],
    },
    packageMetadata: {
      'user:npm:@example/pi-tools@1.2.3': {
        name: '@example/pi-tools',
        description: 'Pi tools',
        version: '1.2.3',
      },
    },
    extensionProbes: [
      {
        id: 'package:@example/pi-tools',
        name: '@example/pi-tools',
        source: 'package',
        registeredTools: ['web_search', 'web_fetch'],
        registeredCommands: ['search'],
        hasUI: false,
        compatibility: 'headless',
        enabled: true,
        packageRoot: '/tmp',
        mainFilePath: '/tmp/extensions/search.ts',
      },
    ],
    ...overrides,
  }
}

describe('Pi resource center snapshot', () => {
  it('groups Pi-native resources by package, scope, and effective state', () => {
    const snapshot = buildPiResourceCenterSnapshot(facts())

    expect(snapshot.summary).toMatchObject({
      packages: 2,
      installedPackages: 1,
      extensions: 1,
      skills: 1,
      enabledResources: 1,
      projectResources: 1,
    })
    expect(snapshot.packages[0]).toMatchObject({
      name: '@example/pi-tools',
      type: 'npm',
      pinned: true,
      filtered: true,
      installed: true,
      resources: { extensions: 1, skills: 0, prompts: 0, themes: 0 },
    })
    expect(snapshot.resources.extensions[0]).toMatchObject({
      name: 'search',
      packageId: 'user:npm:@example/pi-tools@1.2.3',
      enabled: true,
      relativePath: 'extensions/search.ts',
      configurable: true,
      tools: ['web_search', 'web_fetch'],
      commands: ['search'],
    })
    expect(snapshot.resources.skills[0]).toMatchObject({
      name: 'release',
      scope: 'project',
      origin: 'top-level',
      enabled: false,
      configurable: false,
    })
    expect(snapshot.warnings).toEqual([
      expect.objectContaining({
        code: 'package-missing',
        packageId: 'project:git:github.com/example/project-agent@v2',
      }),
    ])
  })

  it('surfaces trust and resolver failures without inventing loaded resources', () => {
    const snapshot = buildPiResourceCenterSnapshot(
      facts({
        projectTrusted: false,
        workerLoaded: false,
        resolved: { extensions: [], skills: [], prompts: [], themes: [] },
        resolveError: 'Package resolution failed',
      }),
    )

    expect(snapshot.runtime).toMatchObject({ workerLoaded: false, projectTrusted: false })
    expect(snapshot.summary.enabledResources).toBe(0)
    expect(snapshot.warnings.map((warning) => warning.code)).toEqual([
      'project-untrusted',
      'package-missing',
      'resolve-error',
    ])
  })
})
