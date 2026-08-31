#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'out', 'node-web', 'server.mjs')
if (!existsSync(entry)) {
  console.error('Vizruna Node Web Host is not built. Run `npm run build:web` first.')
  process.exit(1)
}

const child = spawn(process.execPath, [entry], {
  cwd: root,
  env: { ...process.env, VIZRUNA_WEB_RUNTIME: '1' },
  stdio: 'inherit',
})

for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal))
child.once('error', (error) => { console.error('Unable to start Vizruna-web:', error); process.exitCode = 1 })
child.once('exit', (code, signal) => signal ? process.kill(process.pid, signal) : process.exit(code ?? 1))
