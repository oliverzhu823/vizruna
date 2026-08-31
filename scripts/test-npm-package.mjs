#!/usr/bin/env node
import { execFileSync, spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = process.cwd()
const packageRoot = join(root, 'dist', 'npm')
const work = mkdtempSync(join(tmpdir(), 'vizruna-npx-'))

async function waitForExit(child, label, options = {}) {
  await new Promise((resolveChild, reject) => {
    child.once('error', reject)
    child.once('exit', (code, signal) => {
      if (code === 0 || (options.allowSignal && signal)) resolveChild()
      else reject(new Error(`${label} exited ${code ?? signal}`))
    })
  })
}

async function waitForWebOrigin(child, timeout = 15_000) {
  let output = ''
  const deadline = Date.now() + timeout
  child.stdout.on('data', (chunk) => { output += chunk.toString() })
  while (Date.now() < deadline) {
    const match = output.match(/Running securely on (127\.0\.0\.1:\d+)/)
    if (match) return `http://${match[1]}`
    if (child.exitCode != null) throw new Error(`packaged web exited before ready (${child.exitCode})\n${output}`)
    await new Promise((resolveWait) => setTimeout(resolveWait, 50))
  }
  throw new Error(`packaged web did not become ready\n${output}`)
}

try {
  execFileSync('npm', ['pack', '--silent', packageRoot, '--pack-destination', work], { cwd: root, stdio: 'inherit' })
  const tarball = join(work, readdirSync(work).find((file) => file.endsWith('.tgz')))
  execFileSync('npm', ['init', '-y'], { cwd: work, stdio: 'ignore' })
  execFileSync('npm', ['install', '--no-audit', '--no-fund', tarball], { cwd: work, stdio: 'inherit' })
  const userData = join(work, 'user-data')
  const cli = join(work, 'node_modules', '.bin', process.platform === 'win32' ? 'vizruna.cmd' : 'vizruna')
  const doctor = execFileSync(cli, ['doctor', '--json'], {
    cwd: work, env: { ...process.env, VIZRUNA_USER_DATA_PATH: userData }, encoding: 'utf8',
  })
  const result = JSON.parse(doctor)
  if (result.ok !== true) throw new Error(`packaged doctor failed: ${doctor}`)
  const child = spawn(cli, ['runtime', 'start', '--json'], {
    cwd: work, env: { ...process.env, VIZRUNA_USER_DATA_PATH: userData }, stdio: ['ignore', 'pipe', 'inherit'],
  })
  let stdout = ''
  child.stdout.on('data', (chunk) => { stdout += chunk })
  await waitForExit(child, 'runtime start')
  const start = JSON.parse(stdout)
  if (!start.port || Object.hasOwn(start, 'token')) throw new Error('runtime start contract failed')
  execFileSync(cli, ['runtime', 'stop', '--json'], {
    cwd: work, env: { ...process.env, VIZRUNA_USER_DATA_PATH: userData }, stdio: 'inherit',
  })

  const startupToken = 'vizruna-clean-install-test-token'
  const web = spawn(cli, [], {
    cwd: work,
    env: {
      ...process.env,
      VIZRUNA_USER_DATA_PATH: userData,
      VIZRUNA_WEB_TEST: '1',
      VIZRUNA_WEB_STARTUP_TOKEN: startupToken,
      VIZRUNA_WEB_NO_OPEN: '1',
      VIZRUNA_WEB_PORT: '0',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  })
  try {
    const origin = await waitForWebOrigin(web)
    const unauthenticated = await fetch(`${origin}/api/health`)
    if (unauthenticated.status !== 401) throw new Error(`web auth boundary returned ${unauthenticated.status}`)
    const auth = await fetch(`${origin}/api/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token: startupToken }),
    })
    if (!auth.ok) throw new Error(`web token exchange returned ${auth.status}`)
    const cookie = auth.headers.get('set-cookie')?.split(';', 1)[0]
    if (!cookie) throw new Error('web token exchange did not set an HttpOnly session')
    const health = await fetch(`${origin}/api/health`, { headers: { Cookie: cookie } })
    const healthBody = await health.json()
    if (!health.ok || healthBody.product !== 'Vizruna-web') throw new Error(`packaged web health failed: ${JSON.stringify(healthBody)}`)
    const page = await fetch(origin)
    if (!page.ok || !(await page.text()).includes('Vizruna')) throw new Error('packaged renderer was not served')
  } finally {
    web.kill('SIGTERM')
    await waitForExit(web, 'web shutdown', { allowSignal: true })
  }
  const installed = JSON.parse(readFileSync(join(work, 'node_modules', 'vizruna', 'package.json'), 'utf8'))
  console.log(`[npm-package] clean install passed for ${installed.name}@${installed.version}`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
