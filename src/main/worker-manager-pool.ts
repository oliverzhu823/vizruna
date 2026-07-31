import { utilityProcess, app, type BrowserWindow } from 'electron'
import { join } from 'path'
import type { AppEvent } from '@shared/app-events'
import type { WorkerResponsePayload } from '@shared/worker-rpc-types'
import type {
  OrchestrationWorkerRequest,
  OrchestrationWorkerResponse,
} from '@shared/orchestration'
import { resolveActiveSdk } from './sdk-loader'
import type { WorkerInitResult, WorkerSlot } from './worker-manager-types'
import { readMaxSessionWorkers, minutesToIdleDelayMs, readSessionWorkerIdleTimeoutMinutes } from './worker-pool-config'
import { workspacePoolKey } from './worker-session-key'
import { getProviderRoutingService } from './provider-routing/provider-routing-service'
import { resolveApplicationRoot } from './application-root'

function createSlot(
  poolKey: string,
  cwd: string,
  worker: Electron.UtilityProcess,
  sessionFile: string | null = null,
): WorkerSlot {
  const now = Date.now()
  return {
    poolKey,
    cwd,
    sessionFile,
    worker,
    pendingRequests: new Map(),
    requestCounter: 0,
    initResolver: null,
    initRejecter: null,
    initPromise: null,
    agentTurnActive: false,
    lastIdleAt: now,
    lastForegroundAt: now,
    sdkFallback: false,
    autoRestartEnabled: true,
    stopping: false,
    disposedCallbackCalled: false,
  }
}

function safeWrite(msg: string): void {
  try {
    process.stderr.write(msg + '\n')
  } catch {
    /* ignore */
  }
}

