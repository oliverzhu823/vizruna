import { z } from 'zod'

export const SESSION_LEASE_VERSION = 1
export const SESSION_LEASE_HEARTBEAT_MS = 10_000
export const SESSION_LEASE_TTL_MS = 60_000

export const sessionLeaseRecordSchema = z.object({
  version: z.literal(SESSION_LEASE_VERSION),
  appId: z.string().min(1),
  instanceId: z.string().uuid(),
  hostname: z.string().min(1),
  pid: z.number().int().positive(),
  sessionFile: z.string().min(1),
  acquiredAt: z.string().datetime(),
  refreshedAt: z.string().datetime(),
})

export type SessionLeaseRecord = z.infer<typeof sessionLeaseRecordSchema>

export type SessionLeaseDisposition =
  | 'available'
  | 'owned'
  | 'active-foreign'
  | 'stale'
  | 'corrupt'

export type SessionLeaseReason =
  | 'missing'
  | 'same-instance'
  | 'same-host-live-pid'
  | 'same-host-dead-pid'
  | 'cross-host-fresh'
  | 'cross-host-expired'
  | 'invalid-record'

export interface SessionLeaseSnapshot {
  sessionFile: string
  leaseFile: string
  disposition: SessionLeaseDisposition
  reason: SessionLeaseReason
  record?: SessionLeaseRecord
  parseError?: string
}

export type SessionLeaseAcquireResult =
  | { acquired: true; snapshot: SessionLeaseSnapshot }
  | { acquired: false; snapshot: SessionLeaseSnapshot }

export interface SessionLeaseInspectRequest {
  sessionFile: string
}

export interface SessionLeaseTakeoverRequest {
  sessionFile: string
  confirmed: true
}

