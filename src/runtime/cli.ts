#!/usr/bin/env node
import { spawn } from 'node:child_process'
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { RuntimeRpcResponseV1, RuntimeRunRecord } from '@shared/runtime-rpc-v1'
import { VIZRUNA_RUNTIME_API_PREFIX } from '@shared/runtime-rpc-v1'
import { getRuntimeApplicationRoot, getRuntimeStateDirectory, getRuntimeUserDataPath } from './runtime-paths'
import { startRuntimeRpcServer } from './rpc-server'

type ServerState = { pid: number; host: string; port: number; token: string; rpcVersion: string; startedAt: number }

const args = process.argv.slice(2)
const jsonOutput = takeFlag('--json')

function takeFlag(name: string): boolean {
  const index = args.indexOf(name)
  if (index < 0) return false
  args.splice(index, 1)
  return true
}

function takeOption(name: string): string | undefined {
  const index = args.indexOf(name)
  if (index < 0) return undefined
  const value = args[index + 1]
  if (!value || value.startsWith('--')) throw new Error(`Missing value for ${name}`)
  args.splice(index, 2)
  return value
}

function print(value: unknown): void {
  if (jsonOutput || typeof value !== 'string') console.log(JSON.stringify(value, null, 2))
  else console.log(value)
}

function fail(message: string, code = 1): never {
  console.error(jsonOutput ? JSON.stringify({ ok: false, error: message }) : `Vizruna: ${message}`)
  process.exit(code)
}

function readState(): ServerState | null {
  try {
    return JSON.parse(readFileSync(join(getRuntimeStateDirectory(), 'server.json'), 'utf8')) as ServerState
  } catch {
    return null
  }
}

function processAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true } catch { return false }
}

async function rpc(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const state = readState()
  if (!state || !processAlive(state.pid)) throw new Error('Runtime is not running. Use `vizruna runtime start`.')
  const response = await fetch(`http://${state.host}:${state.port}${VIZRUNA_RUNTIME_API_PREFIX}/rpc`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${state.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: crypto.randomUUID(), method, params }),
  })
  const body = await response.json() as RuntimeRpcResponseV1
  if (!body.ok) throw new Error(`${body.error.code}: ${body.error.message}`)
  return body.result
}

async function healthy(state: ServerState | null): Promise<boolean> {
  if (!state || !processAlive(state.pid)) return false
  try {
    const response = await fetch(`http://${state.host}:${state.port}${VIZRUNA_RUNTIME_API_PREFIX}/health`, {
      headers: { Authorization: `Bearer ${state.token}` }, signal: AbortSignal.timeout(1_000),
    })
    return response.ok
  } catch { return false }
}

