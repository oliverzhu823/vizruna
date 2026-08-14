import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  trustedWorkspace: '/workspace' as string | null,
  progressCallback: undefined as ((event: unknown) => void) | undefined,
  installAndPersist: vi.fn(),
  removeAndPersist: vi.fn(),
  update: vi.fn(),
  flush: vi.fn(),
  setPackages: vi.fn(),
    reloadResources: vi.fn(),
    runningSessions: [] as Array<{ sessionFile: string; running: boolean; cwd: string }>,
  auditWrite: vi.fn(),
  emitRuntimeEvent: vi.fn(),
  collectSnapshot: vi.fn(),
  configured: [
    { source: 'npm:@example/tools', scope: 'user', filtered: false },
  ],
}))

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [] },
}))
vi.mock('./trusted-workspace', () => ({
  getTrustedWorkspaceRoot: () => mocks.trustedWorkspace,
}))
vi.mock('./worker-manager', () => ({
  workerManager: {
    isRunning: true,
    cwd: '/workspace',
    reloadResources: mocks.reloadResources,
    listSessionRuntime: () => mocks.runningSessions,
  },
}))
vi.mock('./audit/audit-repository', () => ({
  auditRepository: { write: mocks.auditWrite },
}))
vi.mock('./runtime-event-bus', () => ({
  emitRuntimeEvent: mocks.emitRuntimeEvent,
}))
vi.mock('./pi-resource-center-service', () => ({
  collectPiResourceCenterSnapshot: mocks.collectSnapshot,
}))
vi.mock('./ipc/sdk-session', () => ({
  getActiveSdkModule: async () => ({
    getAgentDir: () => '/agent',
    SettingsManager: {
      create: () => ({
        isProjectTrusted: () => true,
        flush: mocks.flush,
        getGlobalSettings: () => ({ packages: ['npm:@example/tools'] }),
        getProjectSettings: () => ({ packages: [] }),
        setPackages: mocks.setPackages,
        setProjectPackages: vi.fn(),
      }),
    },
    DefaultPackageManager: function PackageManagerMock() {
      return {
        listConfiguredPackages: () => mocks.configured,
        setProgressCallback: (callback: ((event: unknown) => void) | undefined) => {
          mocks.progressCallback = callback
        },
        installAndPersist: mocks.installAndPersist,
        removeAndPersist: mocks.removeAndPersist,
        update: mocks.update,
        checkForAvailableUpdates: vi.fn().mockResolvedValue([]),
      }
    },
  }),
}))

import {
  mutatePiPackage,
  piResourceManagerTestApi,
  setPiResourceFilter,
} from './pi-resource-manager'

