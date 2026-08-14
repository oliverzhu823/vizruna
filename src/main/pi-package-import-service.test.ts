import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AgentProfile } from '@shared/agent-profile'
import { agentVersionConfigFromProfile, serializeAgentVersionConfig } from '@shared/agent-version'

const mocks = vi.hoisted(() => ({
  profiles: [] as AgentProfile[],
  getTrustedWorkspaceRoot: vi.fn(),
  collect: vi.fn(),
  mutate: vi.fn(),
  inspectModel: vi.fn(),
  ensureVersion: vi.fn(),
  saveAgentProfile: vi.fn(),
}))
vi.mock('./audit/audit-repository', () => ({ auditRepository: { write: vi.fn() } }))
vi.mock('./trusted-workspace', () => ({ getTrustedWorkspaceRoot: mocks.getTrustedWorkspaceRoot }))
vi.mock('./pi-resource-center-service', () => ({ collectPiResourceCenterSnapshot: mocks.collect }))
vi.mock('./pi-resource-manager', () => ({ mutatePiPackage: mocks.mutate }))
vi.mock('./pi-package-studio-service', () => ({ inspectFixedModel: mocks.inspectModel }))
vi.mock('./agent-version-service', () => ({ ensureAgentVersion: mocks.ensureVersion }))
vi.mock('./sqlite-index', () => ({ sqliteIndex: {
  getAgentProfile: vi.fn(() => null),
  getAgentVersion: vi.fn(() => null),
  getLatestAgentVersion: vi.fn(() => null),
  listAgentProfiles: vi.fn(() => mocks.profiles),
  listAgentVersions: vi.fn(() => []),
  saveAgentProfile: mocks.saveAgentProfile,
} }))

import { applyPiPackageImport, previewPiPackageImport } from './pi-package-import-service'

function writePackage(workspace: string) {
  const packagePath = join(workspace, 'incoming-agent')
  mkdirSync(join(packagePath, 'extensions'), { recursive: true })
  const profile: AgentProfile = {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Imported Research Agent',
    systemPrompt: 'Verify evidence.',
    promptMode: 'append',
    modelId: 'openai-codex/gpt-5.6-sol',
    tools: ['read'],
    resourceSelection: { mode: 'selected', packageIds: ['user:npm:dep'], resourceIds: [], projectContext: 'none' },
    status: 'active',
    createdAt: 1,
    updatedAt: 2,
  }
  const digest = createHash('sha256').update(serializeAgentVersionConfig(agentVersionConfigFromProfile(profile))).digest('hex')
  const version = { id: '22222222-2222-4222-8222-222222222222', profileId: profile.id, number: 2, digest, config: agentVersionConfigFromProfile(profile), status: 'released', createdAt: 2 }
  writeFileSync(join(packagePath, 'package.json'), JSON.stringify({ name: '@vizruna/imported', version: '0.2.0', pi: { extensions: ['./extensions/agent-profile.ts'] }, vizruna: { profileId: profile.id, versionId: version.id } }))
  writeFileSync(join(packagePath, 'README.md'), 'readme')
  writeFileSync(join(packagePath, 'DELIVERY_CHECKLIST.md'), 'checklist')
  writeFileSync(join(packagePath, 'extensions/agent-profile.ts'), 'export default {}')
  writeFileSync(join(packagePath, 'vizruna-agent.json'), JSON.stringify({ schemaVersion: 1, sdkVersion: '0.84.1', profile, version, dependencies: { packages: [{ id: 'user:npm:dep', source: 'npm:dep', name: 'dep', scope: 'user', installed: true }], resources: [] } }))
  return { packagePath, profile, version }
}

describe('Pi Package import and reproduction', () => {
  let workspace = ''
  beforeEach(() => {
    workspace = mkdtempSync(join(tmpdir(), 'vizruna-import-'))
    mocks.profiles.splice(0)
    mocks.getTrustedWorkspaceRoot.mockReturnValue(workspace)
    mocks.collect.mockResolvedValue({
      runtime: { sdkVersion: '0.84.1', projectTrusted: true },
      packages: [],
      resources: { extensions: [], skills: [], prompts: [], themes: [] },
    })
    mocks.inspectModel.mockResolvedValue({ found: true, authenticated: false })
    mocks.mutate.mockResolvedValue({ workerReload: 'reloaded' })
    mocks.saveAgentProfile.mockImplementation((profile: AgentProfile) => { mocks.profiles.push(profile); return true })
    mocks.ensureVersion.mockImplementation((profile: AgentProfile) => ({ id: '33333333-3333-4333-8333-333333333333', profileId: profile.id, number: 1, digest: 'local-digest', config: agentVersionConfigFromProfile(profile), status: 'candidate', createdAt: 5 }))
  })

  it('recomputes target readiness and never trusts source release evidence locally', async () => {
    const { packagePath, version } = writePackage(workspace)
    const plan = await previewPiPackageImport({ workspaceId: workspace, packagePath }, 4)
    expect(plan).toMatchObject({ artifactValid: true, identityStatus: 'new', localVersionStatus: 'candidate', credentialsIncluded: false })
    expect(plan.version).toMatchObject({ id: version.id, status: 'released' })
    expect(plan.readiness.checks).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'validation', status: 'blocked', value: 'candidate' }),
      expect.objectContaining({ code: 'provider-auth', status: 'action' }),
      expect.objectContaining({ code: 'pi-packages', status: 'blocked' }),
    ]))
  })

  it('imports a remapped local candidate and installs only after explicit confirmation', async () => {
    const { packagePath, profile: source } = writePackage(workspace)
    const result = await applyPiPackageImport({ workspaceId: workspace, packagePath, installAgentPackage: true, installDependencies: true, importConfiguration: true, confirmed: true })
    expect(result.profile?.id).not.toBe(source.id)
    expect(result.profile?.importProvenance).toMatchObject({ sourceProfileId: source.id, sourceVersionStatus: 'released' })
    expect(result.version?.status).toBe('candidate')
    expect(mocks.mutate).toHaveBeenNthCalledWith(1, expect.objectContaining({ source: 'npm:dep', scope: 'user', confirmed: true }))
    expect(mocks.mutate).toHaveBeenNthCalledWith(2, expect.objectContaining({ source: realpathSync(packagePath), scope: 'project', confirmed: true }))
  })

  it('rejects imports outside the active trusted project', async () => {
    const outside = mkdtempSync(join(tmpdir(), 'vizruna-outside-'))
    const { packagePath } = writePackage(outside)
    await expect(previewPiPackageImport({ workspaceId: workspace, packagePath })).rejects.toThrow(/inside the active trusted workspace/)
    rmSync(outside, { recursive: true, force: true })
  })

  afterEach(() => rmSync(workspace, { recursive: true, force: true }))
})
