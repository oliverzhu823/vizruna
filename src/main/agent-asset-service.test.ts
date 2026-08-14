import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { AgentProfile } from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'

const mocks = vi.hoisted(() => ({
  listAgentProfiles: vi.fn(),
  listAgentVersions: vi.fn(),
  getTrustedWorkspaceRoot: vi.fn(),
}))
vi.mock('./sqlite-index', () => ({ sqliteIndex: {
  listAgentProfiles: mocks.listAgentProfiles,
  listAgentVersions: mocks.listAgentVersions,
} }))
vi.mock('./trusted-workspace', () => ({ getTrustedWorkspaceRoot: mocks.getTrustedWorkspaceRoot }))

import { buildAgentAssetCatalog } from './agent-asset-service'

const profile: AgentProfile = {
  id: '7c2f6716-82a0-49d4-aa18-78b26d698ff5',
  name: 'Research Agent',
  systemPrompt: 'Use evidence.',
  promptMode: 'append',
  status: 'active',
  createdAt: 1,
  updatedAt: 1,
}
const released: AgentVersion = {
  id: '00000000-0000-4000-8000-000000000001',
  profileId: profile.id,
  number: 1,
  digest: 'digest-1',
  config: { name: profile.name, systemPrompt: profile.systemPrompt, promptMode: 'append' },
  status: 'released',
  releasedAt: 2,
  createdAt: 1,
}

describe('Agent asset catalog service', () => {
  beforeEach(() => {
    mocks.listAgentProfiles.mockReturnValue([profile])
    mocks.listAgentVersions.mockReturnValue([released])
    mocks.getTrustedWorkspaceRoot.mockReturnValue('/workspace')
  })

  it('reports a previously exported version as missing when its managed Package is gone', () => {
    expect(buildAgentAssetCatalog('/workspace').assets[0]).toMatchObject({
      delivered: true,
      package: { status: 'missing', versionId: released.id },
    })
  })

  it('does not inspect package paths outside the active trusted workspace', () => {
    expect(() => buildAgentAssetCatalog('/other')).toThrow('active trusted workspace')
  })

  it('verifies all generated files and immutable identity before calling a Package available', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'vizruna-agent-asset-'))
    mocks.getTrustedWorkspaceRoot.mockReturnValue(workspace)
    const packagePath = join(
      workspace,
      '.vizruna',
      'pi-packages',
      `research-agent-${profile.id.replace(/-/g, '').slice(0, 8)}-v1`,
    )
    mkdirSync(join(packagePath, 'extensions'), { recursive: true })
    writeFileSync(join(packagePath, 'package.json'), '{}')
    writeFileSync(join(packagePath, 'README.md'), 'readme')
    writeFileSync(join(packagePath, 'DELIVERY_CHECKLIST.md'), 'delivery evidence')
    writeFileSync(join(packagePath, 'extensions', 'agent-profile.ts'), 'export default {}')
    writeFileSync(join(packagePath, 'vizruna-agent.json'), JSON.stringify({
      profile: { id: profile.id },
      version: { id: released.id, number: released.number, digest: released.digest },
    }))
    try {
      expect(buildAgentAssetCatalog(workspace).assets[0].package).toMatchObject({
        status: 'available',
        packagePath,
      })
      unlinkSync(join(packagePath, 'DELIVERY_CHECKLIST.md'))
      expect(buildAgentAssetCatalog(workspace).assets[0].package.status).toBe('invalid')
      writeFileSync(join(packagePath, 'DELIVERY_CHECKLIST.md'), 'delivery evidence')
      writeFileSync(join(packagePath, 'vizruna-agent.json'), '{ invalid')
      expect(buildAgentAssetCatalog(workspace).assets[0].package.status).toBe('invalid')
    } finally {
      rmSync(workspace, { recursive: true, force: true })
    }
  })
})
