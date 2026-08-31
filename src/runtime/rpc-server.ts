import { randomBytes } from 'node:crypto'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { z } from 'zod'
import type {
  RuntimePermissionMode,
  RuntimeRpcRequestV1,
  RuntimeRpcResponseV1,
  RuntimeRunStartRequest,
} from '@shared/runtime-rpc-v1'
import { VIZRUNA_RUNTIME_API_PREFIX, VIZRUNA_RUNTIME_RPC_VERSION } from '@shared/runtime-rpc-v1'
import { constantTimeEqual, isExpectedLoopbackHost, isSameOriginRequest, readCookie } from '../web/security'
import { VizrunaHeadlessRuntime } from './headless-runtime'
import { resolveRuntimePermission } from './permission-policy'

const LOOPBACK_HOST = '127.0.0.1'
const AUTH_COOKIE = 'vizruna_runtime_v1'
const MAX_BODY_BYTES = 16 * 1024 * 1024

const runStartSchema = z.object({
  workspacePath: z.string().min(1),
  prompt: z.string().min(1).max(2_000_000),
  agentId: z.string().min(1).optional(),
  agentVersionId: z.string().min(1).optional(),
  modelId: z.string().min(3).optional(),
  thinkingLevel: z.string().min(1).optional(),
  permissionMode: z.enum(['observe', 'collaborate', 'autonomous']).optional(),
  approvedTools: z.array(z.string().min(1)).max(100).optional(),
})

const rpcSchema = z.object({
  id: z.string().min(1).max(100),
  method: z.string().min(1).max(100),
  params: z.unknown().optional(),
})

