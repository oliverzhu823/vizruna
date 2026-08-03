import type { AppEvent } from '@shared/app-events'
import type { AppUpdateAvailableInfo, AppUpdateDownloadProgress } from '@shared/app-update'
import type { ProviderAuthFlowEvent } from '@shared/provider-auth'
import type { TerminalDataEvent, TerminalExitEvent } from '@shared/terminal'

type EventPayloads = {
  'ipc:events': AppEvent
  'ipc:worker-exit': { code: number; cwd: string }
  'ipc:auto-opened': { workspaceId: string }
  'ipc:extension-ui-request': unknown
  'ipc:extension-ui-dismiss': { type: string; id?: string; reason?: string }
  'ipc:app-update-available': AppUpdateAvailableInfo
  'ipc:app-update-download-progress': AppUpdateDownloadProgress
  'ipc:git-workspace-changed': { cwd: string }
  'ipc:provider-auth-flow': ProviderAuthFlowEvent
  'ipc:terminal-data': TerminalDataEvent
  'ipc:terminal-exit': TerminalExitEvent
}

type EventChannel = keyof EventPayloads
type Listener<C extends EventChannel = EventChannel> = (payload: EventPayloads[C]) => void

export type WebRuntimeBridge = {
  invoke: (channel: string, request?: unknown) => Promise<unknown>
  getPathForFile: (_file: File) => string
  onEvent: (callback: Listener<'ipc:events'>) => () => void
  onWorkerExit: (callback: Listener<'ipc:worker-exit'>) => () => void
  onAutoOpened: (callback: Listener<'ipc:auto-opened'>) => () => void
  onExtensionUIRequest: (callback: Listener<'ipc:extension-ui-request'>) => () => void
  onExtensionUIDismiss: (callback: Listener<'ipc:extension-ui-dismiss'>) => () => void
  onAppUpdateAvailable: (callback: Listener<'ipc:app-update-available'>) => () => void
  onAppUpdateDownloadProgress: (callback: Listener<'ipc:app-update-download-progress'>) => () => void
  onGitWorkspaceChanged: (callback: Listener<'ipc:git-workspace-changed'>) => () => void
  onProviderAuthFlow: (callback: Listener<'ipc:provider-auth-flow'>) => () => void
  onTerminalData: (callback: Listener<'ipc:terminal-data'>) => () => void
  onTerminalExit: (callback: Listener<'ipc:terminal-exit'>) => () => void
  ping: () => string
}

type RuntimeEnvelope = { channel?: unknown; payload?: unknown }

class WebRuntimeClient {
  private readonly listeners = new Map<EventChannel, Set<Listener>>()
  private eventSource: EventSource | null = null
  private initialized: Promise<void> | null = null

  initialize(): Promise<void> {
    this.initialized ??= this.initializeOnce()
    return this.initialized
  }

  private async initializeOnce(): Promise<void> {
    document.title = 'Vizruna-web'
    document.documentElement.dataset.vizrunaRuntime = 'web'
    const params = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const token = params.get('token')
    if (token) {
      const response = await fetch('/api/auth', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      })
      if (!response.ok) throw new Error('Invalid Vizruna-web launch token. Restart Vizruna-web.')
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}`)
    }
    const health = await fetch('/api/health', { credentials: 'same-origin', cache: 'no-store' })
    if (!health.ok) throw new Error('Vizruna-web is not authorized. Restart Vizruna-web.')
    this.connectEvents()
  }

  private connectEvents(): void {
    this.eventSource?.close()
    const source = new EventSource('/api/events', { withCredentials: true })
    source.addEventListener('runtime', (raw) => {
      try {
        const event = JSON.parse((raw as MessageEvent<string>).data) as RuntimeEnvelope
        if (typeof event.channel !== 'string') return
        const channel = event.channel as EventChannel
        for (const listener of this.listeners.get(channel) || []) listener(event.payload as never)
      } catch (error) {
        console.warn('[Vizruna-web] Ignored invalid runtime event:', error)
      }
    })
    this.eventSource = source
  }

  async invoke(channel: string, request?: unknown): Promise<unknown> {
    await this.initialize()
    const response = await fetch('/api/rpc', {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      headers: {
        'Content-Type': 'application/json',
        'X-Vizruna-Requested-With': 'Vizruna-web',
      },
      body: JSON.stringify({ channel, request }),
    })
    const body = await response.json().catch(() => ({})) as {
      result?: unknown
      message?: string
      error?: string
    }
    if (!response.ok) throw new Error(body.message || body.error || `RPC failed: ${response.status}`)
    return body.result
  }

  subscribe<C extends EventChannel>(channel: C, callback: Listener<C>): () => void {
    let channelListeners = this.listeners.get(channel)
    if (!channelListeners) {
      channelListeners = new Set()
      this.listeners.set(channel, channelListeners)
    }
    channelListeners.add(callback as Listener)
    return () => channelListeners?.delete(callback as Listener)
  }

  bridge(): WebRuntimeBridge {
    return {
      invoke: (channel, request) => this.invoke(channel, request),
      getPathForFile: () => {
        throw new Error('Browser File objects do not expose local paths')
      },
      onEvent: (callback) => this.subscribe('ipc:events', callback),
      onWorkerExit: (callback) => this.subscribe('ipc:worker-exit', callback),
      onAutoOpened: (callback) => this.subscribe('ipc:auto-opened', callback),
      onExtensionUIRequest: (callback) => this.subscribe('ipc:extension-ui-request', callback),
      onExtensionUIDismiss: (callback) => this.subscribe('ipc:extension-ui-dismiss', callback),
      onAppUpdateAvailable: (callback) => this.subscribe('ipc:app-update-available', callback),
      onAppUpdateDownloadProgress: (callback) => this.subscribe('ipc:app-update-download-progress', callback),
      onGitWorkspaceChanged: (callback) => this.subscribe('ipc:git-workspace-changed', callback),
      onProviderAuthFlow: (callback) => this.subscribe('ipc:provider-auth-flow', callback),
      onTerminalData: (callback) => this.subscribe('ipc:terminal-data', callback),
      onTerminalExit: (callback) => this.subscribe('ipc:terminal-exit', callback),
      ping: () => 'web-pong',
    }
  }
}

let webRuntime: WebRuntimeClient | null = null

export async function installWebRuntimeBridge(): Promise<WebRuntimeBridge> {
  webRuntime ??= new WebRuntimeClient()
  const bridge = webRuntime.bridge()
  window.piDesktop = bridge
  await webRuntime.initialize()
  return bridge
}
