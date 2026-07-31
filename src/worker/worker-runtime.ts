import type {
  AgentSession,
  AgentSessionEvent,
  AgentSessionRuntime,
  CreateAgentSessionRuntimeFactory,
  EventBus,
} from '@earendil-works/pi-coding-agent'
import type { ConversationRuntimeSnapshot } from '@shared/system-prompt-preset'
import type { AppEvent } from '@shared/app-events'
import { formatSessionModelKey, type SessionModelRef } from '@shared/worker-model'
import { createDesktopUIBridge, type DesktopUIBridge } from './desktop-ui-bridge.js'
import {
  buildAgentPromptLoaderOverrides,
  buildAgentToolsOverride,
} from './agent-profile-runtime.js'
import { handleSessionEvent as dispatchSessionEvent } from './worker-session-events.js'
import { errorMessage } from '@shared/error-message'
import { createOrchestrationTools } from './orchestration-tools.js'
import type { ProviderRoutingRuntime } from '@shared/provider-routing'
import { installProviderRouting } from './provider-routing-runtime.js'
import {
  AUTH_RELOAD_ALREADY_RUNNING,
  AUTH_RELOAD_DEFERRED_ACTIVE_TURN,
  AUTH_RELOAD_RUNTIME_INVALID,
} from '@shared/worker-auth-reload'

export type WorkerMutableState = {
  sdk: typeof import('@earendil-works/pi-coding-agent') | null
  activeSdkPath: string | null
  sharedEventBus: EventBus | null
  /** Live AgentSession (always mirrors runtime.session when runtime is set). */
  session: AgentSession | null
  /** Owns session replacement: new / switch / fork / clone. */
  runtime: AgentSessionRuntime | null
  uiBridge: DesktopUIBridge | null
  seq: number
  currentCwd: string
  currentSessionId: string
  currentRunId: string
  currentTurnId: string
  unsubscribe: (() => void) | null
  agentTurnActive: boolean
  promptSent: boolean
  runtimeReloading: boolean
  providerRouting: ProviderRoutingRuntime
  /** Conversation configuration currently bound to the live conversation. */
  activeConversationConfig: ConversationRuntimeSnapshot | null
  /**
   * Staged configuration for the next runtime replacement.
   * `undefined` means retain the active configuration; `null` means General Pi.
   */
  nextConversationConfig: ConversationRuntimeSnapshot | null | undefined
}

export const st: WorkerMutableState = {
  sdk: null,
  activeSdkPath: null,
  sharedEventBus: null,
  session: null,
  runtime: null,
  uiBridge: null,
  seq: 0,
  currentCwd: '',
  currentSessionId: '',
  currentRunId: '',
  currentTurnId: '',
  unsubscribe: null,
  agentTurnActive: false,
  promptSent: false,
  runtimeReloading: false,
  providerRouting: { routes: {} },
  activeConversationConfig: null,
  nextConversationConfig: undefined,
}

function nextSeq(): number {
  return ++st.seq
}

export function emit(event: AppEvent): void {
  process.parentPort?.postMessage({ type: 'app-event', event })
}

function now(): number {
  return Date.now()
}

export function currentSessionModelKey(): string | undefined {
  return st.session ? formatSessionModelKey(st.session.model as SessionModelRef) : undefined
}

export function baseEvent() {
  return {
    seq: nextSeq(),
    workspaceId: st.currentCwd,
    sessionId: st.currentSessionId,
    sessionFile: st.session?.sessionFile,
    runId: st.currentRunId,
    turnId: st.currentTurnId,
    timestamp: now(),
  }
}

export function isSessionBusy(): boolean {
  return !!(st.agentTurnActive || st.session?.isStreaming)
}

function detachSessionSubscription(): void {
  if (st.unsubscribe) {
    st.unsubscribe()
    st.unsubscribe = null
  }
}

