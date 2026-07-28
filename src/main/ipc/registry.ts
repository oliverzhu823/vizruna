import { ipcMain, type BrowserWindow } from 'electron'
import type { AppEvent } from '@shared/app-events'
import { z, type ZodSchema } from 'zod'
import { auditRepository } from '../audit/audit-repository'
import { failureFromUnknown } from '../reliability/failure-model'

/** Documented JSON invoke shape from preload (see doc/IPC-CONTRACTS.md). */
export type IpcInvokeBody = Record<string, unknown>

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type IpcHandlerFn = (request: any) => Promise<any>

const handlers = new Map<string, IpcHandlerFn>()

export function registerHandler(channel: string, handler: IpcHandlerFn): void {
  if (handlers.has(channel)) {
    ipcMain.removeHandler(channel)
  }
  handlers.set(channel, handler)
  ipcMain.handle(channel, async (_event, request) => {
    try {
      return await handler(request as IpcInvokeBody)
    } catch (error) {
      const failure = failureFromUnknown(error)
      console.error(`[IPC:${channel}] ${failure.code}:`, failure.message)
      try {
        auditRepository.write({
          category: 'operation',
          action: 'ipc.failure',
          outcome: 'failed',
          details: { channel, failure },
        })
      } catch {
        // Preserve the original classified failure even when the audit store is unavailable.
      }
      throw new Error(`[${failure.code}] ${failure.message}`)
    }
  })
}

/** Register a handler with Zod schema validation on the input. */
export function registerHandlerWithSchema<T>(
  channel: string,
  schema: ZodSchema<T>,
  handler: (request: T) => Promise<unknown>,
): void {
  registerHandler(channel, async (request) => {
    const result = schema.safeParse(request)
    if (!result.success) {
      const err = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ')
      throw new Error(`Invalid IPC input for ${channel}: ${err}`)
    }
    return handler(result.data)
  })
}

export function sendEvent(win: BrowserWindow, event: AppEvent): void {
  if (!win.isDestroyed()) {
    win.webContents.send('ipc:events', event)
  }
}