export function attachWorkerHandlers(
  slot: WorkerSlot,
  forked: Electron.UtilityProcess,
  opts: {
    mainWindow: BrowserWindow | null
    onAppEvent: (payload: {
      event: AppEvent
      fromCwd: string
      fromPoolKey: string
      sessionFile: string | null
      agentTurnActive: boolean
    }) => void
    onSlotExit: (slot: WorkerSlot, code: number) => void
    onOrchestrationRequest?: (
      payload: {
        request: unknown
        parentSessionFile: string | null
        parentWorkerKey: string
        rootWorkspacePath: string
      },
    ) => Promise<OrchestrationWorkerResponse>
    onExtensionUiRequest?: (payload: {
      request: unknown
      fromCwd: string
      fromPoolKey: string
      sessionFile: string | null
    }) => void
    /** When set, only forward extension UI from this pool key (X1). */
    getForegroundPoolKey?: () => string | null
  },
): void {
  if (forked.stderr) {
    forked.stderr.on('error', () => {})
    forked.stderr.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) safeWrite(`[Worker:stderr] ${line}`)
      }
    })
  }
  if (forked.stdout) {
    forked.stdout.on('error', () => {})
    forked.stdout.on('data', (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (line.trim()) safeWrite(`[Worker:stdout] ${line}`)
      }
    })
  }

  forked.on('message', (event: { data?: WorkerResponsePayload } | WorkerResponsePayload) => {
    if (slot.worker !== forked) return
    const data = (typeof event === 'object' && event !== null && 'data' in event
      ? (event as { data?: WorkerResponsePayload }).data
      : event) as WorkerResponsePayload | undefined
    if (!data) return

    if (data.type === 'orchestration-request') {
      const rpcId = typeof data.rpcId === 'string' ? data.rpcId : ''
      if (!rpcId) return
      const respond = (response: OrchestrationWorkerResponse) => {
        try {
          forked.postMessage({ type: 'orchestration-response', rpcId, response })
        } catch {
          /* worker exited */
        }
      }
      if (!opts.onOrchestrationRequest) {
        respond({
          ok: false,
          code: 'ORCHESTRATION_UNAVAILABLE',
          error: 'Orchestration service is unavailable',
        })
        return
      }
      void opts
        .onOrchestrationRequest({
          request: data.request as OrchestrationWorkerRequest,
          parentSessionFile: slot.sessionFile,
          parentWorkerKey: slot.poolKey,
          rootWorkspacePath: slot.cwd,
        })
        .then(respond)
        .catch((error) =>
          respond({
            ok: false,
            code: 'ORCHESTRATION_ERROR',
            error: error instanceof Error ? error.message : String(error),
          }),
        )
      return
    }

    if (data.type === 'app-event') {
      const ev = data.event as AppEvent
      if (ev?.type === 'run') {
        if (ev.phase === 'running' || ev.phase === 'started') {
          slot.agentTurnActive = true
        } else if (ev.phase === 'idle' || ev.phase === 'failed' || ev.phase === 'cancelled') {
          slot.agentTurnActive = false
          slot.lastIdleAt = Date.now()
        }
      }
      opts.onAppEvent({
        event: ev,
        fromCwd: slot.cwd,
        fromPoolKey: slot.poolKey,
        sessionFile: slot.sessionFile,
        agentTurnActive: slot.agentTurnActive,
      })
    }

    const win = opts.mainWindow
    if (
      (data.type === 'extension-ui-dismiss' || data.type === 'extension-ui-dismiss-all') &&
      win &&
      !win.isDestroyed()
    ) {
      const fg = opts.getForegroundPoolKey?.() ?? null
      if (fg && fg !== slot.poolKey) {
        // X1: only foreground session dismiss noise
      } else {
        win.webContents.send('ipc:extension-ui-dismiss', {
          type: data.type,
          id: data.id,
          reason: data.reason,
        })
      }
    }

    if (data.type === 'extension-ui-request') {
      opts.onExtensionUiRequest?.({
        request: data.request,
        fromCwd: slot.cwd,
        fromPoolKey: slot.poolKey,
        sessionFile: slot.sessionFile,
      })
    }

    if (data.type === 'extension-ui-request' && win && !win.isDestroyed()) {
      const req = data.request as { method?: string; notifyType?: string; message?: string }
      const method = req?.method || ''
      const fg = opts.getForegroundPoolKey?.() ?? null
      const isForeground = !fg || fg === slot.poolKey
      if (!isForeground && method !== 'notify') return
      const allow =
        method !== 'notify' || slot.agentTurnActive || req.notifyType === 'error'
      if (!allow) return
      if (!isForeground && req.notifyType !== 'error') return
      win.webContents.send('ipc:extension-ui-request', data.request)
    }

    if (data.type === 'init-done' && slot.initResolver) {
      slot.sdkFallback = !!data.sdkFallback
      if (slot.sdkFallback) safeWrite('[WorkerManager] Target SDK import failed, worker fell back to builtin')
      slot.initResolver({
        sessionId: String(data.sessionId ?? ''),
        model: data.model as string | undefined,
        thinkingLevel: data.thinkingLevel as string | undefined,
      })
      slot.initResolver = null
      slot.initRejecter = null
    }
    if (data.type === 'error' && slot.initRejecter) {
      slot.initRejecter(new Error(String(data.error ?? 'Worker error')))
      slot.initResolver = null
      slot.initRejecter = null
      slot.initPromise = null
    }

    const requestId = typeof data.requestId === 'string' ? data.requestId : ''
    if (requestId && slot.pendingRequests.has(requestId)) {
      const pending = slot.pendingRequests.get(requestId)!
      clearTimeout(pending.timer)
      slot.pendingRequests.delete(requestId)
      if (data.type === 'error') pending.reject(new Error(String(data.error ?? 'Worker error')))
      else pending.resolve(data)
    }
  })

  forked.on('exit', (code) => {
    if (slot.worker !== forked) {
      safeWrite(`[WorkerManager] Ignoring stale worker exit (code ${code})`)
      return
    }
    opts.onSlotExit(slot, code)
  })
}