/** After Runtime replaces the AgentSession: resubscribe + rebind desktop extensions. */
export async function rebindAfterRuntimeReplace(session: AgentSession): Promise<void> {
  detachSessionSubscription()
  st.session = session
  st.currentSessionId = session.sessionId
  if (st.nextConversationConfig !== undefined) {
    st.activeConversationConfig = st.nextConversationConfig
    st.nextConversationConfig = undefined
  }
  try {
    const cwd = session.sessionManager?.getCwd?.()
    if (typeof cwd === 'string' && cwd.length > 0) st.currentCwd = cwd
  } catch {
    /* ignore */
  }
  await bindDesktopExtensions(session)
  st.unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    handleSessionEvent(event)
  })
  emitSessionModelState()
}

/** Push current session model to renderer; optionally include SDK model restore fallback. */
export function emitSessionModelState(opts?: { modelFallbackMessage?: string | null }): void {
  if (!st.session) return
  const modelStr = currentSessionModelKey()
  const fallback = String(opts?.modelFallbackMessage || '').trim()
  emit({
    ...baseEvent(),
    type: 'run',
    phase: 'state',
    model: modelStr,
    thinkingLevel: st.session.thinkingLevel,
    ...(fallback ? { modelFallbackMessage: fallback } : {}),
  })
}

function noteModelFallbackFromRuntime(): void {
  const fallback = String(st.runtime?.modelFallbackMessage || '').trim()
  if (!fallback) return
  console.warn('[Worker] Model fallback:', fallback)
  emitSessionModelState({ modelFallbackMessage: fallback })
}

function buildRuntimeFactory(): CreateAgentSessionRuntimeFactory {
  const sdk = st.sdk!
  return async ({ cwd, agentDir, sessionManager, sessionStartEvent }) => {
    const conversationConfig =
      st.nextConversationConfig !== undefined
        ? st.nextConversationConfig
        : st.activeConversationConfig
    const services = await sdk.createAgentSessionServices({
      cwd,
      agentDir,
      resourceLoaderOptions: {
        eventBus: st.sharedEventBus!,
        ...buildAgentPromptLoaderOverrides(conversationConfig),
      },
    })
    installProviderRouting(services.modelRuntime, () => st.providerRouting)
    const created = await sdk.createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
      ...buildAgentToolsOverride(conversationConfig),
      customTools: createOrchestrationTools(),
    })
    return {
      ...created,
      services,
      diagnostics: services.diagnostics ?? [],
    }
  }
}

function wireRuntimeCallbacks(runtime: AgentSessionRuntime): void {
  runtime.setBeforeSessionInvalidate(() => {
    detachSessionSubscription()
    st.agentTurnActive = false
  })
  runtime.setRebindSession(async (session) => {
    await rebindAfterRuntimeReplace(session)
  })
}

async function disposeRuntimeOrSession(): Promise<void> {
  detachSessionSubscription()
  st.agentTurnActive = false
  if (st.runtime) {
    try {
      st.runtime.setRebindSession(undefined)
      st.runtime.setBeforeSessionInvalidate(undefined)
      await st.runtime.dispose()
    } catch (e) {
      console.warn('[Worker] runtime.dispose failed:', errorMessage(e))
      try {
        st.session?.dispose()
      } catch {
        /* ignore */
      }
    }
    st.runtime = null
    st.session = null
    return
  }
  if (st.session) {
    try {
      st.session.dispose()
    } catch {
      /* ignore */
    }
    st.session = null
  }
}

/** Recreate Pi services so AuthStorage reloads auth.json after GUI login/logout. */
export async function reloadAuthenticationRuntime(): Promise<void> {
  if (isSessionBusy()) throw new Error(AUTH_RELOAD_DEFERRED_ACTIVE_TURN)
  if (st.runtimeReloading) throw new Error(AUTH_RELOAD_ALREADY_RUNNING)
  st.runtimeReloading = true
  const cwd = st.currentCwd || process.cwd()
  const sessionFile = st.session?.sessionFile
  const leafId = st.session?.sessionManager.getLeafId?.() ?? undefined
  const hadPrompt = st.promptSent
  try {
    try {
      await disposeRuntimeOrSession()
      if (sessionFile) await switchOrLoadSession(sessionFile, leafId)
      else await initSession(cwd)
      st.promptSent = hadPrompt
    } catch (error) {
      throw new Error(`${AUTH_RELOAD_RUNTIME_INVALID}: ${errorMessage(error)}`)
    }
  } finally {
    st.runtimeReloading = false
  }
}

