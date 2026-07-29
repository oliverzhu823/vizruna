import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveRuntimeIdentity } from '../runtime-identity'

const base = {
  appDataPath: '/Users/test/Library/Application Support',
  tempPath: '/private/tmp',
  pid: 1234,
}

describe('runtime identity isolation', () => {
  it('keeps the packaged product on native global Pi credentials', () => {
    expect(
      resolveRuntimeIdentity({ ...base, isPackaged: true, isE2E: false }),
    ).toEqual({
      channel: 'production',
      appName: 'Vizruna',
      appId: 'com.vizruna.desktop',
      userDataPath: join(base.appDataPath, 'Vizruna'),
      piAgentDirectory: null,
      isolated: false,
    })
  })

  it('isolates source development settings and Pi credentials', () => {
    const identity = resolveRuntimeIdentity({
      ...base,
      isPackaged: false,
      isE2E: false,
    })

    expect(identity).toEqual({
      channel: 'development',
      appName: 'Vizruna Dev',
      appId: 'com.vizruna.desktop.dev',
      userDataPath: join(base.appDataPath, 'Vizruna Dev'),
      piAgentDirectory: join(base.appDataPath, 'Vizruna Dev', 'pi-agent'),
      isolated: true,
    })
  })

  it('isolates packaged acceptance tests without changing product identity', () => {
    const identity = resolveRuntimeIdentity({
      ...base,
      isPackaged: true,
      isE2E: true,
      explicitUserData: '/private/tmp/vizruna-acceptance',
      explicitPiAgentDirectory: '/Users/test/.pi/agent',
    })

    expect(identity.appName).toBe('Vizruna')
    expect(identity.appId).toBe('com.vizruna.desktop')
    expect(identity.userDataPath).toBe('/private/tmp/vizruna-acceptance')
    expect(identity.piAgentDirectory).toBe(
      join('/private/tmp/vizruna-acceptance', 'pi-agent'),
    )
    expect(identity.isolated).toBe(true)
  })

  it('honors an explicit Pi directory for controlled test fixtures', () => {
    const identity = resolveRuntimeIdentity({
      ...base,
      isPackaged: false,
      isE2E: false,
      explicitPiAgentDirectory: '/private/tmp/fixture-agent',
    })

    expect(identity.piAgentDirectory).toBe('/private/tmp/fixture-agent')
  })
})
