import { runtimeIdentity } from '../main/bootstrap-path'
import { app, shell } from 'electron'
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { randomBytes } from 'node:crypto'
import { extname, join, normalize, resolve } from 'node:path'
import { registerAllHandlers } from '../main/ipc'
import { hasRegisteredHandler, invokeRegisteredHandler } from '../main/ipc/registry'
import { isAllowedIpcChannel } from '@shared/ipc-channels'
import {
  subscribeRuntimeEvents,
  type RuntimeEventEnvelope,
} from '../main/runtime-event-bus'
import { resolveApplicationRoot } from '../main/application-root'
import { workerManager } from '../main/worker-manager'
import { getTerminalService } from '../main/terminal/terminal-service'
import { getManagedWorktreeService } from '../main/worktree/managed-worktree-instance'
import { getOrchestrationService } from '../main/orchestration/orchestration-instance'
import {
  constantTimeEqual,
  isExpectedLoopbackHost,
  isSameOriginRequest,
  readCookie,
} from './security'

const LOOPBACK_HOST = '127.0.0.1'
const MAX_RPC_BODY_BYTES = 24 * 1024 * 1024
const AUTH_COOKIE = 'vizruna_web_session'
const startupToken =
  process.env.VIZRUNA_WEB_TEST === '1' && process.env.VIZRUNA_WEB_STARTUP_TOKEN?.trim()
    ? process.env.VIZRUNA_WEB_STARTUP_TOKEN.trim()
    : randomBytes(32).toString('base64url')
const browserSession = randomBytes(32).toString('base64url')
let startupTokenConsumed = false
const sseClients = new Set<ServerResponse>()

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

function isAuthenticated(req: IncomingMessage): boolean {
  const value = readCookie(req.headers.cookie, AUTH_COOKIE)
  return value != null && constantTimeEqual(value, browserSession)
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += buffer.length
    if (total > MAX_RPC_BODY_BYTES) throw new Error('REQUEST_TOO_LARGE')
    chunks.push(buffer)
  }
  if (chunks.length === 0) return {}
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

const MIME_TYPES: Record<string, string> = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.ico': 'image/x-icon',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.woff2': 'font/woff2',
}

function serveStatic(req: IncomingMessage, res: ServerResponse, rendererRoot: string): void {
  const pathname = new URL(req.url || '/', 'http://localhost').pathname
  const requested = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '')
  const normalized = normalize(requested)
  const filePath = resolve(rendererRoot, normalized)
  if (!filePath.startsWith(`${resolve(rendererRoot)}${process.platform === 'win32' ? '\\' : '/'}`)) {
    json(res, 404, { error: 'not_found' })
    return
  }
  const target = existsSync(filePath) && statSync(filePath).isFile()
    ? filePath
    : join(rendererRoot, 'index.html')
  if (!existsSync(target) || !statSync(target).isFile()) {
    json(res, 503, { error: 'renderer_not_built', message: 'Run npm run build:web first.' })
    return
  }
  const stat = statSync(target)
  res.writeHead(200, {
    'Content-Type': MIME_TYPES[extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': String(stat.size),
    'Cache-Control': target.endsWith('index.html') ? 'no-store' : 'public, max-age=31536000, immutable',
    'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; font-src 'self' data:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
  })
  if (req.method === 'HEAD') {
    res.end()
    return
  }
  createReadStream(target).pipe(res)
}

function broadcast(event: RuntimeEventEnvelope): void {
  const frame = `event: runtime\ndata: ${JSON.stringify(event)}\n\n`
  for (const client of [...sseClients]) {
    try {
      client.write(frame)
    } catch {
      sseClients.delete(client)
    }
  }
}

