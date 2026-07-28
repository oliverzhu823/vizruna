// Pi Worker - runs pi SDK in a utilityProcess via MessagePort
process.env.ELECTRON_RUN_AS_NODE = '1'

import { errorMessage } from '@shared/error-message'
import type { WorkerIncomingMessage } from './worker-port-types.js'
import { handleWorkerPortMessage } from './worker-port-handlers.js'
import './worker-runtime.js'
import {
  acceptOrchestrationResponse,
  rejectPendingOrchestrationRequests,
} from './orchestration-rpc.js'

let rpcChain: Promise<void> = Promise.resolve()

process.on('uncaughtException', (err) => {
  const msg = err?.message || String(err)
  if (msg.includes('stale') && (msg.includes('extension ctx') || msg.includes('ExtensionRunner'))) {
    console.warn('[Worker] swallowed stale extension ctx error:', msg)
    return
  }
  console.error('[Worker] uncaughtException:', err)
})
process.on('unhandledRejection', (reason) => {
  const msg = errorMessage(reason)
  if (msg.includes('stale') && msg.includes('extension ctx')) return
  console.error('[Worker] unhandledRejection:', reason)
})

// In utilityProcess, parentPort messages come as MessageEvent with data property
process.parentPort?.on('message', async (event: { data?: WorkerIncomingMessage } | WorkerIncomingMessage) => {
  const msg = (typeof event === 'object' && event !== null && 'data' in event
    ? (event as { data?: WorkerIncomingMessage }).data
    : event) as WorkerIncomingMessage
  // Avoid per-RPC production logging; retain errors via uncaught handlers below.
  if (process.env.NODE_ENV !== 'production' || process.env.PI_WORKER_TRACE === '1') {
    console.log('[Worker] Received:', msg?.type)
  }
  if (acceptOrchestrationResponse(msg)) return
  const reply = (payload: Record<string, unknown>) => {
    process.parentPort?.postMessage({ requestId: msg?.requestId, ...payload })
  }

  // Extension UI responses may resolve a prompt awaited by a queued extension
  // command. All other RPC handlers are serialized so authentication reload
  // cannot dispose a runtime concurrently with session/model mutations.
  if (msg?.type === 'extension-ui-response') {
    await handleWorkerPortMessage(msg, reply)
    return
  }
  const run = rpcChain.then(
    () => handleWorkerPortMessage(msg, reply),
    () => handleWorkerPortMessage(msg, reply),
  )
  rpcChain = run.then(
    () => undefined,
    () => undefined,
  )
  await run
})

process.on('exit', () => {
  rejectPendingOrchestrationRequests()
})

if (process.env.NODE_ENV !== 'production' || process.env.PI_WORKER_TRACE === '1') {
  console.log('[Worker] Ready')
}
