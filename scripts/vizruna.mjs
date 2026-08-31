#!/usr/bin/env node
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const entry = join(root, 'out', 'main', 'cli.js')

async function run(command, commandArgs) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, { cwd: root, env: process.env, stdio: 'inherit' })
    for (const signal of ['SIGINT', 'SIGTERM']) {
      process.once(signal, () => child.kill(signal))
    }
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      // The once-listener above has already been consumed, so re-emitting the
      // signal now terminates this wrapper with the same user intent instead
      // of leaving the real CLI/Web host orphaned.
      if (signal) process.kill(process.pid, signal)
      else resolveRun(code ?? 1)
    })
  })
}

if (!existsSync(entry)) {
  console.log('Preparing Vizruna Local Runtime for first use…')
  const code = await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['run', 'build:web'])
  if (code !== 0) process.exit(code)
}

process.exit(await run(process.execPath, [entry, ...process.argv.slice(2)]))
