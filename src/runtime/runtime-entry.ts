#!/usr/bin/env node
import { startRuntimeRpcServer } from './rpc-server'

const server = await startRuntimeRpcServer()
let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true
  await server.stop()
  process.exit(0)
}
process.once('SIGINT', () => void shutdown())
process.once('SIGTERM', () => void shutdown())
