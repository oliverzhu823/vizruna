import type { AppEvent } from '@shared/app-events'
import type { ProviderAuthFlowEvent } from '@shared/provider-auth'
import type { TerminalDataEvent, TerminalExitEvent } from '@shared/terminal'
import type { PiPackageMutationProgress } from '@shared/pi-resource-center'

export type RuntimeEventMap = {
  'ipc:events': AppEvent
  'ipc:worker-exit': { code: number; cwd: string; sessionFile?: string | null; poolKey?: string }
  'ipc:auto-opened': { workspaceId: string }
  'ipc:extension-ui-request': unknown
  'ipc:extension-ui-dismiss': { type: string; id?: string; reason?: string }
  'ipc:git-workspace-changed': { cwd: string }
  'ipc:provider-auth-flow': ProviderAuthFlowEvent
  'ipc:terminal-data': TerminalDataEvent
  'ipc:terminal-exit': TerminalExitEvent
  'ipc:pi-resource-operation-progress': PiPackageMutationProgress
}

export type RuntimeEventChannel = keyof RuntimeEventMap

export type RuntimeEventEnvelope<C extends RuntimeEventChannel = RuntimeEventChannel> = {
  channel: C
  payload: RuntimeEventMap[C]
}

type Listener = (event: RuntimeEventEnvelope) => void

const listeners = new Set<Listener>()

export function emitRuntimeEvent<C extends RuntimeEventChannel>(
  channel: C,
  payload: RuntimeEventMap[C],
): void {
  const event = { channel, payload } as RuntimeEventEnvelope
  for (const listener of listeners) {
    try {
      listener(event)
    } catch (error) {
      console.warn('[runtime-events] listener failed:', error)
    }
  }
}

export function subscribeRuntimeEvents(listener: Listener): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}
