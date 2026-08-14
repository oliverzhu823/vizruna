import type { AppEvent } from '@shared/app-events'
import type { AppUpdateAvailableInfo, AppUpdateDownloadProgress } from '@shared/app-update'
import type { ProviderAuthFlowEvent } from '@shared/provider-auth'
import type { TerminalDataEvent, TerminalExitEvent } from '@shared/terminal'
import type { PiPackageMutationProgress } from '@shared/pi-resource-center'
import { installWebRuntimeBridge } from './web-runtime-client'

declare global {
  interface Window {
    piDesktop?: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      invoke: (channel: string, request?: any) => Promise<any>
      getPathForFile: (file: File) => string
      onEvent: (callback: (event: AppEvent) => void) => () => void
      onWorkerExit: (callback: (info: { code: number; cwd: string }) => void) => () => void
      onAutoOpened: (callback: (info: { workspaceId: string }) => void) => () => void
      onExtensionUIRequest: (callback: (request: unknown) => void) => () => void
      onExtensionUIDismiss: (callback: (payload: { type: string; id?: string; reason?: string }) => void) => () => void
      onAppUpdateAvailable: (callback: (info: AppUpdateAvailableInfo) => void) => () => void
      onAppUpdateDownloadProgress?: (callback: (info: AppUpdateDownloadProgress) => void) => () => void
      onGitWorkspaceChanged: (callback: (payload: { cwd: string }) => void) => () => void
      onProviderAuthFlow: (callback: (event: ProviderAuthFlowEvent) => void) => () => void
      onTerminalData: (callback: (event: TerminalDataEvent) => void) => () => void
      onTerminalExit: (callback: (event: TerminalExitEvent) => void) => () => void
      onPiResourceOperationProgress?: (callback: (event: PiPackageMutationProgress) => void) => () => void
      ping: () => string
    }
  }
}

type RuntimeBridge = NonNullable<Window['piDesktop']>
let activeBridge: RuntimeBridge | null = window.piDesktop ?? null

function runtimeBridge(): RuntimeBridge | null {
  activeBridge ??= window.piDesktop ?? null
  return activeBridge
}

class IpcClientImpl {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async invoke<M extends string>(method: M, request?: any): Promise<any> {
    const bridge = runtimeBridge()
    if (!bridge) {
      console.warn(`[IPC] piDesktop not available, stubbing ${method}`)
      return {}
    }
    return bridge.invoke(`ipc:${method}`, request)
  }
}

export const ipcClient = new IpcClientImpl()

export async function initializeRuntimeTransport(): Promise<void> {
  if (runtimeBridge()) return
  activeBridge = await installWebRuntimeBridge()
}

export function isWebRuntime(): boolean {
  return (
    document.documentElement.dataset.vizrunaRuntime === 'web' ||
    runtimeBridge()?.ping() === 'web-pong'
  )
}

export function resolveRuntimeFilePath(file: File): string | undefined {
  try {
    return runtimeBridge()?.getPathForFile(file) || undefined
  } catch {
    return undefined
  }
}

export function onAppEvent(callback: (event: AppEvent) => void): () => void {
  const bridge = runtimeBridge()
  if (!bridge) {
    console.warn('[IPC] piDesktop not available, event subscription disabled')
    return () => {}
  }
  return bridge.onEvent(callback)
}

export function onWorkerExit(callback: (info: { code: number; cwd: string }) => void): () => void {
  const bridge = runtimeBridge()
  if (!bridge) return () => {}
  return bridge.onWorkerExit(callback)
}

export function onAutoOpened(callback: (info: { workspaceId: string }) => void): () => void {
  const bridge = runtimeBridge()
  if (!bridge) return () => {}
  return bridge.onAutoOpened(callback)
}

export function onExtensionUIRequest(callback: (request: unknown) => void): () => void {
  const bridge = runtimeBridge()
  if (!bridge) return () => {}
  return bridge.onExtensionUIRequest(callback)
}

export function onExtensionUIDismiss(
  callback: (payload: { type: string; id?: string; reason?: string }) => void,
): () => void {
  const bridge = runtimeBridge()
  if (!bridge) return () => {}
  return bridge.onExtensionUIDismiss(callback)
}

export function onAppUpdateAvailable(callback: (info: AppUpdateAvailableInfo) => void): () => void {
  const bridge = runtimeBridge()
  if (!bridge) return () => {}
  return bridge.onAppUpdateAvailable(callback)
}

export function onAppUpdateDownloadProgress(
  callback: (info: AppUpdateDownloadProgress) => void,
): () => void {
  const bridge = runtimeBridge()
  if (!bridge?.onAppUpdateDownloadProgress) return () => {}
  return bridge.onAppUpdateDownloadProgress(callback)
}

export function onGitWorkspaceChanged(callback: (payload: { cwd: string }) => void): () => void {
  const bridge = runtimeBridge()
  if (!bridge) return () => {}
  return bridge.onGitWorkspaceChanged(callback)
}

export function onProviderAuthFlow(
  callback: (event: ProviderAuthFlowEvent) => void,
): () => void {
  const bridge = runtimeBridge()
  if (!bridge) return () => {}
  return bridge.onProviderAuthFlow(callback)
}

export function onTerminalData(callback: (event: TerminalDataEvent) => void): () => void {
  const bridge = runtimeBridge()
  if (!bridge) return () => {}
  return bridge.onTerminalData(callback)
}

export function onTerminalExit(callback: (event: TerminalExitEvent) => void): () => void {
  const bridge = runtimeBridge()
  if (!bridge) return () => {}
  return bridge.onTerminalExit(callback)
}

export function onPiResourceOperationProgress(
  callback: (event: PiPackageMutationProgress) => void,
): () => void {
  const bridge = runtimeBridge()
  if (!bridge?.onPiResourceOperationProgress) return () => {}
  return bridge.onPiResourceOperationProgress(callback)
}
