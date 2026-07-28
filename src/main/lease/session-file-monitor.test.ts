import { describe, expect, it } from 'vitest'
import {
  ExternalSessionMutationError,
  SessionFileMonitor,
  type SessionFileFingerprint,
} from './session-file-monitor'

describe('non-cooperative session writer detection', () => {
  it('blocks a write when the idle JSONL fingerprint changed', () => {
    let current: SessionFileFingerprint = {
      exists: true,
      size: '100',
      mtimeNs: '10',
      inode: '1',
    }
    const monitor = new SessionFileMonitor(() => current)
    monitor.record('/sessions/a.jsonl')
    current = { ...current, size: '120', mtimeNs: '11' }
    expect(() => monitor.assertUnchanged('/sessions/a.jsonl')).toThrow(
      ExternalSessionMutationError,
    )
  })

  it('accepts an unchanged idle file and allows a new baseline after clear', () => {
    let current: SessionFileFingerprint = {
      exists: true,
      size: '100',
      mtimeNs: '10',
      inode: '1',
    }
    const monitor = new SessionFileMonitor(() => current)
    monitor.record('/sessions/a.jsonl')
    expect(monitor.assertUnchanged('/sessions/a.jsonl')).toEqual(current)
    monitor.clear('/sessions/a.jsonl')
    current = { ...current, size: '200', mtimeNs: '20' }
    expect(monitor.assertUnchanged('/sessions/a.jsonl')).toEqual(current)
  })

  it('accepts a successful app-owned mutation as the next idle baseline', async () => {
    let current: SessionFileFingerprint = {
      exists: true,
      size: '100',
      mtimeNs: '10',
      inode: '1',
    }
    const monitor = new SessionFileMonitor(() => current)
    monitor.record('/sessions/a.jsonl')

    await monitor.trackInternalMutation('/sessions/a.jsonl', async () => {
      current = { ...current, size: '140', mtimeNs: '11' }
    })

    expect(monitor.assertUnchanged('/sessions/a.jsonl')).toEqual(current)
  })

  it('does not accept a partially written mutation when the operation fails', async () => {
    let current: SessionFileFingerprint = {
      exists: true,
      size: '100',
      mtimeNs: '10',
      inode: '1',
    }
    const monitor = new SessionFileMonitor(() => current)
    monitor.record('/sessions/a.jsonl')

    await expect(
      monitor.trackInternalMutation('/sessions/a.jsonl', async () => {
        current = { ...current, size: '140', mtimeNs: '11' }
        throw new Error('mutation failed')
      }),
    ).rejects.toThrow('mutation failed')
    expect(() => monitor.assertUnchanged('/sessions/a.jsonl')).toThrow(
      ExternalSessionMutationError,
    )
  })
})
