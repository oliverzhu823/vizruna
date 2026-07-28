export type ProviderRouteMode = 'direct' | 'system' | 'profile'
export type ProxyProtocol = 'http' | 'https' | 'socks5' | 'socks5h'

export interface ProxyProfile {
  id: string
  name: string
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  noProxy?: string
  passwordConfigured: boolean
}

export interface ProviderRoute {
  provider: string
  mode: ProviderRouteMode
  profileId?: string
}

export interface ProviderRoutingConfig {
  profiles: ProxyProfile[]
  routes: ProviderRoute[]
  providers: ProviderRoutingProvider[]
  systemProxyDetected: boolean
  systemProxySource?: 'environment' | 'macos' | 'none'
}

export interface ProviderRoutingProvider {
  id: string
  displayName: string
  targetOrigin?: string
  source: 'builtin' | 'custom'
}

export interface ProxyProfileSaveRequest {
  id?: string
  name: string
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  noProxy?: string
  password?: string
  preservePassword?: boolean
}

export interface ProviderRouteSetRequest extends ProviderRoute {}

export interface ProviderRoutingRuntime {
  routes: Record<
    string,
    {
      mode: ProviderRouteMode
      proxyUrl?: string
      noProxy?: string
      profileId?: string
    }
  >
  systemProxyUrl?: string
  systemNoProxy?: string
}

export interface ConnectivityStage {
  stage: 'resolve-target' | 'dns' | 'tcp-tls-http'
  status: 'passed' | 'failed' | 'skipped'
  detail: string
  durationMs: number
}

export interface ProviderConnectivityResult {
  ok: boolean
  provider: string
  route: ProviderRoute
  routeLabel: string
  targetOrigin?: string
  httpStatus?: number
  stages: ConnectivityStage[]
  failure?: import('./reliability').FailureEnvelope
  credentialsSent: false
  inferenceSent: false
  systemProxyModified: false
}

export function noProxyMatches(target: URL, noProxy?: string): boolean {
  if (!noProxy) return false
  const targetHost = target.hostname.replace(/^\[|\]$/g, '').toLowerCase()
  const targetPort = Number(target.port) || (target.protocol === 'https:' ? 443 : 80)
  for (const rawEntry of noProxy.split(/[,\s]+/)) {
    if (!rawEntry) continue
    if (rawEntry === '*') return true
    const match = rawEntry.match(/^(.+):(\d+)$/)
    const entryPort = match ? Number(match[2]) : 0
    if (entryPort && entryPort !== targetPort) continue
    const entryHost = (match ? match[1] : rawEntry)
      .replace(/^\*?\./, '')
      .replace(/^\[|\]$/g, '')
      .toLowerCase()
    if (targetHost === entryHost || targetHost.endsWith(`.${entryHost}`)) return true
  }
  return false
}

export function providerEnvironmentForRoute(
  runtime: ProviderRoutingRuntime,
  provider: string,
): Record<string, string> {
  const route = runtime.routes[provider] ?? { mode: 'system' as const }
  if (route.mode === 'direct') {
    return { NO_PROXY: '*', no_proxy: '*' }
  }
  const explicitProfile = route.mode === 'profile'
  const proxyUrl = explicitProfile ? route.proxyUrl : runtime.systemProxyUrl
  if (!proxyUrl) return {}
  const noProxy = explicitProfile
    ? route.noProxy || '__pi_enterprise_no_bypass__'
    : runtime.systemNoProxy
  const proxyEnvironment = {
    HTTP_PROXY: proxyUrl,
    HTTPS_PROXY: proxyUrl,
    ALL_PROXY: proxyUrl,
    http_proxy: proxyUrl,
    https_proxy: proxyUrl,
    all_proxy: proxyUrl,
  }
  if (!noProxy) return proxyEnvironment
  return {
    ...proxyEnvironment,
    // Pi falls back to process.env when a scoped env value is empty. Explicit
    // profiles therefore use a truthy sentinel when no bypass was configured.
    NO_PROXY: noProxy,
    no_proxy: noProxy,
  }
}
