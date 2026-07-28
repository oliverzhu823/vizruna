import type { UtilityProcess } from 'electron'
import type { AppEvent } from '@shared/app-events'
import type { WorkerResponsePayload } from '@shared/worker-rpc-types'
import type { ProviderRoutingRuntime } from '@shared/provider-routing'

export type WorkerInitResult = {
  sessionId: string
  model?: string
  thinkingLevel?: string
}

export type WorkerSlot = {
  /** Pool map key: sessionFile abs path or `ws:${cwd}` */
  poolKey: string
  cwd: string
  /** Bound session file when known; null for workspace-only slots */
  sessionFile: string | null
  worker: UtilityProcess
  pendingRequests: Map<
    string,
    { resolve: (v: WorkerResponsePayload) => void; reject: (e: Error) => void; timer: NodeJS.Timeout }
  >
  requestCounter: number
  initResolver: ((r: WorkerInitResult) => void) | null
  initRejecter: ((e: Error) => void) | null
  initPromise: Promise<WorkerInitResult> | null
  agentTurnActive: boolean
  /** Last time turn became idle (ms); used for idle TTL eviction */
  lastIdleAt: number
  /** Last time this slot was foreground (ms) */
  lastForegroundAt: number
  sdkFallback: boolean
  autoRestartEnabled: boolean
  stopping: boolean
  /** Called once after the process can no longer append to its session. */
  onDisposed?: () => void | Promise<void>
  /** Re-check write ownership immediately before graceful abort/dispose can flush JSONL. */
  beforeWrite?: () => void | Promise<void>
  disposedCallbackCalled: boolean
  /** Latest route update held until the current model turn reaches idle. */
  pendingProviderRouting?: ProviderRoutingRuntime
  /** GUI auth changed auth.json; reload Pi services when this slot becomes idle. */
  pendingAuthenticationReload?: boolean
  /** Prevent normal RPCs from racing an in-process authentication runtime reload. */
  authenticationReloading?: Promise<WorkerResponsePayload>
  /** Coalesces reload plus failure recovery for concurrent auth mutations. */
  authenticationReloadLifecycle?: Promise<boolean>
}

export type WorkerAppEventForward = {
  event: AppEvent
  fromCwd: string
  fromPoolKey: string
  sessionFile: string | null
  agentTurnActive: boolean
}
