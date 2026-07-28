import { BrowserWindow } from 'electron'
import type { OrchestrationEvent } from '@shared/orchestration'
import { auditRepository } from '../audit/audit-repository'
import { workerManager } from '../worker-manager'
import { getManagedWorktreeService } from '../worktree/managed-worktree-instance'
import { SqliteOrchestrationRepository } from './orchestration-repository'
import { OrchestrationService } from './orchestration-service'

let instance: OrchestrationService | null = null
let unsubscribeRuntime: (() => void) | null = null

function publish(event: OrchestrationEvent): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) window.webContents.send('ipc:events', event)
  }
}

export function getOrchestrationService(): OrchestrationService {
  if (instance) return instance
  instance = new OrchestrationService({
    repository: new SqliteOrchestrationRepository(),
    runtime: {
      createSession: (cwd) => workerManager.createBackgroundSession(cwd),
      ensureSession: (sessionFile, cwd) =>
        workerManager.ensureBackgroundSession(sessionFile, cwd),
      getState: (sessionFile) => workerManager.getState(sessionFile),
      configure: (sessionFile, options) =>
        workerManager.configureBackgroundSession(sessionFile, options),
      prompt: (sessionFile, text) =>
        workerManager.promptBackgroundSession(sessionFile, text),
      message: (sessionFile, text) =>
        workerManager.messageBackgroundSession(sessionFile, text),
      abort: (sessionFile) =>
        workerManager.abortBackgroundSession(sessionFile),
      stop: (sessionFile) =>
        workerManager.stopBackgroundSession(sessionFile),
    },
    worktrees: getManagedWorktreeService(),
    audit: (event) => {
      auditRepository.write(event)
    },
    publish,
  })
  workerManager.setOrchestrationRequestHandler((payload) =>
    instance!.handleWorkerRequest(payload),
  )
  unsubscribeRuntime?.()
  unsubscribeRuntime = workerManager.subscribeRuntime((notification) => {
    instance?.handleRuntimeNotification(notification)
  })
  return instance
}
