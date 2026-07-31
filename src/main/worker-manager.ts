// Worker Manager - multi-session utility process pool (sessionKey + workspace keys)

import { type BrowserWindow } from 'electron'
import { resolve } from 'node:path'
import type { AppEvent } from '@shared/app-events'
import type {
  WorkerCommandInfo,
  WorkerCompletionItem,
  WorkerContextPreview,
  WorkerMessagesPage,
  WorkerModelRow,
  WorkerPromptTemplate,
  WorkerRequestPayload,
  WorkerResponsePayload,
  WorkerSessionOnDisk,
  WorkerSessionTreeNode,
  WorkerSkillInfo,
  WorkerState,
} from '@shared/worker-rpc-types'
import {
  attachWorkerHandlers,
  canAcquireNewWorker,
  disposeWorkerSlot,
  evictIdleWorkers,
  finalizeWorkerSlotDisposal,
  forkWorkerForCwd,
  getBackgroundWorkerState,
  pruneIdleWorkersByTimeout,
  slotRequest,
  terminateWorkerSlotImmediately,
} from './worker-manager-pool'
import type { WorkerInitResult, WorkerSlot } from './worker-manager-types'
import { normalizeSessionKey, workspacePoolKey } from './worker-session-key'
import { readMaxSessionWorkers } from './worker-pool-config'
import { configStore } from './config-store'
import type {
  SessionLeaseAcquireResult,
  SessionLeaseSnapshot,
} from '@shared/session-lease'
import type {
  OrchestrationWorkerResponse,
} from '@shared/orchestration'
import {
  SessionLeaseConflictError,
  SessionLeaseService,
} from './lease/session-lease-service'
import { auditRepository } from './audit/audit-repository'
import { randomUUID } from 'node:crypto'
import type { WorkerDiagnosticSnapshot } from '@shared/reliability'
import {
  ExternalSessionMutationError,
  SessionFileMonitor,
} from './lease/session-file-monitor'
import type { ProviderRoutingRuntime } from '@shared/provider-routing'
import type { ConversationRuntimeSnapshot } from '@shared/system-prompt-preset'
import { getConversationConfigBinding } from './system-prompt-preset-service'
import {
  isDeferredAuthenticationReloadError,
  isInvalidAuthenticationRuntimeError,
} from '@shared/worker-auth-reload'

interface InitResult extends WorkerInitResult {}

export type WorkerRuntimeNotification =
  | {
      type: 'app-event'
      event: AppEvent
      cwd: string
      poolKey: string
      sessionFile: string | null
      agentTurnActive: boolean
    }
  | {
      type: 'slot-exit'
      code: number
      cwd: string
      poolKey: string
      sessionFile: string | null
      stopping: boolean
    }
  | {
      type: 'extension-ui-request'
      request: unknown
      cwd: string
      poolKey: string
      sessionFile: string | null
    }

export type OrchestrationRequestHandler = (payload: {
  request: unknown
  parentSessionFile: string | null
  parentWorkerKey: string
  rootWorkspacePath: string
}) => Promise<OrchestrationWorkerResponse>

export class WorkerManager {
  private mainWindow: BrowserWindow | null = null
  /** Key: session abs path or `ws:${cwd}` */
  private pool = new Map<string, WorkerSlot>()
  private foregroundPoolKey: string | null = null
  private lifecycleChain: Promise<unknown> = Promise.resolve()
  private idleTimer: ReturnType<typeof setInterval> | null = null
  private readonly leaseService: SessionLeaseService
  private readonly sessionFileMonitor = new SessionFileMonitor()
  private orchestrationRequestHandler: OrchestrationRequestHandler | null = null
  private readonly runtimeListeners = new Set<
    (notification: WorkerRuntimeNotification) => void
  >()

  constructor() {
    this.leaseService = new SessionLeaseService({
      audit: (event) => {
        auditRepository.write(event)
      },
      onLeaseLost: (snapshot) => this.handleLeaseLost(snapshot),
    })
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win
    this.ensureIdleTimer()
  }

  setOrchestrationRequestHandler(
    handler: OrchestrationRequestHandler | null,
  ): void {
    this.orchestrationRequestHandler = handler
  }

  subscribeRuntime(
    listener: (notification: WorkerRuntimeNotification) => void,
  ): () => void {
    this.runtimeListeners.add(listener)
    return () => this.runtimeListeners.delete(listener)
  }

  private notifyRuntime(notification: WorkerRuntimeNotification): void {
    for (const listener of this.runtimeListeners) {
      try {
        listener(notification)
      } catch (error) {
        console.warn('[WorkerManager] runtime listener failed:', error)
      }
    }
  }

  private attachSlot(slot: WorkerSlot): void {
    attachWorkerHandlers(slot, slot.worker, {
      mainWindow: this.mainWindow,
      getForegroundPoolKey: () => this.foregroundPoolKey,
      onAppEvent: (payload) => this.forwardAppEvent(payload),
      onSlotExit: (target, code) => this.handleSlotExit(target, code),
      onOrchestrationRequest: (payload) => {
        if (!this.orchestrationRequestHandler) {
          return Promise.resolve({
            ok: false,
            code: 'ORCHESTRATION_UNAVAILABLE',
            error: 'Orchestration service is unavailable',
          })
        }
        return this.orchestrationRequestHandler(payload)
      },
      onExtensionUiRequest: (payload) => {
        this.notifyRuntime({
          type: 'extension-ui-request',
          request: payload.request,
          cwd: payload.fromCwd,
          poolKey: payload.fromPoolKey,
          sessionFile: payload.sessionFile,
        })
      },
    })
  }

  private ensureIdleTimer(): void {
    if (this.idleTimer) return
    this.idleTimer = setInterval(() => {
      try {
        pruneIdleWorkersByTimeout(this.pool, this.foregroundPoolKey)
      } catch {
        /* ignore */
      }
    }, 60_000)
    if (typeof this.idleTimer === 'object' && this.idleTimer && 'unref' in this.idleTimer) {
      ;(this.idleTimer as NodeJS.Timeout).unref?.()
    }
  }

