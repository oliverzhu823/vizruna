import { statSync } from 'node:fs'
import { normalizeSessionKey } from '../worker-session-key'

export interface SessionFileFingerprint {
  exists: boolean
  size: string
  mtimeNs: string
  inode: string
}

export class ExternalSessionMutationError extends Error {
  readonly code = 'SESSION_EXTERNALLY_MODIFIED'

  constructor(
    readonly sessionFile: string,
    readonly previous: SessionFileFingerprint,
    readonly current: SessionFileFingerprint,
  ) {
    super('Session JSONL was externally modified while this application was idle')
    this.name = 'ExternalSessionMutationError'
  }
}

export function captureSessionFileFingerprint(path: string): SessionFileFingerprint {
  try {
    const stats = statSync(path, { bigint: true })
    return {
      exists: true,
      size: stats.size.toString(),
      mtimeNs: stats.mtimeNs.toString(),
      inode: stats.ino.toString(),
    }
  } catch {
    return { exists: false, size: '0', mtimeNs: '0', inode: '0' }
  }
}

function equal(
  left: SessionFileFingerprint,
  right: SessionFileFingerprint,
): boolean {
  return (
    left.exists === right.exists &&
    left.size === right.size &&
    left.mtimeNs === right.mtimeNs &&
    left.inode === right.inode
  )
}

export class SessionFileMonitor {
  private readonly baselines = new Map<string, SessionFileFingerprint>()
  private readonly fingerprint: (path: string) => SessionFileFingerprint

  constructor(
    fingerprint: (path: string) => SessionFileFingerprint =
      captureSessionFileFingerprint,
  ) {
    this.fingerprint = fingerprint
  }

  record(sessionFile: string): SessionFileFingerprint {
    const normalized = normalizeSessionKey(sessionFile)
    const next = this.fingerprint(normalized)
    this.baselines.set(normalized, next)
    return next
  }

  recordIfAbsent(sessionFile: string): SessionFileFingerprint {
    const normalized = normalizeSessionKey(sessionFile)
    const previous = this.baselines.get(normalized)
    return previous ?? this.record(normalized)
  }

  assertUnchanged(sessionFile: string): SessionFileFingerprint {
    const normalized = normalizeSessionKey(sessionFile)
    const current = this.fingerprint(normalized)
    const previous = this.baselines.get(normalized)
    if (previous && !equal(previous, current)) {
      throw new ExternalSessionMutationError(normalized, previous, current)
    }
    if (!previous) this.baselines.set(normalized, current)
    return current
  }

  /** Accept the fingerprint produced by a successful, app-owned synchronous mutation. */
  async trackInternalMutation<T>(sessionFile: string, mutation: () => Promise<T>): Promise<T> {
    const result = await mutation()
    this.record(sessionFile)
    return result
  }

  clear(sessionFile: string): void {
    this.baselines.delete(normalizeSessionKey(sessionFile))
  }
}