describe('Pi resource manager', () => {
  beforeEach(() => {
    mocks.trustedWorkspace = '/workspace'
    mocks.progressCallback = undefined
    mocks.installAndPersist.mockReset().mockImplementation(async () => {
      mocks.progressCallback?.({
        type: 'start',
        action: 'install',
        source: 'npm:@example/new-tools',
        message: 'Installing package',
      })
    })
    mocks.removeAndPersist.mockReset().mockResolvedValue(true)
    mocks.update.mockReset().mockResolvedValue(undefined)
    mocks.flush.mockReset().mockResolvedValue(undefined)
    mocks.setPackages.mockReset()
    mocks.reloadResources.mockReset().mockResolvedValue(undefined)
    mocks.runningSessions = []
    mocks.auditWrite.mockReset()
    mocks.emitRuntimeEvent.mockReset()
    mocks.collectSnapshot.mockReset().mockResolvedValue({ workspacePath: '/workspace' })
  })

  it('installs through Pi, persists settings, reloads the active Worker, and publishes progress', async () => {
    const result = await mutatePiPackage({
      workspaceId: '/workspace',
      action: 'install',
      source: 'npm:@example/new-tools',
      scope: 'user',
      confirmed: true,
    })

    expect(mocks.installAndPersist).toHaveBeenCalledWith('npm:@example/new-tools', { local: false })
    expect(mocks.flush).toHaveBeenCalled()
    expect(mocks.reloadResources).toHaveBeenCalled()
    expect(mocks.emitRuntimeEvent).toHaveBeenCalledWith(
      'ipc:pi-resource-operation-progress',
      expect.objectContaining({ phase: 'started', action: 'install' }),
    )
    expect(result).toMatchObject({
      ok: true,
      workerReload: 'reloaded',
      snapshot: { workspacePath: '/workspace' },
    })
  })

  it('resolves update/remove targets from configured Pi packages instead of trusting a source string', async () => {
    await mutatePiPackage({
      workspaceId: '/workspace',
      action: 'remove',
      packageId: 'user:npm:@example/tools',
      confirmed: true,
    })
    expect(mocks.removeAndPersist).toHaveBeenCalledWith('npm:@example/tools', { local: false })

    await expect(mutatePiPackage({
      workspaceId: '/workspace',
      action: 'update',
      packageId: 'user:npm:@example/forged',
      confirmed: true,
    })).rejects.toThrow('not configured')
    expect(mocks.update).not.toHaveBeenCalled()
  })

  it('builds exact Pi +path/-path filters without accumulating conflicting rules', () => {
    expect(piResourceManagerTestApi.applyExactFilter(
      ['skills/*.md', '-skills/review/SKILL.md'],
      'skills/review/SKILL.md',
      true,
    )).toEqual(['skills/*.md', '+skills/review/SKILL.md'])
  })

  it('persists a Package resource toggle as an exact native Pi filter', async () => {
    const before = {
      workspacePath: '/workspace',
      packages: [{
        id: 'user:npm:@example/tools',
        source: 'npm:@example/tools',
        scope: 'user',
      }],
      resources: {
        extensions: [],
        skills: [{
          id: 'skills:user:/agent/npm/tools/skills/review/SKILL.md',
          kind: 'skills',
          name: 'review',
          path: '/agent/npm/tools/skills/review/SKILL.md',
          relativePath: 'skills/review/SKILL.md',
          source: 'npm:@example/tools',
          scope: 'user',
          origin: 'package',
          packageId: 'user:npm:@example/tools',
          enabled: true,
          configurable: true,
        }],
        prompts: [],
        themes: [],
      },
    }
    mocks.collectSnapshot
      .mockReset()
      .mockResolvedValueOnce(before)
      .mockResolvedValueOnce(before)

    const result = await setPiResourceFilter({
      workspaceId: '/workspace',
      resourceId: before.resources.skills[0].id,
      enabled: false,
    })

    expect(mocks.setPackages).toHaveBeenCalledWith([{
      source: 'npm:@example/tools',
      skills: ['-skills/review/SKILL.md'],
    }])
    expect(mocks.flush).toHaveBeenCalled()
    expect(result).toMatchObject({ ok: true, workerReload: 'reloaded' })
  })

  it('defers hot reload rather than interrupting an active Agent turn', async () => {
    mocks.runningSessions = [{ sessionFile: '/session.jsonl', running: true, cwd: '/workspace' }]
    const result = await mutatePiPackage({
      workspaceId: '/workspace',
      action: 'install',
      source: 'npm:@example/new-tools',
      scope: 'user',
      confirmed: true,
    })
    expect(result.workerReload).toBe('deferred')
    expect(mocks.reloadResources).not.toHaveBeenCalled()
  })

  it('rejects remote package URLs carrying embedded credentials or tokens', () => {
    expect(() => piResourceManagerTestApi.assertSafePackageSource(
      'https://user:secret@example.com/repo.git',
    )).toThrow('must not contain credentials')
    expect(() => piResourceManagerTestApi.assertSafePackageSource(
      'git:https://example.com/repo.git?token=secret',
    )).toThrow('must not contain credentials')
    expect(() => piResourceManagerTestApi.assertSafePackageSource(
      'git:github.com/example/repo',
    )).not.toThrow()
  })
})