export async function disposeWorkerSlot(slot: WorkerSlot): Promise<void> {
  slot.stopping = true
  if (slot.initRejecter) {
    slot.initRejecter(new Error('Worker stopped'))
    slot.initResolver = null
    slot.initRejecter = null
  }
  slot.initPromise = null
  const proc = slot.worker
  const wasActive = !!slot.agentTurnActive
  let gracefulWriteAllowed = true
  if (slot.sessionFile && slot.beforeWrite) {
    try {
      await slot.beforeWrite()
    } catch {
      gracefulWriteAllowed = false
    }
  }
  if (!gracefulWriteAllowed) {
    await terminateWorkerSlotImmediately(slot)
    return
  }
  // Always try abort on dispose when we have a session file — agentTurnActive can lag
  // behind true streaming if events were missed, and force-quit needs a terminal leaf.
  if (wasActive || slot.sessionFile) {
    try {
      await slotRequest(slot, 'abort', slot.sessionFile ? { sessionFile: slot.sessionFile } : {}).catch(
        () => null,
      )
    } catch {
      /* ignore */
    }
    // Give pi SessionManager time to persist aborted assistant entry
    await new Promise((r) => setTimeout(r, wasActive ? 200 : 80))
  }
  try {
    proc.postMessage({ type: 'dispose' })
  } catch {
    /* ignore */
  }
  // Allow worker to flush session JSONL after abort+dispose
  await new Promise((r) => setTimeout(r, wasActive ? 500 : 250))
  try {
    proc.kill()
  } catch {
    /* ignore */
  }
  for (const [, pending] of slot.pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Worker stopped'))
  }
  slot.pendingRequests.clear()
  await finalizeWorkerSlotDisposal(slot)
}

export async function finalizeWorkerSlotDisposal(slot: WorkerSlot): Promise<void> {
  if (slot.disposedCallbackCalled) return
  slot.disposedCallbackCalled = true
  await slot.onDisposed?.()
}

/**
 * Lease loss is different from normal disposal: do not send abort/dispose because
 * either message could append after this process stopped owning the session.
 */
export async function terminateWorkerSlotImmediately(slot: WorkerSlot): Promise<void> {
  slot.stopping = true
  slot.autoRestartEnabled = false
  slot.beforeWrite = undefined
  try {
    slot.worker.kill()
  } catch {
    /* ignore */
  }
  for (const [, pending] of slot.pendingRequests) {
    clearTimeout(pending.timer)
    pending.reject(new Error('Worker terminated because its session lease was lost'))
  }
  slot.pendingRequests.clear()
  await finalizeWorkerSlotDisposal(slot)
}

export function slotRequest(
  slot: WorkerSlot,
  type: string,
  data?: Record<string, unknown>,
): Promise<WorkerResponsePayload> {
  const proc = slot.worker
  const requestId = `req-${++slot.requestCounter}`
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      if (slot.pendingRequests.has(requestId)) {
        slot.pendingRequests.delete(requestId)
        reject(new Error(`Worker request ${type} timed out`))
      }
    }, 120000)
    slot.pendingRequests.set(requestId, { resolve, reject, timer })
    try {
      proc.postMessage({ type, requestId, ...data })
    } catch (e) {
      clearTimeout(timer)
      slot.pendingRequests.delete(requestId)
      reject(e)
    }
  })
}

export async function forkWorkerForCwd(
  cwd: string,
  opts?: { poolKey?: string; sessionFile?: string | null },
): Promise<{ slot: WorkerSlot; init: Promise<WorkerInitResult> }> {
  const poolKey = opts?.poolKey || workspacePoolKey(cwd)
  const applicationRoot = resolveApplicationRoot(app.getAppPath())
  const forked = utilityProcess.fork(
    join(applicationRoot, 'out', 'main', 'worker.mjs'),
    [],
    { stdio: 'pipe' },
  )
  const slot = createSlot(poolKey, cwd, forked, opts?.sessionFile ?? null)
  const initPromise = new Promise<WorkerInitResult>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (slot.worker !== forked) return
      slot.initResolver = null
      slot.initRejecter = null
      slot.initPromise = null
      reject(new Error('Worker init timeout (60s)'))
    }, 60000)
    slot.initResolver = (r) => {
      clearTimeout(timer)
      resolve(r)
    }
    slot.initRejecter = (e) => {
      clearTimeout(timer)
      reject(e)
    }
  })
  slot.initPromise = initPromise
  const activeSdk = resolveActiveSdk(app.getPath('userData'))
  const sdkPath = activeSdk.kind === 'builtin' ? null : activeSdk.entryPath
  forked.postMessage({
    type: 'init',
    cwd,
    sdkPath,
    providerRouting: getProviderRoutingService().runtimeConfig(),
  })
  return { slot, init: initPromise }
}

