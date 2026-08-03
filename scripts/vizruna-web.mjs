#!/usr/bin/env node

import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import electron from 'electron'

const scriptDirectory = dirname(fileURLToPath(import.meta.url))
const projectRoot = join(scriptDirectory, '..')
const entry = join(projectRoot, 'out', 'main', 'web-server.js')

if (!existsSync(entry)) {
  console.error('Vizruna-web has not been built. Run `npm run build:web` first.')
  process.exit(1)
}

const child = spawn(electron, [entry], {
  cwd: projectRoot,
  env: {
    ...process.env,
    VIZRUNA_WEB_RUNTIME: '1',
  },
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => child.kill(signal))
}

child.once('error', (error) => {
  console.error('Unable to start Vizruna-web:', error)
  process.exitCode = 1
})

child.once('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 1)
})