async function waitForRuntime(timeout = 10_000): Promise<ServerState> {
  const deadline = Date.now() + timeout
  while (Date.now() < deadline) {
    const state = readState()
    if (await healthy(state)) return state!
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  throw new Error('Runtime did not become ready within 10 seconds.')
}

async function startDaemon(): Promise<ServerState> {
  const current = readState()
  if (await healthy(current)) return current!
  mkdirSync(getRuntimeStateDirectory(), { recursive: true })
  const entry = fileURLToPath(new URL('./runtime.js', import.meta.url))
  if (!existsSync(entry)) throw new Error('Runtime build is missing. Run `npm run build:web`.')
  const log = join(getRuntimeStateDirectory(), 'runtime.log')
  const child = spawn(process.execPath, [entry], {
    cwd: getRuntimeApplicationRoot(), detached: true, stdio: ['ignore', 'ignore', 'ignore'],
    env: { ...process.env, VIZRUNA_RUNTIME_LOG: log },
  })
  child.unref()
  return waitForRuntime()
}

async function waitForRun(runId: string): Promise<RuntimeRunRecord> {
  for (;;) {
    const result = await rpc('run.status', { runId }) as { run: RuntimeRunRecord | null }
    if (!result.run) throw new Error('RUN_NOT_FOUND')
    if (['completed', 'failed', 'cancelled'].includes(result.run.status)) return result.run
    await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
}

function help(): string {
  return `Vizruna — local Pi Agent harness\n\n` +
    `  vizruna doctor\n` +
    `  vizruna runtime [start|stop|status]\n` +
    `  vizruna web\n` +
    `  vizruna agent list [--json]\n` +
    `  vizruna run [agent-id] --workspace PATH --prompt TEXT [--permission MODE] [--approve TOOL] [--wait]\n` +
    `  vizruna status RUN_ID\n` +
    `  vizruna stop RUN_ID\n` +
    `  vizruna evidence export RUN_ID [--output FILE] [--include-content]\n` +
    `  vizruna evaluation run SUITE_ID [--permission MODE]\n` +
    `  vizruna evaluation status EVALUATION_ID\n\n` +
    `Permission modes: observe, collaborate (default), autonomous`
}

async function main(): Promise<void> {
  // The package's primary user journey is the Local Web product. This makes
  // `npx vizruna` a real one-command launch while keeping every explicit CLI
  // subcommand available for automation.
  const command = args.shift() || 'web'
  if (command === 'help' || command === '--help' || command === '-h') { print(help()); return }
  if (command === 'doctor') {
    const checks: Array<{ name: string; ok: boolean; detail: string }> = []
    const nodeMajor = Number(process.versions.node.split('.')[0])
    checks.push({ name: 'Node.js', ok: nodeMajor >= 22, detail: process.versions.node })
    const root = getRuntimeApplicationRoot()
    checks.push({ name: 'Application root', ok: existsSync(join(root, 'package.json')), detail: root })
    try {
      mkdirSync(getRuntimeUserDataPath(), { recursive: true }); accessSync(getRuntimeUserDataPath(), constants.W_OK)
      checks.push({ name: 'User data', ok: true, detail: getRuntimeUserDataPath() })
    } catch (error) { checks.push({ name: 'User data', ok: false, detail: String(error) }) }
    checks.push({ name: 'Runtime build', ok: existsSync(fileURLToPath(new URL('./runtime.js', import.meta.url))), detail: fileURLToPath(new URL('./runtime.js', import.meta.url)) })
    checks.push({ name: 'Runtime process', ok: await healthy(readState()), detail: (await healthy(readState())) ? 'running' : 'stopped (normal)' })
    const ok = checks.filter((check) => check.name !== 'Runtime process').every((check) => check.ok)
    print({ ok, checks })
    if (!ok) process.exitCode = 1
    return
  }
  if (command === 'runtime') {
    const action = args.shift() || 'foreground'
    if (action === 'foreground') {
      const port = Number(takeOption('--port') || 0)
      const server = await startRuntimeRpcServer({ port })
      const shutdown = async () => { await server.stop(); process.exit(0) }
      process.once('SIGINT', () => void shutdown()); process.once('SIGTERM', () => void shutdown())
      return
    }
    if (action === 'start') {
      const state = await startDaemon()
      print({ ok: true, pid: state.pid, host: state.host, port: state.port, rpcVersion: state.rpcVersion, startedAt: state.startedAt })
      return
    }
    if (action === 'status') {
      const state = readState()
      print({
        running: await healthy(state),
        state: state ? {
          pid: state.pid, host: state.host, port: state.port,
          rpcVersion: state.rpcVersion, startedAt: state.startedAt,
        } : null,
      })
      return
    }
    if (action === 'stop') {
      const state = readState()
      if (!await healthy(state)) { print({ ok: true, stopped: false, reason: 'not_running' }); return }
      await rpc('runtime.shutdown'); print({ ok: true, stopped: true }); return
    }
    throw new Error(`Unknown runtime action: ${action}`)
  }
  if (command === 'web') {
    const script = join(getRuntimeApplicationRoot(), 'scripts', 'vizruna-node-web.mjs')
    const child = spawn(process.execPath, [script], { cwd: getRuntimeApplicationRoot(), env: process.env, stdio: 'inherit' })
    for (const signal of ['SIGINT', 'SIGTERM'] as const) {
      process.once(signal, () => child.kill(signal))
    }
    child.once('exit', (code, signal) => {
      if (signal) process.kill(process.pid, signal)
      else process.exitCode = code ?? 1
    })
    return
  }
  if (command === 'agent' && args.shift() === 'list') { await startDaemon(); print(await rpc('agent.list')); return }
  if (command === 'run') {
    const workspacePath = resolve(takeOption('--workspace') || process.cwd())
    const prompt = takeOption('--prompt')
    if (!prompt) throw new Error('--prompt is required')
    const permissionMode = takeOption('--permission') || 'collaborate'
    const modelId = takeOption('--model')
    const thinkingLevel = takeOption('--thinking')
    const approvedTools: string[] = []
    while (args.includes('--approve')) approvedTools.push(takeOption('--approve')!)
    const wait = takeFlag('--wait')
    const agentId = args.find((value) => !value.startsWith('--'))
    await startDaemon()
    const result = await rpc('run.start', { workspacePath, prompt, agentId, permissionMode, approvedTools, modelId, thinkingLevel }) as { run: RuntimeRunRecord }
    print(wait ? await waitForRun(result.run.id) : result)
    return
  }
  if (command === 'status') { await startDaemon(); print(await rpc('run.status', { runId: args[0] })); return }
  if (command === 'stop') { await startDaemon(); print(await rpc('run.stop', { runId: args[0] })); return }
  if (command === 'evidence' && args.shift() === 'export') {
    const runId = args.shift()
    if (!runId) throw new Error('run id is required')
    const output = takeOption('--output')
    const includeContent = takeFlag('--include-content')
    await startDaemon()
    const result = await rpc('evidence.export', { runId, includeContent }) as { bundle: unknown }
    if (output) { const path = resolve(output); mkdirSync(dirname(path), { recursive: true }); writeFileSync(path, `${JSON.stringify(result.bundle, null, 2)}\n`, { mode: 0o600 }); print({ ok: true, path }) }
    else print(result)
    return
  }
  if (command === 'evaluation') {
    const action = args.shift()
    await startDaemon()
    if (action === 'run') { print(await rpc('evaluation.run', { suiteId: args.shift(), permissionMode: takeOption('--permission') })); return }
    if (action === 'status') { print(await rpc('evaluation.status', { evaluationId: args.shift() })); return }
  }
  throw new Error(`Unknown command.\n\n${help()}`)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
