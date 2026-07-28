import type {
  SessionLeaseRecord,
  SessionLeaseSnapshot,
} from '@shared/session-lease'

export interface LeasePolicyContext {
  instanceId: string
  hostname: string
  nowMs: number
  ttlMs: number
  isPidAlive: (pid: number) => boolean
}

export function classifyLeaseRecord(
  sessionFile: string,
  leaseFile: string,
  record: SessionLeaseRecord | null,
  context: LeasePolicyContext,
): SessionLeaseSnapshot {
  if (!record) {
    return {
      sessionFile,
      leaseFile,
      disposition: 'available',
      reason: 'missing',
    }
  }

  if (record.instanceId === context.instanceId) {
    return {
      sessionFile,
      leaseFile,
      disposition: 'owned',
      reason: 'same-instance',
      record,
    }
  }

  if (record.hostname === context.hostname) {
    const alive = context.isPidAlive(record.pid)
    return {
      sessionFile,
      leaseFile,
      disposition: alive ? 'active-foreign' : 'stale',
      reason: alive ? 'same-host-live-pid' : 'same-host-dead-pid',
      record,
    }
  }

  const refreshedAt = Date.parse(record.refreshedAt)
  const fresh = Number.isFinite(refreshedAt) && context.nowMs - refreshedAt <= context.ttlMs
  return {
    sessionFile,
    leaseFile,
    disposition: fresh ? 'active-foreign' : 'stale',
    reason: fresh ? 'cross-host-fresh' : 'cross-host-expired',
    record,
  }
}

