import { randomUUID } from 'node:crypto'
import type {
  OrchestrationWorkerRequest,
  OrchestrationWorkerResponse,
} from '@shared/orchestration'

type PendingRequest = {
  resolve: (response: OrchestrationWorkerResponse) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}

const pending = new Map<string, PendingRequest>()

export function acceptOrchestrationResponse(message: Record<string, unknown>): boolean {
  if (message.type !== 'orchestration-response') return false
  const rpcId = typeof message.rpcId === 'string' ? message.rpcId : ''
  const request = pending.get(rpcId)
  if (!request) return true
  pending.delete(rpcId)
  clearTimeout(request.timer)
  request.resolve(message.response as OrchestrationWorkerResponse)
  return true
}

export function requestOrchestration(
  request: OrchestrationWorkerRequest,
  signal?: AbortSignal,
): Promise<unknown> {
  const rpcId = randomUUID()
  return new Promise((resolve, reject) => {
    const cleanup = () => {
      const item = pending.get(rpcId)
      if (item) clearTimeout(item.timer)
      pending.delete(rpcId)
      signal?.removeEventListener('abort', onAbort)
    }
    const onAbort = () => {
      cleanup()
      reject(new Error('Orchestration request aborted'))
    }
    const timer = setTimeout(() => {
      cleanup()
      reject(new Error('Orchestration request timed out'))
    }, 125_000)
    pending.set(rpcId, {
      timer,
      reject,
      resolve: (response) => {
        cleanup()
        if (!response.ok) {
          reject(new Error(`${response.code}: ${response.error}`))
          return
        }
        resolve(response.result)
      },
    })
    signal?.addEventListener('abort', onAbort, { once: true })
    try {
      const payload = {
        type: 'orchestration-request',
        rpcId,
        request,
      }
      if (process.parentPort) process.parentPort.postMessage(payload)
      else process.send?.(payload)
    } catch (error) {
      cleanup()
      reject(error)
    }
  })
}

export function rejectPendingOrchestrationRequests(reason = 'Worker disposed'): void {
  for (const [rpcId, request] of pending) {
    pending.delete(rpcId)
    clearTimeout(request.timer)
    request.reject(new Error(reason))
  }
}