export async function initSession(cwd: string): Promise<void> {
  st.promptSent = false
  await disposeRuntimeOrSession()

  st.currentCwd = cwd
  const sdk = st.sdk!
  const agentDir = sdk.getAgentDir()
  const createRuntime = buildRuntimeFactory()
  const runtime = await sdk.createAgentSessionRuntime(createRuntime, {
    cwd,
    agentDir,
    sessionManager: sdk.SessionManager.create(cwd),
  })
  st.runtime = runtime
  wireRuntimeCallbacks(runtime)
  await rebindAfterRuntimeReplace(runtime.session)
  noteModelFallbackFromRuntime()
}

/**
 * Switch live runtime to an existing session file (or apply leaf tip if already bound).
 */
export async function switchOrLoadSession(
  sessionFile: string,
  leafOverride?: string | null,
  conversationConfigSnapshot?: ConversationRuntimeSnapshot | null,
): Promise<void> {
  const sdk = st.sdk!
  if (conversationConfigSnapshot !== undefined) {
    st.nextConversationConfig = conversationConfigSnapshot
  }
  let rebound = false
  try {
    if (!st.runtime) {
      // Cold path: build runtime opened on this file
      await disposeRuntimeOrSession()
      const agentDir = sdk.getAgentDir()
      const sm = sdk.SessionManager.open(sessionFile, undefined, st.currentCwd || undefined)
      if (leafOverride === null) sm.resetLeaf?.()
      else if (typeof leafOverride === 'string' && leafOverride.length > 0) {
        try {
          sm.branch(leafOverride)
        } catch (e) {
          console.warn('[Worker] loadSession branch override failed:', e)
        }
      }
      const createRuntime = buildRuntimeFactory()
      const runtime = await sdk.createAgentSessionRuntime(createRuntime, {
        cwd: st.currentCwd || sm.getCwd?.() || process.cwd(),
        agentDir,
        sessionManager: sm,
      })
      st.runtime = runtime
      wireRuntimeCallbacks(runtime)
      await rebindAfterRuntimeReplace(runtime.session)
      rebound = true
      noteModelFallbackFromRuntime()
      return
    }

    const result = await st.runtime.switchSession(sessionFile, {
      cwdOverride: st.currentCwd || undefined,
    })
    if (result.cancelled) {
      throw new Error('SESSION_SWITCH_CANCELLED')
    }
    rebound = true
    // rebindSession already ran; apply leaf tip if requested
    if (leafOverride !== undefined && st.session) {
      try {
        const sm = st.session.sessionManager
        if (leafOverride === null) sm.resetLeaf?.()
        else if (leafOverride.length > 0) sm.branch(leafOverride)
        const ctx = sm.buildSessionContext?.()
        if (ctx?.messages && st.session.agent?.state) {
          st.session.agent.state.messages = ctx.messages
        }
      } catch (e) {
        console.warn('[Worker] leaf override after switchSession failed:', e)
      }
    }
    noteModelFallbackFromRuntime()
  } finally {
    if (!rebound && conversationConfigSnapshot !== undefined) {
      st.nextConversationConfig = undefined
    }
  }
}

export async function runtimeNewSession(
  conversationConfigSnapshot: ConversationRuntimeSnapshot | null,
): Promise<{ cancelled: boolean }> {
  st.nextConversationConfig = conversationConfigSnapshot
  let rebound = false
  try {
    if (!st.runtime) {
      await initSession(st.currentCwd || process.cwd())
      rebound = true
      return { cancelled: false }
    }
    const result = await st.runtime.newSession()
    rebound = !result.cancelled
    return { cancelled: result.cancelled }
  } finally {
    if (!rebound) st.nextConversationConfig = undefined
  }
}

/**
 * TUI /fork: position defaults to "before" (user message text → selectedText).
 * TUI /clone: fork(leafId, { position: "at" }) with empty editor.
 */