async function start(): Promise<void> {
  if (!app.requestSingleInstanceLock()) {
    console.error('[Vizruna-web] Another instance is already running.')
    app.quit()
    return
  }

  registerAllHandlers()
  workerManager.startRuntimeMonitoring()
  void getManagedWorktreeService().reconcile().catch((error) => {
    console.warn('[Vizruna-web] Worktree reconciliation failed:', error)
  })
  void getOrchestrationService().initialize().catch((error) => {
    console.warn('[Vizruna-web] Orchestration recovery failed:', error)
  })

  const applicationRoot = resolveApplicationRoot(app.getAppPath())
  const rendererRoot = join(applicationRoot, 'out', 'renderer')
  const productVersion = (() => {
    try {
      const pkg = JSON.parse(readFileSync(join(applicationRoot, 'package.json'), 'utf8')) as {
        version?: unknown
      }
      return typeof pkg.version === 'string' ? pkg.version : app.getVersion()
    } catch {
      return app.getVersion()
    }
  })()
  const requestedPort = Number(process.env.VIZRUNA_WEB_PORT || 0)
  const port = Number.isInteger(requestedPort) && requestedPort >= 0 && requestedPort <= 65535
    ? requestedPort
    : 0

  const server = createServer(async (req, res) => {
    const address = server.address()
    const activePort = typeof address === 'object' && address ? address.port : 0
    const origin = `http://${LOOPBACK_HOST}:${activePort}`
    const host = String(req.headers.host || '')
    if (!isExpectedLoopbackHost(host, activePort)) {
      json(res, 403, { error: 'invalid_host' })
      return
    }
    if (!isSameOriginRequest({
      expectedOrigin: origin,
      originHeader: req.headers.origin,
      secFetchSite: typeof req.headers['sec-fetch-site'] === 'string'
        ? req.headers['sec-fetch-site']
        : undefined,
    })) {
      json(res, 403, { error: 'invalid_origin' })
      return
    }

    const pathname = new URL(req.url || '/', origin).pathname
    if (pathname === '/api/auth' && req.method === 'POST') {
      try {
        const body = await readJsonBody(req) as { token?: unknown }
        if (
          startupTokenConsumed ||
          typeof body.token !== 'string' ||
          !constantTimeEqual(body.token, startupToken)
        ) {
          json(res, 401, { error: 'invalid_token' })
          return
        }
        startupTokenConsumed = true
        res.setHeader(
          'Set-Cookie',
          `${AUTH_COOKIE}=${encodeURIComponent(browserSession)}; Path=/; HttpOnly; SameSite=Strict`,
        )
        json(res, 200, { ok: true, product: 'Vizruna-web' })
      } catch (error) {
        json(res, 400, { error: error instanceof Error ? error.message : 'invalid_request' })
      }
      return
    }

    if (pathname.startsWith('/api/')) {
      if (!isAuthenticated(req)) {
        json(res, 401, { error: 'authentication_required' })
        return
      }
      if (pathname === '/api/health' && req.method === 'GET') {
        json(res, 200, {
          ok: true,
          product: 'Vizruna-web',
          version: productVersion,
          runtime: runtimeIdentity.channel,
          host: LOOPBACK_HOST,
        })
        return
      }
      if (pathname === '/api/events' && req.method === 'GET') {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-store',
          Connection: 'keep-alive',
          'X-Accel-Buffering': 'no',
        })
        res.write(': connected\n\n')
        sseClients.add(res)
        req.on('close', () => sseClients.delete(res))
        return
      }
      if (pathname === '/api/rpc' && req.method === 'POST') {
        if (req.headers['x-vizruna-requested-with'] !== 'Vizruna-web') {
          json(res, 403, { error: 'csrf_header_required' })
          return
        }
        try {
          const body = await readJsonBody(req) as { channel?: unknown; request?: unknown }
          const channel = typeof body.channel === 'string' ? body.channel : ''
          if (!isAllowedIpcChannel(channel) || !hasRegisteredHandler(channel)) {
            json(res, 404, { error: 'rpc_not_found' })
            return
          }
          const result = await invokeRegisteredHandler(channel, body.request)
          json(res, 200, { ok: true, result })
        } catch (error) {
          json(res, 500, {
            error: 'rpc_failed',
            message: error instanceof Error ? error.message : String(error),
          })
        }
        return
      }
      json(res, 404, { error: 'not_found' })
      return
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      json(res, 405, { error: 'method_not_allowed' })
      return
    }
    serveStatic(req, res, rendererRoot)
  })

  const unsubscribe = subscribeRuntimeEvents(broadcast)
  const heartbeat = setInterval(() => {
    for (const client of [...sseClients]) client.write(': heartbeat\n\n')
  }, 20_000)
  heartbeat.unref?.()

  await new Promise<void>((resolveListen, reject) => {
    server.once('error', reject)
    server.listen(port, LOOPBACK_HOST, () => resolveListen())
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Unable to resolve web server port')
  const url = `http://${LOOPBACK_HOST}:${address.port}/#token=${encodeURIComponent(startupToken)}`
  console.log(`[Vizruna-web] Running securely on ${LOOPBACK_HOST}:${address.port}`)
  console.log('[Vizruna-web] Browser access is restricted to this local launch session.')
  if (process.env.VIZRUNA_WEB_NO_OPEN !== '1') {
    await shell.openExternal(url)
  }

  let shuttingDown = false
  const shutdown = async () => {
    if (shuttingDown) return
    shuttingDown = true
    clearInterval(heartbeat)
    unsubscribe()
    for (const client of sseClients) client.end()
    sseClients.clear()
    await new Promise<void>((resolveClose) => server.close(() => resolveClose()))
    getTerminalService().dispose()
    await workerManager.stop().catch(() => undefined)
    app.exit(0)
  }
  process.once('SIGINT', () => void shutdown())
  process.once('SIGTERM', () => void shutdown())
  app.once('before-quit', (event) => {
    if (shuttingDown) return
    event.preventDefault()
    void shutdown()
  })
}

app.whenReady().then(() => void start()).catch((error) => {
  console.error('[Vizruna-web] Startup failed:', error)
  app.exit(1)
})
