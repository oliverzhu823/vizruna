import { spawn } from 'node:child_process'
import { mkdtemp, rm, stat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const electron = require('electron')
const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const mainEntry = join(root, 'out', 'main', 'index.js')
const requestedHours = Number(
  process.argv.find((argument) => argument.startsWith('--hours='))?.split('=')[1] ?? 8,
)
const requestedMinutes = Number(
  process.argv.find((argument) => argument.startsWith('--minutes='))?.split('=')[1] ?? NaN,
)
const durationMs = Number.isFinite(requestedMinutes)
  ? Math.max(0.1, requestedMinutes) * 60 * 1_000
  : Math.max(0.01, requestedHours) * 60 * 60 * 1_000
const userData = await mkdtemp(join(tmpdir(), 'pi-enterprise-m4-soak-'))

await stat(mainEntry).catch(() => {
  throw new Error('Build output missing. Run npm run build before the soak test.')
})

const child = spawn(electron, [mainEntry], {
  cwd: root,
  stdio: ['ignore', 'pipe', 'pipe'],
  env: {
    ...process.env,
    PI_E2E: '1',
    PI_E2E_USER_DATA: userData,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
})

let unexpectedExit = null
let stderr = ''
child.stderr.on('data', (chunk) => {
  stderr = `${stderr}${String(chunk)}`.slice(-20_000)
})
child.on('exit', (code, signal) => {
  unexpectedExit = { code, signal, at: Date.now() }
})

const startedAt = Date.now()
const heartbeat = setInterval(() => {
  const elapsedMinutes = ((Date.now() - startedAt) / 60_000).toFixed(1)
  process.stdout.write(
    `${JSON.stringify({ type: 'heartbeat', elapsedMinutes, pid: child.pid })}\n`,
  )
}, 60_000)
heartbeat.unref()

try {
  while (Date.now() - startedAt < durationMs) {
    if (unexpectedExit) {
      throw new Error(
        `Electron exited before the soak deadline: ${JSON.stringify(unexpectedExit)}\n${stderr}`,
      )
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 5_000))
  }
  process.stdout.write(
    `${JSON.stringify({
      type: 'complete',
      elapsedHours: (Date.now() - startedAt) / 3_600_000,
      unexpectedExit: false,
    })}\n`,
  )
} finally {
  clearInterval(heartbeat)
  if (!unexpectedExit) child.kill('SIGTERM')
  await new Promise((resolvePromise) => setTimeout(resolvePromise, 1_000))
  if (!unexpectedExit) child.kill('SIGKILL')
  await rm(userData, { recursive: true, force: true })
}