export async function runtimeFork(
  entryId: string,
  options?: { position?: 'before' | 'at' },
): Promise<{ cancelled: boolean; selectedText?: string }> {
  if (!st.runtime) throw new Error('No runtime')
  return st.runtime.fork(entryId, { position: options?.position ?? 'before' })
}

function buildCommandContextActions(sess: AgentSession) {
  return {
    waitForIdle: () => sess.agent.waitForIdle(),
    // Extension session replacement deferred (PRD: extension parity out of scope).
    newSession: async () => ({ cancelled: true }),
    fork: async () => ({ cancelled: true }),
    navigateTree: async (
      targetId: string,
      options?: {
        summarize?: boolean
        customInstructions?: string
        replaceInstructions?: boolean
        label?: string
      },
    ) => {
      const result = await sess.navigateTree(targetId, {
        summarize: options?.summarize ?? false,
        customInstructions: options?.customInstructions,
        replaceInstructions: options?.replaceInstructions,
        label: options?.label,
      })
      return { cancelled: result.cancelled }
    },
    switchSession: async () => ({ cancelled: true }),
    reload: async () => {
      await sess.reload()
    },
  }
}

function workerTraceOn(): boolean {
  return (
    process.env.PI_AUDIO_TRACE === '1' ||
    process.env.PI_AUDIO_TRACE === 'true' ||
    process.env.PI_ALERT_TRACE === '1'
  )
}

function traceWorkerUi(
  req: import('./desktop-ui-bridge.js').ExtensionUIRequest,
  forwarded: boolean,
): void {
  if (!workerTraceOn()) return
  const detail =
    req.method === 'notify'
      ? { method: 'notify', notifyType: req.notifyType, msg: String(req.message || '').slice(0, 100) }
      : { method: req.method, kind: (req as { kind?: string }).kind }
  console.log('[audio-trace] worker.postExtensionUi', {
    forwarded,
    agentTurnActive: st.agentTurnActive,
    ...detail,
  })
}

function postExtensionUiToDesktop(req: import('./desktop-ui-bridge.js').ExtensionUIRequest): void {
  if (req.method === 'notify') {
    if (!st.agentTurnActive) {
      if (req.notifyType === 'error') {
        traceWorkerUi(req, true)
        process.parentPort?.postMessage({ type: 'extension-ui-request', request: req })
      } else {
        traceWorkerUi(req, false)
      }
      return
    }
  }
  traceWorkerUi(req, true)
  process.parentPort?.postMessage({ type: 'extension-ui-request', request: req })
}

function postExtensionUiDismiss(id: string, reason: 'timeout' | 'abort'): void {
  process.parentPort?.postMessage({ type: 'extension-ui-dismiss', id, reason })
}

export async function bindDesktopExtensions(sess: AgentSession): Promise<void> {
  if (!st.uiBridge) {
    st.uiBridge = createDesktopUIBridge(
      st.sharedEventBus!,
      postExtensionUiToDesktop,
      postExtensionUiDismiss,
    )
  }
  await sess.bindExtensions({
    uiContext: st.uiBridge.uiContext as never,
    mode: 'rpc',
    commandContextActions: buildCommandContextActions(sess),
  })
}

function sessionEventDeps() {
  return {
    baseEvent,
    emit,
    getSession: () => st.session,
    getSessionModelKey: currentSessionModelKey,
    getUiBridge: () => st.uiBridge,
    isAgentTurnActive: () => st.agentTurnActive,
    setAgentTurnActive: (v: boolean) => {
      st.agentTurnActive = v
    },
    setCurrentRunId: (id: string) => {
      st.currentRunId = id
    },
    setCurrentTurnId: (id: string) => {
      st.currentTurnId = id
    },
    nextSeq,
  }
}

export function handleSessionEvent(event: AgentSessionEvent): void {
  dispatchSessionEvent(event, sessionEventDeps())
}

export async function listSessions(cwd: string): Promise<unknown[]> {
  if (!st.sdk) return []
  try {
    return await st.sdk.SessionManager.list(cwd)
  } catch (e) {
    console.error('[Worker] listSessions failed:', e)
    return []
  }
}