function json(res: ServerResponse, status: number, body: unknown): void {
  const data = Buffer.from(JSON.stringify(body))
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': String(data.length),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  })
  res.end(data)
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += value.length
    if (bytes > MAX_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(value)
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {}
}

function errorCode(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  const code = message.split(':', 1)[0]
  return /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : 'RUNTIME_ERROR'
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch { return false }
}

export interface RuntimeRpcServerOptions {
  port?: number
  token?: string
  runtime?: VizrunaHeadlessRuntime
}

export class RuntimeRpcServer {
  readonly runtime: VizrunaHeadlessRuntime
  readonly token: string
  private server: Server | null = null
  private heartbeat: ReturnType<typeof setInterval> | null = null
  private readonly clients = new Set<ServerResponse>()

  constructor(private readonly options: RuntimeRpcServerOptions = {}) {
    this.runtime = options.runtime || new VizrunaHeadlessRuntime()
    this.token = options.token?.trim() || randomBytes(32).toString('base64url')
  }

  private authenticated(req: IncomingMessage): boolean {
    const authorization = String(req.headers.authorization || '')
    if (authorization.startsWith('Bearer ')) {
      return constantTimeEqual(authorization.slice(7), this.token)
    }
    const cookie = readCookie(req.headers.cookie, AUTH_COOKIE)
    return cookie != null && constantTimeEqual(cookie, this.token)
  }

  private async dispatch(request: RuntimeRpcRequestV1): Promise<unknown> {
    const params = (request.params || {}) as Record<string, unknown>
    switch (request.method) {
      case 'runtime.info':
        return this.runtime.capabilities()
      case 'agent.list':
        return { agents: this.runtime.listAgents(params.includeArchived === true) }
      case 'run.start':
        return { run: this.runtime.startRun(runStartSchema.parse(params) as RuntimeRunStartRequest) }
      case 'run.list':
        return { runs: this.runtime.listRuns(Number(params.limit || 50)) }
      case 'run.status':
        return { run: this.runtime.getRun(String(params.runId || '')) }
      case 'run.stop':
        return { run: await this.runtime.stopRun(String(params.runId || '')) }
      case 'run.events':
        return { events: this.runtime.store.listEvents({
          runId: typeof params.runId === 'string' ? params.runId : undefined,
          after: Number(params.after || 0), limit: Number(params.limit || 1_000),
        }) }
      case 'permission.explain':
        return { permission: resolveRuntimePermission({
          mode: params.mode as RuntimePermissionMode | undefined,
          requestedTools: Array.isArray(params.requestedTools) ? params.requestedTools.map(String) : undefined,
          approvedTools: Array.isArray(params.approvedTools) ? params.approvedTools.map(String) : undefined,
        }) }
      case 'evidence.export':
        return { bundle: this.runtime.exportEvidence(String(params.runId || ''), params.includeContent === true) }
      case 'evaluation.run':
        return {
          evaluation: this.runtime.startEvaluation(
            String(params.suiteId || ''),
            params.permissionMode as RuntimePermissionMode | undefined,
          ),
        }
      case 'evaluation.status':
        return { evaluation: this.runtime.getEvaluation(String(params.evaluationId || '')) }
      case 'runtime.shutdown':
        setTimeout(() => void this.stop(), 10)
        return { stopping: true }
      default:
        throw new Error('RPC_METHOD_NOT_FOUND')
    }
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const address = this.server?.address()
    const port = typeof address === 'object' && address ? address.port : 0
    const origin = `http://${LOOPBACK_HOST}:${port}`
    const host = String(req.headers.host || '')
    if (!isExpectedLoopbackHost(host, port)) {
      json(res, 403, { error: 'invalid_host' }); return
    }
    if (!isSameOriginRequest({
      expectedOrigin: origin,
      originHeader: req.headers.origin,
      secFetchSite: typeof req.headers['sec-fetch-site'] === 'string' ? req.headers['sec-fetch-site'] : undefined,
    })) {
      json(res, 403, { error: 'invalid_origin' }); return
    }
    const pathname = new URL(req.url || '/', origin).pathname
    if (pathname === `${VIZRUNA_RUNTIME_API_PREFIX}/auth` && req.method === 'POST') {
      try {
        const body = await readBody(req) as { token?: unknown }
        if (typeof body.token !== 'string' || !constantTimeEqual(body.token, this.token)) {
          json(res, 401, { error: 'invalid_token' }); return
        }
        res.setHeader('Set-Cookie', `${AUTH_COOKIE}=${encodeURIComponent(this.token)}; Path=/api/v1; HttpOnly; SameSite=Strict`)
        json(res, 200, { ok: true, rpcVersion: VIZRUNA_RUNTIME_RPC_VERSION })
      } catch (error) {
        json(res, 400, { error: errorCode(error) })
      }
      return
    }
    if (!pathname.startsWith(VIZRUNA_RUNTIME_API_PREFIX)) {
      json(res, 404, { error: 'not_found' }); return
    }
    if (!this.authenticated(req)) {
      json(res, 401, { error: 'authentication_required' }); return
    }
    if (pathname === `${VIZRUNA_RUNTIME_API_PREFIX}/health` && req.method === 'GET') {
      json(res, 200, { ok: true, ...this.runtime.capabilities() }); return
    }
    if (pathname === `${VIZRUNA_RUNTIME_API_PREFIX}/events` && req.method === 'GET') {
      const url = new URL(req.url || '/', origin)
      const after = Number(url.searchParams.get('after') || req.headers['last-event-id'] || 0)
      res.writeHead(200, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-store', Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
      })
      for (const event of this.runtime.store.listEvents({ after, limit: 1_000 })) {
        res.write(`id: ${event.id}\nevent: runtime\ndata: ${JSON.stringify(event)}\n\n`)
      }
      this.clients.add(res)
      req.once('close', () => this.clients.delete(res))
      return
    }
    if (pathname === `${VIZRUNA_RUNTIME_API_PREFIX}/rpc` && req.method === 'POST') {
      const bearer = String(req.headers.authorization || '').startsWith('Bearer ')
      if (!bearer && req.headers['x-vizruna-requested-with'] !== 'Vizruna-runtime-v1') {
        json(res, 403, { error: 'csrf_header_required' }); return
      }
      let body: RuntimeRpcRequestV1 | undefined
      try {
        body = rpcSchema.parse(await readBody(req)) as RuntimeRpcRequestV1
        const result = await this.dispatch(body)
        const response: RuntimeRpcResponseV1 = { id: body.id, ok: true, result }
        json(res, 200, response)
      } catch (error) {
        const response: RuntimeRpcResponseV1 = {
          id: body?.id || 'invalid', ok: false,
          error: { code: errorCode(error), message: error instanceof Error ? error.message : String(error) },
        }
        json(res, response.error.code === 'RPC_METHOD_NOT_FOUND' ? 404 : 400, response)
      }
      return
    }
    json(res, 404, { error: 'not_found' })
  }

  async start(): Promise<{ port: number; token: string; statePath: string }> {
    if (this.server) throw new Error('RUNTIME_ALREADY_STARTED')
    const existing = this.runtime.store.readServerState<{ pid?: unknown }>()
    if (existing && processAlive(Number(existing.pid))) throw new Error('RUNTIME_ALREADY_RUNNING')
    this.runtime.store.clearServerState()
    this.server = createServer((req, res) => {
      void this.handle(req, res).catch((error) => json(res, 500, { error: errorCode(error) }))
    })
    const requestedPort = Number(this.options.port ?? process.env.VIZRUNA_RUNTIME_PORT ?? 0)
    const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535 ? requestedPort : 0
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(port, LOOPBACK_HOST, resolve)
    })
    const address = this.server.address()
    if (!address || typeof address === 'string') throw new Error('RUNTIME_ADDRESS_UNAVAILABLE')
    const unsubscribe = this.runtime.subscribe((event) => {
      const frame = `id: ${event.id}\nevent: runtime\ndata: ${JSON.stringify(event)}\n\n`
      for (const client of [...this.clients]) {
        try { client.write(frame) } catch { this.clients.delete(client) }
      }
    })
    this.server.once('close', unsubscribe)
    this.heartbeat = setInterval(() => {
      for (const client of [...this.clients]) client.write(': heartbeat\n\n')
    }, 20_000)
    this.heartbeat.unref?.()
    const statePath = this.runtime.store.writeServerState({
      pid: process.pid, host: LOOPBACK_HOST, port: address.port, token: this.token,
      rpcVersion: VIZRUNA_RUNTIME_RPC_VERSION, startedAt: Date.now(),
    })
    return { port: address.port, token: this.token, statePath }
  }

  async stop(): Promise<void> {
    if (this.heartbeat) clearInterval(this.heartbeat)
    this.heartbeat = null
    for (const client of this.clients) client.end()
    this.clients.clear()
    const server = this.server
    this.server = null
    if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
    this.runtime.store.clearServerState()
  }
}

export async function startRuntimeRpcServer(options: RuntimeRpcServerOptions = {}): Promise<RuntimeRpcServer> {
  const server = new RuntimeRpcServer(options)
  const state = await server.start()
  console.log(`[Vizruna Runtime] RPC v${VIZRUNA_RUNTIME_RPC_VERSION} listening on ${LOOPBACK_HOST}:${state.port}`)
  console.log(`[Vizruna Runtime] State: ${state.statePath}`)
  return server
}
