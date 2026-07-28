import { randomBytes } from 'node:crypto'
import type { AgentSessionServices } from '@earendil-works/pi-coding-agent'
import type { ProviderRoutingRuntime } from '@shared/provider-routing'
import { providerEnvironmentForRoute } from '@shared/provider-routing'
import { Server as ProxyServer } from 'proxy-chain'
import {
  Agent,
  EnvHttpProxyAgent,
  setGlobalDispatcher,
  type Dispatcher,
} from 'undici'

type ModelRuntime = AgentSessionServices['modelRuntime']
type GetAuth = ModelRuntime['getAuth']

const installed = new WeakSet<object>()

const NO_BYPASS = '__pi_enterprise_no_bypass__'

type ActiveTransport = {
  key: string
  environment: Record<string, string>
  dispatcher: Dispatcher
  bridge?: ProxyServer
}

function isSocksProxy(proxyUrl: string): boolean {
  return ['socks:', 'socks5:', 'socks5h:'].includes(new URL(proxyUrl).protocol)
}

async function createAuthenticatedSocksBridge(
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

/**
 * A Utility Worker is an isolated process and handles one active Pi turn at a
 * time. Installing its global Undici dispatcher therefore scopes routing to
 * that Worker without touching the main process, shell, OS, or other apps.
 */
class WorkerProviderTransport {
  private active?: ActiveTransport
  private queue: Promise<void> = Promise.resolve()

  apply(runtime: ProviderRoutingRuntime, provider: string): Promise<Record<string, string>> {
    const pending = this.queue.then(() => this.applyExclusive(runtime, provider))
    this.queue = pending.then(
      () => undefined,
      () => undefined,
    )
    return pending
  }

  async dispose(): Promise<void> {
    await this.queue
    const active = this.active
    this.active = undefined
    setGlobalDispatcher(new Agent())
    if (!active) return
    await active.dispatcher.close().catch(() => undefined)
    if (active.bridge) await active.bridge.close(true).catch(() => undefined)
  }

  private async applyExclusive(
    runtime: ProviderRoutingRuntime,
    provider: string,
  ): Promise<Record<string, string>> {
    const route = runtime.routes[provider] ?? { mode: 'system' as const }
    const upstreamProxyUrl =
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
    const key = JSON.stringify([route.mode, upstreamProxyUrl || '', noProxy || ''])
    if (this.active?.key === key) return this.active.environment

    let bridge: ProxyServer | undefined
    let effectiveProxyUrl = upstreamProxyUrl
    try {
      if (upstreamProxyUrl && isSocksProxy(upstreamProxyUrl)) {
        const created = await createAuthenticatedSocksBridge(upstreamProxyUrl)
        bridge = created.server
        effectiveProxyUrl = created.proxyUrl
      }

      const dispatcher = effectiveProxyUrl
        ? new EnvHttpProxyAgent({
            httpProxy: effectiveProxyUrl,
            httpsProxy: effectiveProxyUrl,
            noProxy: noProxy || NO_BYPASS,
          })
        : new Agent()
      const effectiveRuntime: ProviderRoutingRuntime = {
        ...runtime,
        routes: {
          ...runtime.routes,
          [provider]: {
            ...route,
            ...(route.mode === 'profile' ? { proxyUrl: effectiveProxyUrl } : {}),
          },
        },
        ...(route.mode === 'system' ? { systemProxyUrl: effectiveProxyUrl } : {}),
      }
      const environment = providerEnvironmentForRoute(effectiveRuntime, provider)
      const previous = this.active
      this.active = { key, environment, dispatcher, bridge }
      setGlobalDispatcher(dispatcher)
      if (previous) {
        await previous.dispatcher.close().catch(() => undefined)
        if (previous.bridge) await previous.bridge.close(true).catch(() => undefined)
      }
      return environment
    } catch (error) {
      if (bridge) await bridge.close(true).catch(() => undefined)
      throw error
    }
  }
}

const workerTransport = new WorkerProviderTransport()

/**
 * Adds routing to Pi's request boundary. The wrapper reads the latest runtime
 * config for every request, configures this isolated Worker's actual HTTP
 * transport, and also supplies scoped env values to Pi adapters that consume
 * proxy variables themselves. It never mutates process.env.
 */
export function installProviderRouting(
  runtime: ModelRuntime,
  currentConfig: () => ProviderRoutingRuntime,
): void {
  if (installed.has(runtime)) return
  installed.add(runtime)
  const getAuth = runtime.getAuth.bind(runtime) as (
    target: string | { provider: string },
    overrides?: { apiKey?: string; env?: Record<string, string> },
  ) => ReturnType<GetAuth>
  runtime.getAuth = (async (
    target: string | { provider: string },
    overrides?: { apiKey?: string; env?: Record<string, string> },
  ) => {
    const provider = typeof target === 'string' ? target : target.provider
    const routeEnv = await workerTransport.apply(currentConfig(), provider)
    const result = await getAuth(target, overrides)
    if (!result) return result
    if (Object.keys(routeEnv).length === 0) return result
    return {
      ...result,
      env: {
        ...result.env,
        ...routeEnv,
      },
    }
  }) as GetAuth
}

export async function disposeProviderRoutingTransport(): Promise<void> {
  await workerTransport.dispose()
}
