import { randomBytes } from 'node:crypto'
import { AsyncLocalStorage } from 'node:async_hooks'
import {
  Agent,
  EnvHttpProxyAgent,
  fetch as undiciFetch,
  type Dispatcher,
  type RequestInit as UndiciRequestInit,
} from 'undici'
import { Server as ProxyServer } from 'proxy-chain'
import type { ProviderRoutingRuntime } from '@shared/provider-routing'

const NO_BYPASS = '__pi_enterprise_no_bypass__'
const scopedDispatcher = new AsyncLocalStorage<Dispatcher>()
let scopedFetchInstalled = false

function installScopedFetch(): void {
  if (scopedFetchInstalled) return
  const defaultFetch = globalThis.fetch.bind(globalThis)
  globalThis.fetch = (input, init) => {
    const dispatcher = scopedDispatcher.getStore()
    if (!dispatcher) return defaultFetch(input, init)
    if (typeof input !== 'string' && !(input instanceof URL)) {
      return Promise.reject(
        new Error('Scoped provider authentication requires a URL request'),
      )
    }
    const scopedInit = {
      ...(init as unknown as UndiciRequestInit),
      dispatcher,
    }
    return undiciFetch(input, scopedInit) as unknown as Promise<Response>
  }
  scopedFetchInstalled = true
}

function isSocksProxy(proxyUrl: string): boolean {
  return ['socks:', 'socks5:', 'socks5h:'].includes(new URL(proxyUrl).protocol)
}

async function createSocksBridge(
  upstreamProxyUrl: string,
): Promise<{ server: ProxyServer; proxyUrl: string }> {
  const username = randomBytes(18).toString('hex')
  const password = randomBytes(24).toString('hex')
  const server = new ProxyServer({
    host: '127.0.0.1',
    port: 0,
    prepareRequestFunction: (request) => ({
      requestAuthentication:
        request.username !== username || request.password !== password,
      upstreamProxyUrl,
    }),
  })
  await server.listen()
  const localUrl = new URL('http://127.0.0.1')
  localUrl.port = String(server.port)
  localUrl.username = username
  localUrl.password = password
  return { server, proxyUrl: localUrl.toString() }
}

async function runScoped<T>(
  runtime: ProviderRoutingRuntime,
  providerId: string,
  operation: () => Promise<T>,
): Promise<T> {
  const route = runtime.routes[providerId] ?? { mode: 'system' as const }
  const upstream =
    route.mode === 'profile'
      ? route.proxyUrl
      : route.mode === 'system'
        ? runtime.systemProxyUrl
        : undefined
  const noProxy =
    route.mode === 'profile'
      ? route.noProxy || NO_BYPASS
      : route.mode === 'system'
        ? runtime.systemNoProxy
        : '*'

  let bridge: ProxyServer | undefined
  let dispatcher: Dispatcher | undefined
  try {
    let effectiveProxy = upstream
    if (upstream && isSocksProxy(upstream)) {
      const created = await createSocksBridge(upstream)
      bridge = created.server
      effectiveProxy = created.proxyUrl
    }
    dispatcher = effectiveProxy
      ? new EnvHttpProxyAgent({
          httpProxy: effectiveProxy,
          httpsProxy: effectiveProxy,
          noProxy: noProxy || NO_BYPASS,
        })
      : new Agent()
    installScopedFetch()
    return await scopedDispatcher.run(dispatcher, operation)
  } finally {
    await dispatcher?.close().catch(() => undefined)
    await bridge?.close(true).catch(() => undefined)
  }
}

/**
 * Pi's built-in OAuth providers use global fetch. A stable fetch wrapper reads
 * the dispatcher from AsyncLocalStorage, so only this login promise chain uses
 * the selected provider route. Concurrent Main-process requests keep their
 * normal dispatcher and no process or system proxy state is changed.
 */
export function withProviderAuthNetwork<T>(
  runtime: ProviderRoutingRuntime,
  providerId: string,
  operation: () => Promise<T>,
): Promise<T> {
  return runScoped(runtime, providerId, operation)
}