/**
 * Evict idle workers to free capacity. Never disposes agentTurnActive slots.
 * @deprecated Prefer evictIdleWorkers with maxWorkers from settings.
 */
export function evictBackgroundWorkers(
  pool: Map<string, WorkerSlot>,
  foregroundKey: string,
  keepKey?: string | null,
): void {
  evictIdleWorkers(pool, {
    foregroundKey,
    keepKeys: keepKey ? [keepKey] : [],
    maxWorkers: readMaxSessionWorkers(),
  })
}

export function evictIdleWorkers(
  pool: Map<string, WorkerSlot>,
  opts: {
    foregroundKey: string | null
    keepKeys?: string[]
    maxWorkers?: number
  },
): void {
  const maxWorkers = opts.maxWorkers ?? readMaxSessionWorkers()
  const keep = new Set<string>()
  if (opts.foregroundKey) keep.add(opts.foregroundKey)
  for (const k of opts.keepKeys || []) {
    if (k) keep.add(k)
  }

  // Drop idle slots not in keep set (soft cleanup on switch)
  for (const [key, slot] of pool) {
    if (keep.has(key)) continue
    if (slot.agentTurnActive) continue
    void disposeWorkerSlot(slot).then(() => {
      if (pool.get(key) === slot) pool.delete(key)
    })
  }

  // Hard capacity: dispose oldest-foreground idle first
  while (pool.size > maxWorkers) {
    let victimKey: string | null = null
    let oldestFg = Number.POSITIVE_INFINITY
    for (const [key, slot] of pool) {
      if (key === opts.foregroundKey || slot.agentTurnActive) continue
      if (slot.lastForegroundAt < oldestFg) {
        oldestFg = slot.lastForegroundAt
        victimKey = key
      }
    }
    if (!victimKey) break
    const s = pool.get(victimKey)!
    void disposeWorkerSlot(s).then(() => {
      if (pool.get(victimKey!) === s) pool.delete(victimKey!)
    })
    // Sync delete so while loop progresses even if dispose is async
    pool.delete(victimKey)
  }
}

/** Dispose idle slots past TTL. Returns number of slots disposed. */
export function pruneIdleWorkersByTimeout(
  pool: Map<string, WorkerSlot>,
  foregroundKey: string | null,
  nowMs = Date.now(),
): number {
  const delay = minutesToIdleDelayMs(readSessionWorkerIdleTimeoutMinutes())
  if (delay == null) return 0
  let removed = 0
  for (const [key, slot] of [...pool.entries()]) {
    if (key === foregroundKey) continue
    if (slot.agentTurnActive) continue
    if (nowMs - slot.lastIdleAt < delay) continue
    void disposeWorkerSlot(slot)
    pool.delete(key)
    removed++
  }
  return removed
}

export async function getBackgroundWorkerState(
  pool: Map<string, WorkerSlot>,
  poolKey: string,
): Promise<{ cwd: string; poolKey: string; state: Record<string, unknown> } | null> {
  const slot = pool.get(poolKey)
  if (!slot || slot.stopping) return null
  try {
    const r = await slotRequest(slot, 'getState')
    const state = (r.state as Record<string, unknown>) || {}
    return { cwd: slot.cwd, poolKey, state }
  } catch {
    return null
  }
}

export function canAcquireNewWorker(
  pool: Map<string, WorkerSlot>,
  maxWorkers?: number,
): { ok: true } | { ok: false; reason: string } {
  const max = maxWorkers ?? readMaxSessionWorkers()
  if (pool.size < max) return { ok: true }
  for (const slot of pool.values()) {
    if (!slot.agentTurnActive) return { ok: true }
  }
  return {
    ok: false,
    reason: `Worker pool full (${max} running sessions). Stop a turn or raise maxSessionWorkers.`,
  }
}
