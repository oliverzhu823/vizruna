import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentCase } from '@shared/agent-case'

const mocks = vi.hoisted(() => ({
  getSessionAgentBinding: vi.fn(),
  getAgentProfile: vi.fn(),
  collect: vi.fn(),
  readPiInfo: vi.fn(() => ({ sdkVersion: '0.84.1' })),
}))

vi.mock('./sqlite-index', () => ({
  sqliteIndex: {
    getSessionAgentBinding: mocks.getSessionAgentBinding,
    getAgentProfile: mocks.getAgentProfile,
  },
}))
vi.mock('./pi-resource-center-service', () => ({
  collectPiResourceCenterSnapshot: mocks.collect,
}))
vi.mock('./pi-info', () => ({ readPiInfo: mocks.readPiInfo }))

import { captureAgentCaseProvenance, verifyAgentCaseProvenance } from './agent-case-provenance'

const temporaryDirectories: string[] = []

function catalog() {
  return {
    generatedAt: 1,
    workspacePath: '/workspace',
    runtime: { sdkVersion: '0.84.1', workerLoaded: true, projectTrusted: true },
    summary: { packages: 1, installedPackages: 1, extensions: 0, skills: 1, prompts: 0, themes: 0, enabledResources: 1, projectResources: 1 },
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
    resources: { extensions: [], skills: [], prompts: [], themes: [] },
    warnings: [],
  }
}

describe('Agent Case provenance', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.getAgentProfile.mockReturnValue({ id: 'profile-1', updatedAt: 50 })
    mocks.getSessionAgentBinding.mockReturnValue({
      profileId: 'profile-1',
      snapshot: {
        profileId: 'profile-1',
        name: 'Research Agent',
        systemPrompt: 'Research.',
        promptMode: 'append',
        capturedAt: 40,
        resourceSnapshot: {
          selectedPackageIds: ['project:npm:research-kit'],
          resources: [],
        },
      },
    })
    mocks.collect.mockResolvedValue(catalog())
  })

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) {
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('captures the immutable Agent, Pi Runtime, and Package versions', async () => {
    const provenance = await captureAgentCaseProvenance({
      workspacePath: '/workspace',
      sourceSessionFile: '/sessions/s1.jsonl',
      capturedAt: 100,
    })
    expect(provenance).toMatchObject({
      capturedAt: 100,
      piRuntimeVersion: '0.84.1',
      agent: {
        profileId: 'profile-1',
        name: 'Research Agent',
        profileUpdatedAt: 50,
        snapshotCapturedAt: 40,
      },
      packages: [{ source: 'npm:research-kit', version: '1.2.3', role: 'resource-dependency' }],
    })
    expect(provenance.agent?.snapshotDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('reports a reproducible case when source, Agent, Runtime, and Package versions match', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'vizruna-case-'))
    temporaryDirectories.push(directory)
    const sourceSessionFile = join(directory, 'session.jsonl')
    writeFileSync(sourceSessionFile, '{}\n')
    const agentCase: AgentCase = {
      id: 'case-1',
      name: 'Research',
      tags: [],
      status: 'draft',
      workspacePath: '/workspace',
      sourceSessionId: 's1',
      sourceSessionFile,
      provenance: {
        capturedAt: 100,
        piRuntimeVersion: '0.84.1',
        agent: {
          profileId: 'profile-1',
          name: 'Research Agent',
          profileUpdatedAt: 50,
          snapshotCapturedAt: 40,
          snapshotDigest: 'abc',
        },
        packages: [{
          id: 'project:npm:research-kit',
          source: 'npm:research-kit',
          name: 'research-kit',
          version: '1.2.3',
          scope: 'project',
          role: 'resource-dependency',
        }],
      },
      createdAt: 100,
      updatedAt: 100,
    }
    const verification = await verifyAgentCaseProvenance(agentCase, 200)
    expect(verification.reproducible).toBe(true)
    expect(verification.checks.every((check) => check.status !== 'failed')).toBe(true)
  })
})
