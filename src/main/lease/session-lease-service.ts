import { hostname as readHostname } from 'node:os'
import { randomUUID } from 'node:crypto'
import {
  SESSION_LEASE_HEARTBEAT_MS,
  SESSION_LEASE_TTL_MS,
  type SessionLeaseAcquireResult,
  type SessionLeaseRecord,
  type SessionLeaseSnapshot,
} from '@shared/session-lease'
import { PRODUCT_APP_ID } from '@shared/product-identity'
import type { AuditEventInput } from '@shared/audit-events'
import { normalizeSessionKey } from '../worker-session-key'
import { LeaseFileStore } from './lease-file-store'
import { classifyLeaseRecord } from './lease-policy'

export interface SessionLeaseServiceOptions {
  appId?: string
  instanceId?: string
  hostname?: string
  pid?: number
  heartbeatMs?: number
  ttlMs?: number
  now?: () => number
  isPidAlive?: (pid: number) => boolean
  store?: LeaseFileStore
  audit?: (event: AuditEventInput) => void | Promise<void>
  onLeaseLost?: (snapshot: SessionLeaseSnapshot) => void | Promise<void>
}

export class SessionLeaseConflictError extends Error {
  readonly code = 'SESSION_LEASE_CONFLICT'

  constructor(readonly snapshot: SessionLeaseSnapshot) {
    super(`Session is not writable: ${snapshot.disposition} (${snapshot.reason})`)
    this.name = 'SessionLeaseConflictError'
  }
}

function defaultIsPidAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch (error) {
    return (error as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

export class SessionLeaseService {
  readonly appId: string
  readonly instanceId: string
  readonly hostname: string
  readonly pid: number
  readonly heartbeatMs: number
  readonly ttlMs: number

  private readonly now: () => number
  private readonly isPidAlive: (pid: number) => boolean
  private readonly store: LeaseFileStore
  private readonly auditWriter?: SessionLeaseServiceOptions['audit']
  private readonly onLeaseLost?: SessionLeaseServiceOptions['onLeaseLost']
  private readonly held = new Map<string, { record: SessionLeaseRecord; timer: NodeJS.Timeout }>()

  constructor(options: SessionLeaseServiceOptions = {}) {
    this.appId = options.appId ?? PRODUCT_APP_ID
    this.instanceId = options.instanceId ?? randomUUID()
    this.hostname = options.hostname ?? readHostname()
    this.pid = options.pid ?? process.pid
    this.heartbeatMs = options.heartbeatMs ?? SESSION_LEASE_HEARTBEAT_MS
    this.ttlMs = options.ttlMs ?? SESSION_LEASE_TTL_MS
    this.now = options.now ?? Date.now
    this.isPidAlive = options.isPidAlive ?? defaultIsPidAlive
    this.store = options.store ?? new LeaseFileStore()
    this.auditWriter = options.audit
    this.onLeaseLost = options.onLeaseLost
  }

  private policyContext() {
    return {
      instanceId: this.instanceId,
      hostname: this.hostname,
      nowMs: this.now(),
      ttlMs: this.ttlMs,
      isPidAlive: this.isPidAlive,
    }
  }

  private audit(event: AuditEventInput): void {
    void Promise.resolve(this.auditWriter?.(event)).catch((error) => {
      console.warn('[session-lease] audit write failed:', error)
    })
  }

  async inspect(sessionFile: string): Promise<SessionLeaseSnapshot> {
    const normalized = normalizeSessionKey(sessionFile)
    const read = await this.store.read(normalized)
    if (read.parseError) {
      return {
        sessionFile: normalized,
        leaseFile: this.store.leasePath(normalized),
        disposition: 'corrupt',
        reason: 'invalid-record',
        parseError: read.parseError,
      }
    }
    return classifyLeaseRecord(
      normalized,
      this.store.leasePath(normalized),
      read.record,
      this.policyContext(),
    )
  }

  async acquire(
    sessionFile: string,
    options: { confirmedTakeover?: boolean } = {},
  ): Promise<SessionLeaseAcquireResult> {
    const normalized = normalizeSessionKey(sessionFile)
    try {
      return await this.store.withCoordinationLock(normalized, async () => {
        const snapshot = await this.inspect(normalized)
        const canAcquire =
          snapshot.disposition === 'available' ||
          snapshot.disposition === 'owned' ||
          options.confirmedTakeover === true

        if (!canAcquire) {
          if (snapshot.disposition === 'stale') {
            this.audit({
              category: 'session-lease',
              action: 'lease.expiry-detected',
              outcome: 'blocked',
              actor: this.instanceId,
              sessionFile: normalized,
              details: { reason: snapshot.reason },
            })
          }
          this.audit({
            category: 'session-lease',
            action: 'lease.acquire',
            outcome: 'blocked',
            actor: this.instanceId,
            sessionFile: normalized,
            details: {
              disposition: snapshot.disposition,
              reason: snapshot.reason,
              holderInstanceId: snapshot.record?.instanceId,
            },
          })
          return { acquired: false, snapshot }
        }

        const nowIso = new Date(this.now()).toISOString()
        const record: SessionLeaseRecord = {
          version: 1,
          appId: this.appId,
          instanceId: this.instanceId,
          hostname: this.hostname,
          pid: this.pid,
          sessionFile: normalized,
          acquiredAt:
            snapshot.disposition === 'owned' && snapshot.record
              ? snapshot.record.acquiredAt
              : nowIso,
          refreshedAt: nowIso,
        }
        await this.store.write(normalized, record)
        this.startHeartbeat(normalized, record)
        const acquiredSnapshot = classifyLeaseRecord(
          normalized,
          this.store.leasePath(normalized),
          record,
          this.policyContext(),
        )
        this.audit({
          category: 'session-lease',
          action: options.confirmedTakeover ? 'lease.takeover' : 'lease.acquire',
          outcome: 'success',
          actor: this.instanceId,
          sessionFile: normalized,
          details: {
            previousDisposition: snapshot.disposition,
            previousReason: snapshot.reason,
            previousHolderInstanceId: snapshot.record?.instanceId,
          },
        })
        return { acquired: true, snapshot: acquiredSnapshot }
      })
    } catch (error) {
      this.audit({
        category: 'session-lease',
        action: options.confirmedTakeover ? 'lease.takeover' : 'lease.acquire',
        outcome: 'failed',
        actor: this.instanceId,
        sessionFile: normalized,
        details: {
          error: error instanceof Error ? error.message : String(error),
        },
      })
      throw error
    }
  }

  async ensureOwned(sessionFile: string): Promise<SessionLeaseSnapshot> {
    const snapshot = await this.inspect(sessionFile)
    if (snapshot.disposition !== 'owned') throw new SessionLeaseConflictError(snapshot)
    return snapshot
  }

  async refreshNow(sessionFile: string): Promise<SessionLeaseSnapshot> {
    const normalized = normalizeSessionKey(sessionFile)
    const held = this.held.get(normalized)
    if (!held) {
      const snapshot = await this.inspect(normalized)
      throw new SessionLeaseConflictError(snapshot)
    }
    try {
      return await this.store.withCoordinationLock(normalized, async () => {
        const snapshot = await this.inspect(normalized)
        if (
          snapshot.disposition !== 'owned' ||
          snapshot.record?.instanceId !== this.instanceId
        ) {
          await this.markLeaseLost(normalized, snapshot)
          throw new SessionLeaseConflictError(snapshot)
        }
        const record = {
          ...held.record,
          refreshedAt: new Date(this.now()).toISOString(),
        }
        await this.store.write(normalized, record)
        held.record = record
        return classifyLeaseRecord(
          normalized,
          this.store.leasePath(normalized),
          record,
          this.policyContext(),
        )
      })
    } catch (error) {
      if (error instanceof SessionLeaseConflictError) throw error
      this.audit({
        category: 'session-lease',
        action: 'lease.refresh',
        outcome: 'failed',
        actor: this.instanceId,
        sessionFile: normalized,
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      const snapshot = await this.inspect(normalized).catch(() => ({
        sessionFile: normalized,
        leaseFile: this.store.leasePath(normalized),
        disposition: 'corrupt' as const,
        reason: 'invalid-record' as const,
        parseError: error instanceof Error ? error.message : String(error),
      }))
      await this.markLeaseLost(normalized, snapshot)
      throw error
    }
  }

  async release(sessionFile: string): Promise<void> {
    const normalized = normalizeSessionKey(sessionFile)
    this.stopHeartbeat(normalized)
    try {
      await this.store.withCoordinationLock(normalized, async () => {
        const snapshot = await this.inspect(normalized)
        if (snapshot.record?.instanceId === this.instanceId) {
          await this.store.remove(normalized)
          this.audit({
            category: 'session-lease',
            action: 'lease.release',
            outcome: 'success',
            actor: this.instanceId,
            sessionFile: normalized,
          })
        }
      })
    } catch (error) {
      this.audit({
        category: 'session-lease',
        action: 'lease.release',
        outcome: 'failed',
        actor: this.instanceId,
        sessionFile: normalized,
        details: { error: error instanceof Error ? error.message : String(error) },
      })
      throw error
    }
  }

  async releaseAll(): Promise<void> {
    const sessionFiles = [...this.held.keys()]
    await Promise.allSettled(sessionFiles.map((sessionFile) => this.release(sessionFile)))
  }

  heldSessionFiles(): string[] {
    return [...this.held.keys()]
  }

  private startHeartbeat(sessionFile: string, record: SessionLeaseRecord): void {
    this.stopHeartbeat(sessionFile)
    const timer = setInterval(() => {
      void this.refreshNow(sessionFile).catch((error) => {
        console.warn('[session-lease] heartbeat lost:', error)
      })
    }, this.heartbeatMs)
    timer.unref?.()
    this.held.set(sessionFile, { record, timer })
  }

  private stopHeartbeat(sessionFile: string): void {
    const held = this.held.get(sessionFile)
    if (!held) return
    clearInterval(held.timer)
    this.held.delete(sessionFile)
  }

  private async markLeaseLost(
    sessionFile: string,
    snapshot: SessionLeaseSnapshot,
  ): Promise<void> {
    this.stopHeartbeat(sessionFile)
    this.audit({
      category: 'session-lease',
      action: 'lease.lost',
      outcome: 'failed',
      actor: this.instanceId,
      sessionFile,
      details: { disposition: snapshot.disposition, reason: snapshot.reason },
    })
    await this.onLeaseLost?.(snapshot)
  }
}
