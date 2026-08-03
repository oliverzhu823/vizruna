#!/usr/bin/env node

import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawn } from 'node:child_process'
import electron from 'electron'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'out', 'main', 'web-server.js')
const userData = mkdtempSync(join(tmpdir(), 'vizruna-web-e2e-'))
const child = spawn(electron, [entry], {
  cwd: root,
  env: {
    ...process.env,
    VIZRUNA_WEB_RUNTIME: '1',
    VIZRUNA_WEB_TEST: '1',
    VIZRUNA_WEB_STARTUP_TOKEN: 'vizruna-web-e2e-token',
    VIZRUNA_WEB_PORT: '57400',
    VIZRUNA_WEB_NO_OPEN: '1',
    PI_E2E: '1',
    PI_E2E_USER_DATA: userData,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
  stdio: 'inherit',
})

let cleaned = false
function cleanup() {
  if (cleaned) return
  cleaned = true
  rmSync(userData, { recursive: true, force: true })
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal))
}

child.once('error', (error) => {
  console.error('[Vizruna-web E2E] server failed:', error)
  cleanup()
  process.exit(1)
})

child.once('exit', (code, signal) => {
  cleanup()
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