  async start(cwd: string): Promise<InitResult> {
    const run = this.lifecycleChain.then(() => this.startWorkspaceUnlocked(cwd))
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  /** Acquire or create a worker bound to sessionFile (F1). Requires workspace cwd. */
  async ensureSessionWorker(sessionFile: string, cwd: string): Promise<InitResult> {
    const run = this.lifecycleChain.then(() => this.ensureSessionWorkerUnlocked(sessionFile, cwd))
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private foregroundSlot(): WorkerSlot | null {
    if (!this.foregroundPoolKey) return null
    return this.pool.get(this.foregroundPoolKey) ?? null
  }

  private setForeground(slot: WorkerSlot): void {
    this.foregroundPoolKey = slot.poolKey
    slot.lastForegroundAt = Date.now()
  }

  private async startWorkspaceUnlocked(cwd: string): Promise<InitResult> {
    const key = workspacePoolKey(cwd)
    const existing = this.pool.get(key)
    if (existing && !existing.stopping) {
      const prev = this.foregroundPoolKey
      this.setForeground(existing)
      evictIdleWorkers(this.pool, {
        foregroundKey: key,
        keepKeys: prev && prev !== key ? [prev] : [],
        maxWorkers: readMaxSessionWorkers(),
      })
      if (existing.initPromise) return existing.initPromise
      const live = await this.requestOnSlot(existing, 'getState').catch(() => null)
      return {
        sessionId: String((live?.state as WorkerState)?.sessionId ?? ''),
        model: (live?.state as WorkerState)?.model as string | undefined,
        thinkingLevel: (live?.state as WorkerState)?.thinkingLevel as string | undefined,
      }
    }

    // Prefer reusing any session slot already on this cwd as workspace foreground
    for (const slot of this.pool.values()) {
      if (slot.cwd === cwd && !slot.stopping) {
        this.setForeground(slot)
        return this.initResultFromSlot(slot)
      }
    }

    const cap = canAcquireNewWorker(this.pool)
    if (!cap.ok) {
      evictIdleWorkers(this.pool, {
        foregroundKey: this.foregroundPoolKey,
        maxWorkers: readMaxSessionWorkers(),
      })
    }
    const cap2 = canAcquireNewWorker(this.pool)
    if (!cap2.ok) throw new Error(cap2.reason)

    const prev = this.foregroundPoolKey
    const { slot, init } = await forkWorkerForCwd(cwd, { poolKey: key, sessionFile: null })
    this.pool.set(key, slot)
    this.setForeground(slot)

    this.attachSlot(slot)

    evictIdleWorkers(this.pool, {
      foregroundKey: key,
      keepKeys: prev && prev !== key ? [prev] : [],
      maxWorkers: readMaxSessionWorkers(),
    })

    return init
  }

  private async ensureSessionWorkerUnlocked(
    sessionFile: string,
    cwd: string,
    options?: {
      foreground?: boolean
      conversationConfigSnapshot?: ConversationRuntimeSnapshot | null
    },
  ): Promise<InitResult> {
    const makeForeground = options?.foreground !== false
    const sk = normalizeSessionKey(sessionFile)
    if (!sk) throw new Error('sessionFile required')
    const conversationConfigSnapshot =
      options?.conversationConfigSnapshot === undefined
        ? getConversationConfigBinding({ sessionFile: sk })?.snapshot ?? null
        : options.conversationConfigSnapshot
    const disposing = this.pool.get(sk)
    if (disposing?.stopping) {
      const deadline = Date.now() + 3_000
      while (!disposing.disposedCallbackCalled && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      if (!disposing.disposedCallbackCalled) {
        throw new Error('Previous session worker is still shutting down')
      }
      if (this.pool.get(sk) === disposing) this.pool.delete(sk)
    }
    await this.acquireSessionLeaseOrThrow(sk)

    const existing = this.pool.get(sk)
    if (existing && !existing.stopping) {
      const prev = this.foregroundPoolKey
      if (makeForeground) this.setForeground(existing)
      existing.sessionFile = sk
      if (makeForeground) {
        evictIdleWorkers(this.pool, {
          foregroundKey: sk,
          keepKeys: prev && prev !== sk ? [prev] : [],
          maxWorkers: readMaxSessionWorkers(),
        })
      }
      if (existing.initPromise) await existing.initPromise
      // Bind live session on worker
      await this.requestOnSlot(existing, 'loadSession', {
        sessionFile: sk,
        conversationConfigSnapshot,
      })
      this.bindSlotLease(existing, sk)
      return this.initResultFromSlot(existing)
    }

    // Reuse workspace slot on same cwd if unbound / same session
    const wsKey = workspacePoolKey(cwd)
    const wsSlot = this.pool.get(wsKey)
    if (wsSlot && !wsSlot.stopping && (!wsSlot.sessionFile || wsSlot.sessionFile === sk)) {
      this.pool.delete(wsKey)
      wsSlot.poolKey = sk
      wsSlot.sessionFile = sk
      this.pool.set(sk, wsSlot)
      if (makeForeground) this.setForeground(wsSlot)
      try {
        if (wsSlot.initPromise) await wsSlot.initPromise
        await this.requestOnSlot(wsSlot, 'loadSession', {
          sessionFile: sk,
          conversationConfigSnapshot,
        })
      } catch (error) {
        this.pool.delete(sk)
        wsSlot.poolKey = wsKey
        wsSlot.sessionFile = null
        this.pool.set(wsKey, wsSlot)
        if (makeForeground) this.foregroundPoolKey = wsKey
        await this.leaseService.release(sk)
        throw error
      }
      this.bindSlotLease(wsSlot, sk)
      return this.initResultFromSlot(wsSlot)
    }

    const cap = canAcquireNewWorker(this.pool)
    if (!cap.ok) {
      evictIdleWorkers(this.pool, {
        foregroundKey: this.foregroundPoolKey,
        maxWorkers: readMaxSessionWorkers(),
      })
    }
    const cap2 = canAcquireNewWorker(this.pool)
    if (!cap2.ok) {
      await this.leaseService.release(sk)
      throw new Error(cap2.reason)
    }

    const prev = this.foregroundPoolKey
    let forked: Awaited<ReturnType<typeof forkWorkerForCwd>>
    try {
      forked = await forkWorkerForCwd(cwd, { poolKey: sk, sessionFile: sk })
    } catch (error) {
      await this.leaseService.release(sk)
      throw error
    }
    const { slot, init } = forked
    this.pool.set(sk, slot)
    if (makeForeground) this.setForeground(slot)
    this.bindSlotLease(slot, sk)

    this.attachSlot(slot)

    try {
      await init
      await this.requestOnSlot(slot, 'loadSession', {
        sessionFile: sk,
        conversationConfigSnapshot,
      })
    } catch (error) {
      if (this.pool.get(sk) === slot) this.pool.delete(sk)
      if (makeForeground && this.foregroundPoolKey === sk) this.foregroundPoolKey = null
      await disposeWorkerSlot(slot).catch(() => {})
      throw error
    }

    if (makeForeground) {
      evictIdleWorkers(this.pool, {
        foregroundKey: sk,
        keepKeys: prev && prev !== sk ? [prev] : [],
        maxWorkers: readMaxSessionWorkers(),
      })
    }

    return this.initResultFromSlot(slot)
  }

  private async initResultFromSlot(slot: WorkerSlot): Promise<InitResult> {
    if (slot.initPromise) {
      try {
        return await slot.initPromise
      } catch {
        /* fall through */
      }
    }
    const live = await this.requestOnSlot(slot, 'getState').catch(() => null)
    return {
      sessionId: String((live?.state as WorkerState)?.sessionId ?? ''),
      model: (live?.state as WorkerState)?.model as string | undefined,
      thinkingLevel: (live?.state as WorkerState)?.thinkingLevel as string | undefined,
    }
  }

  private forwardAppEvent(payload: {
    event: AppEvent
    fromCwd: string
    fromPoolKey: string
    sessionFile: string | null
    agentTurnActive: boolean
  }): void {
    const { event, fromCwd, sessionFile, agentTurnActive } = payload
    let enriched = event
    if (event && typeof event === 'object') {
      const base = { ...(event as object) } as Record<string, unknown>
      if ('workspaceId' in event) {
        base.workspaceId = (event as { workspaceId?: string }).workspaceId || fromCwd
      }
      if (sessionFile && !base.sessionFile) base.sessionFile = sessionFile
      enriched = base as unknown as AppEvent
    }
    this.notifyRuntime({
      type: 'app-event',
      event: enriched,
      cwd: fromCwd,
      poolKey: payload.fromPoolKey,
      sessionFile,
      agentTurnActive,
    })
    if (
      sessionFile &&
      event.type === 'run' &&
      event.phase === 'idle'
    ) {
      this.sessionFileMonitor.record(sessionFile)
    }
    if (event.type === 'run' && event.phase === 'idle') {
      const slot = this.pool.get(payload.fromPoolKey)
      if (slot) {
        this.flushPendingProviderRouting(slot)
        this.flushPendingAuthenticationReload(slot)
      }
    }
    if (!this.mainWindow || this.mainWindow.isDestroyed()) return
    this.mainWindow.webContents.send('ipc:events', enriched)
  }

  private flushPendingProviderRouting(slot: WorkerSlot): void {
    const config = slot.pendingProviderRouting
    if (!config || slot.stopping || slot.agentTurnActive) return
    slot.pendingProviderRouting = undefined
    void this.requestOnSlot(slot, 'setProviderRouting', {
      providerRouting: config,
    }).catch((error) => {
      // Preserve the latest update for a later idle notification unless the
      // slot is already shutting down.
      if (!slot.stopping && !slot.pendingProviderRouting) {
        slot.pendingProviderRouting = config
      }
      auditRepository.write({
        category: 'proxy',
        action: 'provider.route.workerUpdate',
        outcome: 'failed',
        workspaceId: slot.cwd,
        sessionFile: slot.sessionFile ?? undefined,
        details: {
          poolKey: slot.poolKey,
          error: error instanceof Error ? error.message : String(error),
        },
      })
    })
  }

  private flushPendingAuthenticationReload(slot: WorkerSlot): void {
    if (!slot.pendingAuthenticationReload || slot.stopping || slot.agentTurnActive) return
    slot.pendingAuthenticationReload = false
    void this.enqueueSlotAuthenticationReload(slot)
  }

  private handleSlotExit(slot: WorkerSlot, code: number): void {
    const key = slot.poolKey
    const stillOwnsPoolKey = this.pool.get(key) === slot
    if (stillOwnsPoolKey) this.pool.delete(key)
    if (stillOwnsPoolKey && this.foregroundPoolKey === key) this.foregroundPoolKey = null
    if (stillOwnsPoolKey && slot.sessionFile) this.sessionFileMonitor.clear(slot.sessionFile)
    slot.initPromise = null
    if (slot.initRejecter) {
      slot.initRejecter(new Error(`Worker exited during init with code ${code}`))
      slot.initResolver = null
      slot.initRejecter = null
    }
    void finalizeWorkerSlotDisposal(slot).catch((error) => {
      console.warn('[WorkerManager] lease release after worker exit failed:', error)
    })
    this.notifyRuntime({
      type: 'slot-exit',
      code,
      cwd: slot.cwd,
      poolKey: key,
      sessionFile: slot.sessionFile,
      stopping: slot.stopping,
    })
    auditRepository.write({
      category: 'worker',
      action: 'worker.exit',
      outcome: slot.stopping || code === 0 ? 'success' : 'failed',
      workspaceId: slot.cwd,
      sessionFile: slot.sessionFile ?? undefined,
      details: {
        exitCode: code,
        poolKey: key,
        expected: slot.stopping || code === 0,
      },
    })

    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ipc:worker-exit', {
        code,
        cwd: slot.cwd,
        sessionFile: slot.sessionFile,
        poolKey: key,
      })
    }

    if (slot.stopping || code === 0 || !slot.autoRestartEnabled) return

    try {
      process.stderr.write(
        '[WorkerManager] Worker crashed; auto-restart is disabled — not spawning another worker\n',
      )
    } catch {
      /* ignore */
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ipc:worker-fatal', {
        code,
        cwd: slot.cwd,
        sessionFile: slot.sessionFile,
        message: 'Worker 已退出。请重新打开工作区；若界面空白请先结束任务管理器里多余的 Vizruna 进程。',
      })
    }
  }

  async stop(): Promise<void> {
    const run = this.lifecycleChain.then(() => this.stopUnlocked())
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async stopUnlocked(): Promise<void> {
    const slots = [...this.pool.values()]
    this.pool.clear()
    this.foregroundPoolKey = null
    await Promise.all(slots.map((s) => disposeWorkerSlot(s)))
    for (const slot of slots) {
      if (slot.sessionFile) this.sessionFileMonitor.clear(slot.sessionFile)
    }
    await this.leaseService.releaseAll()
  }

  async inspectSessionLease(sessionFile: string): Promise<SessionLeaseSnapshot> {
    return this.leaseService.inspect(sessionFile)
  }

  async takeOverSessionLease(sessionFile: string): Promise<SessionLeaseAcquireResult> {
    const result = await this.leaseService.acquire(sessionFile, { confirmedTakeover: true })
    if (result.acquired) {
      this.sessionFileMonitor.record(result.snapshot.sessionFile)
      const slot = this.pool.get(normalizeSessionKey(sessionFile))
      if (slot && !slot.stopping) this.bindSlotLease(slot, result.snapshot.sessionFile)
    }
    return result
  }

  async releaseUnusedSessionLeasesExcept(sessionFile?: string | null): Promise<void> {
    const keep = sessionFile ? normalizeSessionKey(sessionFile) : ''
    const releases = this.leaseService
      .heldSessionFiles()
      .filter((heldFile) => heldFile !== keep && !this.pool.has(normalizeSessionKey(heldFile)))
      .map((heldFile) => this.leaseService.release(heldFile))
    await Promise.allSettled(releases)
  }

  private async acquireSessionLeaseOrThrow(sessionFile: string): Promise<SessionLeaseSnapshot> {
    const current = await this.leaseService.inspect(sessionFile)
    if (current.disposition === 'owned') {
      this.sessionFileMonitor.recordIfAbsent(current.sessionFile)
      return current
    }
    const result = await this.leaseService.acquire(sessionFile)
    if (!result.acquired) throw new SessionLeaseConflictError(result.snapshot)
    this.sessionFileMonitor.record(result.snapshot.sessionFile)
    return result.snapshot
  }

  private async ensureWriteLease(sessionFile?: string): Promise<void> {
    const target = sessionFile || this.foregroundSessionFile
    if (!target) return
    await this.leaseService.ensureOwned(target)
    const normalized = normalizeSessionKey(target)
    const slot = this.pool.get(normalized)
    if (slot?.agentTurnActive) return
    try {
      this.sessionFileMonitor.assertUnchanged(normalized)
    } catch (error) {
      if (error instanceof ExternalSessionMutationError) {
        auditRepository.write({
          category: 'session-lease',
          action: 'session.external-change',
          outcome: 'blocked',
          actor: 'worker-manager',
          sessionFile: normalized,
          details: {
            previous: error.previous,
            current: error.current,
          },
        })
      }
      throw error
    }
  }

  /** Validate the idle file, run one synchronous Worker mutation, then accept its new fingerprint. */
  private async performSessionMutation<T>(
    sessionFile: string | undefined,
    mutation: () => Promise<T>,
  ): Promise<T> {
    const target = sessionFile || this.foregroundSessionFile || undefined
    await this.ensureWriteLease(target)
    if (!target) return mutation()
    return this.sessionFileMonitor.trackInternalMutation(target, mutation)
  }

  private bindSlotLease(slot: WorkerSlot, sessionFile: string): void {
    const normalized = normalizeSessionKey(sessionFile)
    slot.beforeWrite = async () => {
      await this.leaseService.ensureOwned(normalized)
    }
    slot.onDisposed = () => this.leaseService.release(normalized)
    slot.disposedCallbackCalled = false
  }

  private async handleLeaseLost(snapshot: SessionLeaseSnapshot): Promise<void> {
    const key = normalizeSessionKey(snapshot.sessionFile)
    const slot = this.pool.get(key)
    if (slot) {
      if (this.pool.get(key) === slot) this.pool.delete(key)
      if (this.foregroundPoolKey === key) this.foregroundPoolKey = null
      // Do not release: another instance owns the file now.
      slot.onDisposed = undefined
      slot.beforeWrite = undefined
      await terminateWorkerSlotImmediately(slot)
    }
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('ipc:events', {
        type: 'lease',
        phase: 'lost',
        seq: Date.now(),
        workspaceId: slot?.cwd || this.resolveWorkspaceCwd() || '',
        sessionFile: snapshot.sessionFile,
        timestamp: Date.now(),
        snapshot,
      } satisfies AppEvent)
    }
  }

  private requestOnSlot(
    slot: WorkerSlot,
    type: string,
    data?: WorkerRequestPayload,
  ): Promise<WorkerResponsePayload> {
    if (type === 'reloadAuthentication') {
      if (slot.authenticationReloading) return slot.authenticationReloading
      const request = slotRequest(slot, type, data as Record<string, unknown> | undefined)
      slot.authenticationReloading = request
      void request.then(
        () => {
          if (slot.authenticationReloading === request) slot.authenticationReloading = undefined
        },
        () => {
          if (slot.authenticationReloading === request) slot.authenticationReloading = undefined
        },
      )
      return request
    }
    const reload = slot.authenticationReloading
    if (!reload) return slotRequest(slot, type, data as Record<string, unknown> | undefined)
    return reload.then(() => {
      if (slot.stopping) throw new Error('Worker stopped during authentication reload')
      return slotRequest(slot, type, data as Record<string, unknown> | undefined)
    })
  }

  /**
   * Reload auth in place. If Pi cannot reopen the previous runtime, discard the
   * now-unhealthy process and recreate the same workspace/session from Main's
   * authoritative binding instead of retrying with lost Worker state.
   */
  private async reloadSlotAuthentication(slot: WorkerSlot): Promise<boolean> {
    if (slot.authenticationReloadLifecycle) {
      return slot.authenticationReloadLifecycle
    }
    const lifecycle = this.performSlotAuthenticationReload(slot)
    slot.authenticationReloadLifecycle = lifecycle
    void lifecycle.then(
      () => {
        if (slot.authenticationReloadLifecycle === lifecycle) {
          slot.authenticationReloadLifecycle = undefined
        }
      },
      () => {
        if (slot.authenticationReloadLifecycle === lifecycle) {
          slot.authenticationReloadLifecycle = undefined
        }
      },
    )
    return lifecycle
  }

  private enqueueSlotAuthenticationReload(slot: WorkerSlot): Promise<boolean> {
    const run = this.lifecycleChain.then(() => this.reloadSlotAuthentication(slot))
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async performSlotAuthenticationReload(slot: WorkerSlot): Promise<boolean> {
    if (slot.stopping || this.pool.get(slot.poolKey) !== slot) return false
    try {
      await this.requestOnSlot(slot, 'reloadAuthentication')
      return true
    } catch (error) {
      if (isDeferredAuthenticationReloadError(error)) {
        if (!slot.stopping && this.pool.get(slot.poolKey) === slot) {
          slot.pendingAuthenticationReload = true
        }
        return false
      }
      if (!isInvalidAuthenticationRuntimeError(error)) {
        if (!slot.stopping && this.pool.get(slot.poolKey) === slot) {
          slot.pendingAuthenticationReload = true
        }
        return false
      }
      const poolKey = slot.poolKey
      const cwd = slot.cwd
      const sessionFile = slot.sessionFile
      const wasForeground = this.foregroundPoolKey === poolKey
      if (slot.stopping || this.pool.get(poolKey) !== slot) return false
      if (this.pool.get(poolKey) === slot) this.pool.delete(poolKey)
      if (wasForeground) this.foregroundPoolKey = null
      slot.autoRestartEnabled = false
      await disposeWorkerSlot(slot).catch(() => {})

      try {
        if (sessionFile) {
          await this.ensureSessionWorkerUnlocked(sessionFile, cwd, {
            foreground: wasForeground,
          })
        } else {
          await this.startWorkspaceUnlocked(cwd)
        }
        auditRepository.write({
          category: 'worker',
          action: 'worker.authReload.recreate',
          outcome: 'success',
          workspaceId: cwd,
          sessionFile: sessionFile ?? undefined,
          details: { poolKey, reason: error instanceof Error ? error.message : String(error) },
        })
        return true
      } catch (recreateError) {
        auditRepository.write({
          category: 'worker',
          action: 'worker.authReload.recreate',
          outcome: 'failed',
          workspaceId: cwd,
          sessionFile: sessionFile ?? undefined,
          details: {
            poolKey,
            reloadError: error instanceof Error ? error.message : String(error),
            recreateError: recreateError instanceof Error ? recreateError.message : String(recreateError),
          },
        })
        return false
      }
    }
  }

  /**
   * Workspace cwd for lazy Worker creation.
   * After cold start without ensureWorker, foreground may be empty — fall back to
   * persisted currentProject so rewind/prompt can still spawn a session Worker.
   */
  resolveWorkspaceCwd(preferred?: string | null): string | null {
    const fromPreferred = preferred?.trim()
    if (fromPreferred) return fromPreferred
    if (this.cwd) return this.cwd
    const fromConfig = configStore.get('currentProject')
    if (typeof fromConfig === 'string' && fromConfig.trim()) return fromConfig.trim()
    return null
  }

  private async resolveSlotForRpc(sessionFile?: string | null): Promise<WorkerSlot> {
    // Replacement/start/ensure mutations share lifecycleChain. Waiting here
    // prevents lazy RPC routing from forking a duplicate replacement Worker.
    await this.lifecycleChain.catch(() => undefined)
    if (sessionFile) {
      const sk = normalizeSessionKey(sessionFile)
      const bySession = this.pool.get(sk)
      if (bySession && !bySession.stopping) {
        this.setForeground(bySession)
        return bySession
      }
      const cwd = this.resolveWorkspaceCwd(bySession?.cwd)
      if (!cwd) {
        // try any slot matching session after load on foreground
        const fg = this.foregroundSlot()
        if (fg) return fg
        throw new Error('Worker not started for session')
      }
      await this.ensureSessionWorker(sessionFile, cwd)
      const slot = this.pool.get(sk)
      if (!slot) throw new Error('Worker not started for session')
      return slot
    }
    const slot = this.foregroundSlot()
    if (!slot) throw new Error('Worker not started')
    return slot
  }

  private request(type: string, data?: WorkerRequestPayload): Promise<WorkerResponsePayload> {
    const sessionFile =
      data && typeof data === 'object' && 'sessionFile' in data
        ? (data as { sessionFile?: string }).sessionFile
        : undefined
    return this.resolveSlotForRpc(sessionFile).then((slot) => this.requestOnSlot(slot, type, data))
  }

  async getBackgroundRuntimeState(poolKeyOrCwd: string): Promise<WorkerState | null> {
    // Accept session key or legacy cwd
    let key = poolKeyOrCwd
    if (!this.pool.has(key) && !key.startsWith('ws:')) {
      key = workspacePoolKey(poolKeyOrCwd)
    }
    const row = await getBackgroundWorkerState(this.pool, key)
    if (!row) return null
    return (row.state as WorkerState) || null
  }

  async createBackgroundSession(cwd: string): Promise<{
    sessionId: string
    sessionFile: string
    workerKey: string
    model?: string
    thinkingLevel?: string
  } | null> {
    const run = this.lifecycleChain.then(() =>
      this.spawnBackgroundWorkerUnlocked(cwd),
    )
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  async ensureBackgroundSession(
    sessionFile: string,
    cwd: string,
  ): Promise<{
    sessionId: string
    sessionFile: string
    workerKey: string
    model?: string
    thinkingLevel?: string
  } | null> {
    const run = this.lifecycleChain.then(async () => {
      const key = normalizeSessionKey(sessionFile)
      const existing = this.pool.get(key)
      if (existing && !existing.stopping) {
        const state = await this.requestOnSlot(existing, 'getState')
        return this.backgroundDescriptor(existing, state.state as WorkerState)
      }
      return this.spawnBackgroundWorkerUnlocked(cwd, key)
    })
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async freeBackgroundCapacityUnlocked(): Promise<boolean> {
    const max = readMaxSessionWorkers()
    if (this.pool.size < max) return true
    let victim: WorkerSlot | null = null
    for (const slot of this.pool.values()) {
      if (
        slot.poolKey === this.foregroundPoolKey ||
        slot.agentTurnActive ||
        slot.stopping
      ) {
        continue
      }
      if (!victim || slot.lastIdleAt < victim.lastIdleAt) victim = slot
    }
    if (!victim) return false
    const victimKey = victim.poolKey
    if (this.pool.get(victimKey) === victim) this.pool.delete(victimKey)
    await disposeWorkerSlot(victim)
    return this.pool.size < max
  }

  private backgroundDescriptor(
    slot: WorkerSlot,
    state: WorkerState,
  ): {
    sessionId: string
    sessionFile: string
    workerKey: string
    model?: string
    thinkingLevel?: string
  } {
    return {
      sessionId: String(state.sessionId || ''),
      sessionFile: String(slot.sessionFile || state.sessionFile || ''),
      workerKey: slot.poolKey,
      model: typeof state.model === 'string' ? state.model : undefined,
      thinkingLevel:
        typeof state.thinkingLevel === 'string'
          ? state.thinkingLevel
          : undefined,
    }
  }

  private async spawnBackgroundWorkerUnlocked(
    cwd: string,
    requestedSessionFile?: string,
  ): Promise<{
    sessionId: string
    sessionFile: string
    workerKey: string
    model?: string
    thinkingLevel?: string
  } | null> {
    if (!(await this.freeBackgroundCapacityUnlocked())) return null
    const requestedKey = requestedSessionFile
      ? normalizeSessionKey(requestedSessionFile)
      : ''
    if (requestedKey) await this.acquireSessionLeaseOrThrow(requestedKey)
    const temporaryKey = `orchestration:${randomUUID()}`
    const { slot, init } = await forkWorkerForCwd(cwd, {
      poolKey: temporaryKey,
      sessionFile: requestedKey || null,
    })
    this.pool.set(temporaryKey, slot)
    this.attachSlot(slot)
    try {
      await init
      if (requestedKey) {
        await this.requestOnSlot(slot, 'loadSession', {
          sessionFile: requestedKey,
        })
      }
      const response = await this.requestOnSlot(slot, 'getState')
      const state = (response.state as WorkerState) || {}
      const sessionFile = normalizeSessionKey(
        String(requestedKey || state.sessionFile || ''),
      )
      if (!sessionFile) throw new Error('Background session file was not created')
      if (!requestedKey) await this.acquireSessionLeaseOrThrow(sessionFile)
      this.pool.delete(temporaryKey)
      slot.poolKey = sessionFile
      slot.sessionFile = sessionFile
      this.pool.set(sessionFile, slot)
      this.bindSlotLease(slot, sessionFile)
      return this.backgroundDescriptor(slot, { ...state, sessionFile })
    } catch (error) {
      if (this.pool.get(slot.poolKey) === slot) this.pool.delete(slot.poolKey)
      if (this.pool.get(temporaryKey) === slot) this.pool.delete(temporaryKey)
      await disposeWorkerSlot(slot).catch(() => {})
      if (requestedKey) await this.leaseService.release(requestedKey)
      throw error
    }
  }

  private backgroundSlot(sessionFile: string): WorkerSlot {
    const key = normalizeSessionKey(sessionFile)
    const slot = this.pool.get(key)
    if (!slot || slot.stopping) {
      throw new Error('Child session worker is not running')
    }
    return slot
  }

  async promptBackgroundSession(sessionFile: string, text: string): Promise<void> {
    const slot = this.backgroundSlot(sessionFile)
    await this.ensureWriteLease(sessionFile)
    await this.requestOnSlot(slot, 'prompt', { text, sessionFile })
  }

  async messageBackgroundSession(sessionFile: string, text: string): Promise<void> {
    const slot = this.backgroundSlot(sessionFile)
    await this.ensureWriteLease(sessionFile)
    await this.requestOnSlot(
      slot,
      slot.agentTurnActive ? 'steer' : 'followUp',
      { text, sessionFile },
    )
  }

  async configureBackgroundSession(
    sessionFile: string,
    options: { model?: string; thinkingLevel?: string },
  ): Promise<void> {
    const slot = this.backgroundSlot(sessionFile)
    const model = String(options.model || '')
    const separator = model.indexOf('/')
    if (separator > 0 && separator < model.length - 1) {
      await this.requestOnSlot(slot, 'setModel', {
        provider: model.slice(0, separator),
        modelId: model.slice(separator + 1),
      })
    }
    if (options.thinkingLevel) {
      await this.requestOnSlot(slot, 'setThinkingLevel', {
        level: options.thinkingLevel,
      })
    }
  }

  async stopBackgroundSession(sessionFile: string): Promise<void> {
    const key = normalizeSessionKey(sessionFile)
    const run = this.lifecycleChain.then(async () => {
      const slot = this.pool.get(key)
      if (!slot) return
      if (this.pool.get(key) === slot) this.pool.delete(key)
      if (this.foregroundPoolKey === key) this.foregroundPoolKey = null
      await disposeWorkerSlot(slot)
    })
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    await run
  }

  async abortBackgroundSession(sessionFile: string): Promise<void> {
    const slot = this.backgroundSlot(sessionFile)
    await this.ensureWriteLease(sessionFile)
    await this.requestOnSlot(slot, 'abort', { sessionFile })
    slot.agentTurnActive = false
    slot.lastIdleAt = Date.now()
  }

  /** Snapshot of running flags for renderer sessionRuntime */
  listSessionRuntime(): Array<{ sessionFile: string; running: boolean; cwd: string }> {
    const out: Array<{ sessionFile: string; running: boolean; cwd: string }> = []
    for (const slot of this.pool.values()) {
      if (!slot.sessionFile) continue
      out.push({
        sessionFile: slot.sessionFile,
        running: slot.agentTurnActive,
        cwd: slot.cwd,
      })
    }
    return out
  }

  diagnosticSnapshot(): WorkerDiagnosticSnapshot {
    return {
      poolSize: this.pool.size,
      foregroundPoolKey: this.foregroundPoolKey,
      workers: [...this.pool.values()].map((slot) => ({
        poolKey: slot.poolKey,
        cwd: slot.cwd,
        sessionBound: !!slot.sessionFile,
        running: slot.agentTurnActive,
        stopping: slot.stopping,
      })),
    }
  }

  /** True when any foreground or background worker still owns this workspace. */
  hasWorkspaceWorkers(cwd: string): boolean {
    const comparable = (value: string) => {
      const resolved = resolve(value)
      return process.platform === 'win32' ? resolved.toLowerCase() : resolved
    }
    const target = comparable(cwd)
    return [...this.pool.values()].some((slot) => comparable(slot.cwd) === target)
  }

  async sendPrompt(text: string, sessionFile?: string): Promise<void> {
    await this.ensureWriteLease(sessionFile)
    await this.request('prompt', { text, sessionFile })
  }
  /**
   * Abort agent turn on the session's existing worker only.
   * Never ensure/create a worker just to abort (would race F1 / wrong cwd).
   */
  async abort(sessionFile?: string): Promise<void> {
    if (sessionFile) {
      const sk = normalizeSessionKey(sessionFile)
      const slot = this.pool.get(sk)
      if (!slot || slot.stopping) {
        // No live worker for this session — already idle from UI's perspective.
        return
      }
      await this.ensureWriteLease(sk)
      await this.requestOnSlot(slot, 'abort', { sessionFile: sk })
      slot.agentTurnActive = false
      slot.lastIdleAt = Date.now()
      return
    }
    const fg = this.foregroundSlot()
    await this.ensureWriteLease(fg?.sessionFile ?? undefined)
    await this.request('abort', {})
    if (fg) {
      fg.agentTurnActive = false
      fg.lastIdleAt = Date.now()
    }
  }
  async steer(text: string, sessionFile?: string): Promise<void> {
    await this.ensureWriteLease(sessionFile)
    await this.request('steer', { text, sessionFile })
  }
  async followUp(text: string, sessionFile?: string): Promise<void> {
    await this.ensureWriteLease(sessionFile)
    await this.request('followUp', { text, sessionFile })
  }
  async clearPromptQueue(sessionFile?: string): Promise<{ steering: string[]; followUp: string[] }> {
    const r = await this.request('clearQueue', sessionFile ? { sessionFile } : {})
    return { steering: (r.steering as string[]) || [], followUp: (r.followUp as string[]) || [] }
  }
  async setModel(provider: string, modelId: string, sessionFile?: string): Promise<string> {
    const targetSessionFile = sessionFile || this.foregroundSessionFile || undefined
    const r = await this.performSessionMutation(targetSessionFile, () =>
      this.request('setModel', {
        provider,
        modelId,
        ...(targetSessionFile ? { sessionFile: targetSessionFile } : {}),
      }),
    )
    const actual = String(r.model ?? '').trim()
    if (!actual) throw new Error('Worker did not confirm the selected model')
    return actual
  }
  async setThinkingLevel(level: string): Promise<void> {
    await this.performSessionMutation(this.foregroundSessionFile ?? undefined, () =>
      this.request('setThinkingLevel', { level }),
    )
  }
  async newSession(
    conversationConfigSnapshot?: ConversationRuntimeSnapshot,
  ): Promise<{ sessionId: string; sessionFile?: string }> {
    await this.ensureWriteLease(this.foregroundSessionFile ?? undefined)
    const r = await this.request('newSession', {
      conversationConfigSnapshot: conversationConfigSnapshot ?? null,
    })
    const sessionId = String(r.sessionId ?? '')
    const sessionFile = r.sessionFile ? String(r.sessionFile) : undefined
    if (sessionFile) {
      await this.remapForegroundSlotToSessionFile(sessionFile)
    }
    return { sessionId, sessionFile }
  }

  /**
   * After Runtime creates a new session file (new/fork/clone), re-key the
   * foreground pool slot so subsequent RPCs hit the correct worker identity.
   */
  private async remapForegroundSlotToSessionFile(sessionFile: string): Promise<void> {
    const sk = normalizeSessionKey(sessionFile)
    if (!sk) return
    const slot = this.foregroundSlot()
    if (!slot || slot.stopping) return
    if (slot.sessionFile === sk && slot.poolKey === sk) return
    const previousSessionFile = slot.sessionFile
    await this.acquireSessionLeaseOrThrow(sk)
    const previousKey = slot.poolKey
    if (previousKey !== sk) {
      this.pool.delete(previousKey)
      slot.poolKey = sk
      this.pool.set(sk, slot)
      this.foregroundPoolKey = sk
    }
    slot.sessionFile = sk
    this.bindSlotLease(slot, sk)
    if (previousSessionFile && previousSessionFile !== sk) {
      await this.leaseService.release(previousSessionFile)
    }
  }

  async forkSession(opts: {
    sessionFile: string
    entryId: string
    position?: 'before' | 'at'
  }): Promise<{
    cancelled?: boolean
    error?: string
    sessionId?: string
    sessionFile?: string
    editorText?: string
    model?: string
    thinkingLevel?: string
  }> {
    const cwd = this.resolveWorkspaceCwd()
    if (!cwd) return { error: 'worker_not_ready' }
    await this.ensureSessionWorker(opts.sessionFile, cwd)
    await this.ensureWriteLease(opts.sessionFile)
    const r = await this.request('fork', {
      sessionFile: opts.sessionFile,
      entryId: opts.entryId,
      position: opts.position,
    })
    if (r.type === 'error') {
      return { error: String((r as { error?: string }).error || 'fork failed') }
    }
    const sessionFile = r.sessionFile ? String(r.sessionFile) : undefined
    if (sessionFile) await this.remapForegroundSlotToSessionFile(sessionFile)
    return {
      cancelled: !!r.cancelled,
      sessionId: r.sessionId ? String(r.sessionId) : undefined,
      sessionFile,
      editorText: r.editorText as string | undefined,
      model: r.model as string | undefined,
      thinkingLevel: r.thinkingLevel as string | undefined,
    }
  }

  async cloneSession(opts: { sessionFile: string }): Promise<{
    cancelled?: boolean
    error?: string
    sessionId?: string
    sessionFile?: string
    model?: string
    thinkingLevel?: string
  }> {
    const cwd = this.resolveWorkspaceCwd()
    if (!cwd) return { error: 'worker_not_ready' }
    await this.ensureSessionWorker(opts.sessionFile, cwd)
    await this.ensureWriteLease(opts.sessionFile)
    const r = await this.request('clone', { sessionFile: opts.sessionFile })
    if (r.type === 'error') {
      return { error: String((r as { error?: string }).error || 'clone failed') }
    }
    const sessionFile = r.sessionFile ? String(r.sessionFile) : undefined
    if (sessionFile) await this.remapForegroundSlotToSessionFile(sessionFile)
    return {
      cancelled: !!r.cancelled,
      sessionId: r.sessionId ? String(r.sessionId) : undefined,
      sessionFile,
      model: r.model as string | undefined,
      thinkingLevel: r.thinkingLevel as string | undefined,
    }
  }

  async getForkMessages(sessionFile?: string): Promise<Array<{ entryId: string; text: string }>> {
    const r = await this.request('getForkMessages', sessionFile ? { sessionFile } : {})
    if (r.type === 'error') return []
    return (r.messages as Array<{ entryId: string; text: string }>) || []
  }

  async listSessions(cwd?: string): Promise<WorkerSessionOnDisk[]> {
    const r = await this.request('listSessions', { cwd })
    return (r.sessions as WorkerSessionOnDisk[]) || []
  }
  /**
   * Read-only runtime snapshot.
   * When sessionFile is set: ONLY query an existing pool slot for that session.
   * Never fall back to another session's foreground worker (would mis-report isStreaming),
   * and never ensure/create a worker just for a status poll.
   */
  async getState(sessionFile?: string): Promise<WorkerState> {
    if (sessionFile) {
      const sk = normalizeSessionKey(sessionFile)
      const slot = this.pool.get(sk)
      if (!slot || slot.stopping) {
        return {
          sessionFile: sk || sessionFile,
          isStreaming: false,
        } as WorkerState
      }
      try {
        const r = await this.requestOnSlot(slot, 'getState')
        const state = ((r.state as WorkerState) || {}) as WorkerState
        // Always stamp the pool identity so renderer cannot mis-attribute streaming.
        return {
          ...state,
          sessionFile: slot.sessionFile || sk,
          isStreaming: !!(state as { isStreaming?: boolean }).isStreaming || slot.agentTurnActive,
        }
      } catch {
        return {
          sessionFile: slot.sessionFile || sk,
          isStreaming: slot.agentTurnActive,
        } as WorkerState
      }
    }
    return ((await this.request('getState', {})).state as WorkerState) || {}
  }
  async getCommands(): Promise<{ commands: WorkerCommandInfo[]; hasSession: boolean }> {
    const r = await this.request('getCommands')
    return { commands: (r.commands as WorkerCommandInfo[]) || [], hasSession: !!r.hasSession }
  }
  async getSessionContextPreview(): Promise<WorkerContextPreview> {
    const r = await this.request('getSessionContextPreview')
    return (r.preview as WorkerContextPreview) || null
  }
  async getSkillsList(): Promise<WorkerSkillInfo[]> {
    const r = await this.request('getSkillsList')
    return (r.skills as WorkerSkillInfo[]) || []
  }
  async getPromptTemplatesList(): Promise<WorkerPromptTemplate[]> {
    const r = await this.request('getPromptTemplatesList')
    return (r.prompts as WorkerPromptTemplate[]) || []
  }
  async getContextPrompts(): Promise<WorkerResponsePayload> {
    return this.request('getContextPrompts')
  }
  async reloadResources(): Promise<void> {
    await this.request('reloadResources')
  }
  async getCommandCompletions(commandName: string, argumentPrefix: string): Promise<WorkerCompletionItem[]> {
    const r = await this.request('getCommandCompletions', { commandName, argumentPrefix })
    return (r.items as WorkerCompletionItem[]) || []
  }
  async getModels(): Promise<WorkerModelRow[]> {
    const r = await this.request('getModels')
    return (r.models as WorkerModelRow[]) || []
  }
  async reloadModels(): Promise<void> {
    if (!this.isRunning) return
    await this.request('reloadModels')
  }
  async getPiSettings(): Promise<Record<string, unknown>> {
    return ((await this.request('getPiSettings')).settings as Record<string, unknown>) || {}
  }
  async setPiSettings(patch: Record<string, unknown>): Promise<void> {
    await this.performSessionMutation(this.foregroundSessionFile ?? undefined, () =>
      this.request('setPiSettings', { patch }),
    )
  }
  async getMessages(
    sessionFile: string,
    offset?: number,
    limit?: number,
    leafId?: string | null,
  ): Promise<WorkerMessagesPage> {
    const payload: Record<string, unknown> = { sessionFile, offset, limit }
    if (leafId !== undefined) payload.leafId = leafId
    const r = await this.request('getMessages', payload)
    return {
      items: (r.items as WorkerMessagesPage['items']) || [],
      totalCount:
        typeof r.totalCount === 'number'
          ? r.totalCount
          : Array.isArray(r.items)
            ? r.items.length
            : 0,
      sessionMeta: r.sessionMeta as WorkerMessagesPage['sessionMeta'],
    }
  }
  async loadSession(
    sessionFile: string,
    opts?: {
      force?: boolean
      cwd?: string
      leafId?: string | null
      conversationConfigSnapshot?: ConversationRuntimeSnapshot | null
    },
  ): Promise<{
    sessionId: string
    model?: string
    leafId?: string | null
    thinkingLevel?: string
    modelFallbackMessage?: string
  }> {
    // Lazy-start path: must resolve cwd even when no Worker is running yet.
    const cwd = this.resolveWorkspaceCwd(opts?.cwd)
    if (!cwd) {
      throw new Error('Worker not started for session')
    }
    await this.ensureSessionWorker(sessionFile, cwd)
    await this.ensureWriteLease(sessionFile)
    // Re-apply rewound leaf tip (main override map) so agent context matches UI.
    let leafId = opts?.leafId
    if (leafId === undefined) {
      try {
        const { getSessionLeafOverride } = await import('./session-leaf-override.js')
        leafId = getSessionLeafOverride(sessionFile)
      } catch {
        leafId = undefined
      }
    }
    const storedConversationConfig =
      opts?.conversationConfigSnapshot === undefined
        ? getConversationConfigBinding({ sessionFile })?.snapshot ?? null
        : opts.conversationConfigSnapshot
    const r = await this.request('loadSession', {
      sessionFile,
      force: opts?.force === true,
      conversationConfigSnapshot: storedConversationConfig,
      ...(leafId !== undefined ? { leafId } : {}),
    })
    const sk = normalizeSessionKey(sessionFile)
    const slot = this.pool.get(sk) || this.foregroundSlot()
    if (slot) {
      slot.sessionFile = sk
      if (slot.poolKey !== sk && sk) {
        this.pool.delete(slot.poolKey)
        slot.poolKey = sk
        this.pool.set(sk, slot)
        this.foregroundPoolKey = sk
      }
    }
    return {
      sessionId: String(r.sessionId ?? ''),
      model: r.model as string | undefined,
      leafId: (r.leafId as string | null | undefined) ?? null,
      thinkingLevel: r.thinkingLevel as string | undefined,
      modelFallbackMessage: r.modelFallbackMessage as string | undefined,
    }
  }
  async renameSessionFile(sessionFile: string, title: string): Promise<{ ok: boolean; title?: string; error?: string }> {
    const r = await this.performSessionMutation(sessionFile, () =>
      this.request('sessionRenameFile', { sessionFile, title }),
    )
    return { ok: !!r.ok, title: r.title as string | undefined, error: r.error as string | undefined }
  }
  async deleteSessionFile(sessionFile: string): Promise<{ ok: boolean; error?: string }> {
    await this.ensureWriteLease(sessionFile)
    const r = await this.request('sessionDeleteFile', { sessionFile })
    return { ok: !!r.ok, error: r.error as string | undefined }
  }
  async getSessionTree(sessionFile?: string): Promise<{ nodes: WorkerSessionTreeNode[]; leafId: string | null; error?: string }> {
    const r = await this.request('getSessionTree', sessionFile ? { sessionFile } : {})
    return {
      nodes: (r.nodes as WorkerSessionTreeNode[]) || [],
      leafId: (r.leafId as string | null) ?? null,
      error: r.error as string | undefined,
    }
  }
  async navigateTree(
    targetId: string,
    options?: { summarize?: boolean; label?: string; sessionFile?: string },
  ): Promise<{
    cancelled: boolean
    editorText?: string
    leafId?: string | null
    sessionMeta?: { model?: string; thinkingLevel?: string }
    error?: string
  }> {
    const sessionFile = options?.sessionFile
    const r = await this.performSessionMutation(sessionFile, () =>
      this.request('navigateTree', {
        targetId,
        summarize: options?.summarize,
        label: options?.label,
        ...(sessionFile ? { sessionFile } : {}),
      }),
    )
    if (r.type === 'error') {
      return {
        cancelled: true,
        error: String((r as { error?: string }).error || 'navigateTree failed'),
      }
    }
    return {
      cancelled: !!r.cancelled,
      editorText: r.editorText as string | undefined,
      leafId: (r.leafId as string | null) ?? null,
      sessionMeta: r.sessionMeta as { model?: string; thinkingLevel?: string } | undefined,
    }
  }
  async runExtensionCommand(text: string): Promise<void> {
    await this.ensureWriteLease(this.foregroundSessionFile ?? undefined)
    await this.request('runExtensionCommand', { text })
  }

  respondExtensionUI(response: {
    id: string
    value?: string
    confirmed?: boolean
    cancelled?: boolean
    result?: unknown
  }): void {
    const slot = this.foregroundSlot()
    if (!slot) return
    slot.worker.postMessage({ type: 'extension-ui-response', response })
  }

  get isRunning(): boolean {
    return this.foregroundSlot() != null
  }

  async awaitReady(): Promise<void> {
    const slot = this.foregroundSlot()
    if (slot?.initPromise) await slot.initPromise.catch(() => {})
  }

  async updateProviderRouting(
    config: ProviderRoutingRuntime,
  ): Promise<{ updated: number; deferred: number }> {
    const live = [...this.pool.values()].filter((slot) => !slot.stopping)
    const idle = live.filter((slot) => !slot.agentTurnActive)
    const active = live.filter((slot) => slot.agentTurnActive)
    for (const slot of active) slot.pendingProviderRouting = config
    await Promise.all(
      idle.map((slot) =>
        this.requestOnSlot(slot, 'setProviderRouting', {
          providerRouting: config,
        }),
      ),
    )
    return { updated: idle.length, deferred: active.length }
  }

  async reloadAuthentication(): Promise<{ updated: number; deferred: number }> {
    const run = this.lifecycleChain.then(() => this.reloadAuthenticationUnlocked())
    this.lifecycleChain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private async reloadAuthenticationUnlocked(): Promise<{ updated: number; deferred: number }> {
    const live = [...this.pool.values()].filter((slot) => !slot.stopping)
    const idle = live.filter((slot) => !slot.agentTurnActive)
    const active = live.filter((slot) => slot.agentTurnActive)
    for (const slot of active) slot.pendingAuthenticationReload = true
    const refreshed: boolean[] = []
    for (const slot of idle) refreshed.push(await this.reloadSlotAuthentication(slot))
    const updated = refreshed.filter(Boolean).length
    return { updated, deferred: active.length + idle.length - updated }
  }

  get cwd(): string | null {
    return this.foregroundSlot()?.cwd ?? null
  }

  get lastSdkFallback(): boolean {
    return this.foregroundSlot()?.sdkFallback ?? false
  }

  get foregroundSessionFile(): string | null {
    return this.foregroundSlot()?.sessionFile ?? null
  }
}

export const workerManager = new WorkerManager()
