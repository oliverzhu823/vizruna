import { randomUUID } from 'node:crypto'
import { lookup } from 'node:dns/promises'
import { execFileSync } from 'node:child_process'
import { performance } from 'node:perf_hooks'
import { Agent, EnvHttpProxyAgent, request } from 'undici'
import type {
  ConnectivityStage,
  ProviderConnectivityResult,
  ProviderRoute,
  ProviderRouteSetRequest,
  ProviderRoutingConfig,
  ProviderRoutingProvider,
  ProviderRoutingRuntime,
  ProxyProfile,
  ProxyProfileSaveRequest,
} from '@shared/provider-routing'
import {
  noProxyMatches,
  providerEnvironmentForRoute,
} from '@shared/provider-routing'
import { auditRepository } from '../audit/audit-repository'
import { configStore } from '../config-store'
import {
  deleteEncryptedSecret,
  getEncryptedSecret,
  setEncryptedSecret,
} from '../secret-store'
import { failureFromUnknown } from '../reliability/failure-model'
import { readModelsConfigRaw } from '../pi-models-json'
import { getActiveSdkModule } from '../ipc/sdk-session'

type StoredProfile = Omit<ProxyProfile, 'passwordConfigured'>

const PROVIDER_ID = /^[A-Za-z0-9._:-]{1,120}$/

function profileSecretId(id: string): string {
  return `proxy:${id}`
}

function validateProfileInput(
  input: ProxyProfileSaveRequest,
): Omit<StoredProfile, 'id'> {
  const name = input.name.trim()
  const host = input.host.trim().replace(/^\[|\]$/g, '')
  const username = input.username?.trim() || undefined
  const noProxy = input.noProxy?.trim() || undefined
  if (!name || name.length > 80) throw new Error('Proxy profile name is required')
  if (
    !host ||
    host.length > 253 ||
    /[/?#@\s]/.test(host)
  ) {
    throw new Error('Proxy host must be a hostname or IP address without a URL scheme')
  }
  if (!Number.isInteger(input.port) || input.port < 1 || input.port > 65_535) {
    throw new Error('Proxy port must be between 1 and 65535')
  }
  if (username && username.length > 200) throw new Error('Proxy username is too long')
  if (
    noProxy &&
    (noProxy.length > 2_048 || /[\r\n\u0000-\u001f\u007f]/.test(noProxy))
  ) {
    throw new Error('NO_PROXY must be a single line no longer than 2048 characters')
  }
  return {
    name,
    protocol: input.protocol,
    host,
    port: input.port,
    username,
    noProxy,
  }
}

export function proxyUrlForProfile(
  profile: StoredProfile,
  password?: string | null,
): string {
  const url = new URL(`${profile.protocol}://localhost`)
  url.hostname = profile.host
  url.port = String(profile.port)
  if (profile.username) url.username = profile.username
  if (password) url.password = password
  return url.toString()
}

function environmentProxy(): { url?: string; noProxy?: string } {
  const value =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy
  const noProxy = process.env.NO_PROXY || process.env.no_proxy || undefined
  if (!value) return { noProxy }
  try {
    const url = new URL(value)
    return ['http:', 'https:', 'socks:', 'socks5:', 'socks5h:'].includes(url.protocol)
      ? { url: url.toString(), noProxy }
      : { noProxy }
  } catch {
    return { noProxy }
  }
}

export function parseMacSystemProxy(output: string): string | undefined {
  const read = (key: string): string | undefined =>
    output.match(new RegExp(`^\\s*${key}\\s*:\\s*(.+?)\\s*$`, 'm'))?.[1]
  const candidates = [
    ['HTTPSEnable', 'HTTPSProxy', 'HTTPSPort', 'http'],
    ['HTTPEnable', 'HTTPProxy', 'HTTPPort', 'http'],
    ['SOCKSEnable', 'SOCKSProxy', 'SOCKSPort', 'socks5'],
  ] as const
  for (const [enabledKey, hostKey, portKey, protocol] of candidates) {
    if (read(enabledKey) !== '1') continue
    const host = read(hostKey)
    const port = Number(read(portKey))
    if (!host || !Number.isInteger(port) || port < 1 || port > 65_535) continue
    const url = new URL(`${protocol}://localhost`)
    url.hostname = host
    url.port = String(port)
    return url.toString()
  }
  return undefined
}

export function parseMacNoProxy(output: string): string | undefined {
  const block = output.match(/ExceptionsList\s*:\s*<array>\s*\{([\s\S]*?)^\s*\}/m)?.[1]
  if (!block) return undefined
  const values = [...block.matchAll(/^\s*\d+\s*:\s*(.+?)\s*$/gm)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => !!value)
  return values.length > 0 ? values.join(',') : undefined
}

function systemProxy(): {
  url?: string
  noProxy?: string
  source: 'environment' | 'macos' | 'none'
} {
  const fromEnvironment = environmentProxy()
  if (fromEnvironment.url) return { ...fromEnvironment, source: 'environment' }
  if (process.platform === 'darwin') {
    try {
      const output = execFileSync('/usr/sbin/scutil', ['--proxy'], {
        encoding: 'utf8',
        timeout: 1_500,
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      const url = parseMacSystemProxy(output)
      if (url) {
        return {
          url,
          noProxy: parseMacNoProxy(output) || fromEnvironment.noProxy,
          source: 'macos',
        }
      }
    } catch {
      // A missing/disabled system proxy is a valid state.
    }
  }
  return { noProxy: fromEnvironment.noProxy, source: 'none' }
}

function publicProfiles(): ProxyProfile[] {
  return configStore.get('proxyProfiles').map((profile) => ({
    ...profile,
    passwordConfigured: !!getEncryptedSecret(profileSecretId(profile.id)),
  }))
}

function configuredRoutes(): ProviderRoute[] {
  return Object.entries(configStore.get('providerRoutes'))
    .map(([provider, route]) => ({ provider, ...route }))
    .sort((a, b) => a.provider.localeCompare(b.provider))
}

async function providerBaseUrl(provider: string): Promise<string | undefined> {
  const disk = readModelsConfigRaw().config.providers[provider]?.baseUrl
  if (disk) return disk
  try {
    const { ModelRuntime } = await getActiveSdkModule()
    const runtime = await ModelRuntime.create({ allowModelNetwork: false })
    const model = runtime
      .getModels()
      .find((candidate: { provider?: string }) => candidate.provider === provider) as
      | { baseUrl?: string }
      | undefined
    return model?.baseUrl
  } catch {
    return undefined
  }
}

async function routingProviders(): Promise<ProviderRoutingProvider[]> {
  const customProviders = readModelsConfigRaw().config.providers
  const rows = new Map<string, ProviderRoutingProvider>()
  try {
    const { ModelRuntime } = await getActiveSdkModule()
    const runtime = await ModelRuntime.create({ allowModelNetwork: false })
    for (const model of runtime.getModels()) {
      const id = String(model.provider || '').trim()
      if (!id || rows.has(id)) continue
      let targetOrigin: string | undefined
      try {
        targetOrigin = model.baseUrl ? new URL(model.baseUrl).origin : undefined
      } catch {
        // Keep malformed custom endpoints out of the public summary.
      }
      rows.set(id, {
        id,
        displayName: runtime.getProvider(id)?.name || id,
        targetOrigin,
        source: Object.hasOwn(customProviders, id) ? 'custom' : 'builtin',
      })
    }
  } catch {
    // Custom providers are still useful when the active SDK cannot be loaded.
  }
  for (const [id, provider] of Object.entries(customProviders)) {
    if (rows.has(id)) continue
    let targetOrigin: string | undefined
    try {
      targetOrigin = provider.baseUrl ? new URL(provider.baseUrl).origin : undefined
    } catch {
      // Endpoint validation is surfaced by models.json editing and diagnostics.
    }
    rows.set(id, {
      id,
      displayName: provider.name || id,
      targetOrigin,
      source: 'custom',
    })
  }
  for (const route of configuredRoutes()) {
    if (rows.has(route.provider)) continue
    rows.set(route.provider, {
      id: route.provider,
      displayName: route.provider,
      source: 'custom',
    })
  }
  return [...rows.values()].sort((a, b) =>
    a.displayName.localeCompare(b.displayName),
  )
}

async function timedStage<T>(
  stage: ConnectivityStage['stage'],
  operation: () => Promise<T>,
): Promise<{ value?: T; stage: ConnectivityStage; error?: unknown }> {
  const started = performance.now()
  try {
    const value = await operation()
    return {
      value,
      stage: {
        stage,
        status: 'passed',
        detail: stage === 'dns' ? 'Host resolved' : 'Completed',
        durationMs: Math.round(performance.now() - started),
      },
    }
  } catch (error) {
    return {
      error,
      stage: {
        stage,
        status: 'failed',
        detail: error instanceof Error ? error.message : String(error),
        durationMs: Math.round(performance.now() - started),
      },
    }
  }
}

function undiciProxyUrl(proxyUrl: string): string {
  const parsed = new URL(proxyUrl)
  // Undici resolves target hostnames through SOCKS5 already, while its proxy
  // URL parser accepts socks5:// but not the conventional socks5h:// alias.
  if (parsed.protocol === 'socks5h:') parsed.protocol = 'socks5:'
  return parsed.toString()
}

async function probeHttp(target: URL, proxyUrl?: string, noProxy?: string): Promise<number> {
  const dispatcher = proxyUrl
    ? new EnvHttpProxyAgent({
        httpProxy: undiciProxyUrl(proxyUrl),
        httpsProxy: undiciProxyUrl(proxyUrl),
        noProxy: noProxy || '__pi_enterprise_no_bypass__',
      })
    : new Agent()
  try {
    const response = await request(target, {
      method: 'HEAD',
      dispatcher,
      headers: {
        Accept: '*/*',
        'User-Agent': 'vizruna-connectivity-check',
      },
      headersTimeout: 12_000,
      bodyTimeout: 12_000,
      signal: AbortSignal.timeout(12_000),
    })
    await response.body.dump()
    return response.statusCode
  } finally {
    await dispatcher.close()
  }
}

export class ProviderRoutingService {
  async getConfig(): Promise<ProviderRoutingConfig> {
    const detected = systemProxy()
    return {
      profiles: publicProfiles(),
      routes: configuredRoutes(),
      providers: await routingProviders(),
      systemProxyDetected: !!detected.url,
      systemProxySource: detected.source,
    }
  }

  saveProfile(input: ProxyProfileSaveRequest): ProxyProfile {
    const profile = validateProfileInput(input)
    const id = input.id || randomUUID()
    if (input.id && !configStore.get('proxyProfiles').some((item) => item.id === id)) {
      throw new Error('Unknown proxy profile')
    }
    const stored: StoredProfile = { id, ...profile }
    const next = configStore
      .get('proxyProfiles')
      .filter((item) => item.id !== id)
    next.push(stored)
    if (input.password) {
      if (!setEncryptedSecret(profileSecretId(id), input.password)) {
        throw new Error('System encryption is unavailable; proxy password was not saved')
      }
    } else if (input.preservePassword !== true) {
      deleteEncryptedSecret(profileSecretId(id))
    }
    configStore.set('proxyProfiles', next)
    const result = {
      ...stored,
      passwordConfigured: !!getEncryptedSecret(profileSecretId(id)),
    }
    auditRepository.write({
      category: 'proxy',
      action: 'proxy.profile.save',
      outcome: 'success',
      details: {
        profileId: id,
        protocol: stored.protocol,
        host: stored.host,
        port: stored.port,
        noProxyConfigured: !!stored.noProxy,
        passwordConfigured: result.passwordConfigured,
      },
    })
    return result
  }

  deleteProfile(id: string, confirmed: true): void {
    if (confirmed !== true) throw new Error('Confirmation required')
    const profiles = configStore.get('proxyProfiles')
    if (!profiles.some((item) => item.id === id)) throw new Error('Unknown proxy profile')
    configStore.set(
      'proxyProfiles',
      profiles.filter((item) => item.id !== id),
    )
    const routes = { ...configStore.get('providerRoutes') }
    const resetProviders: string[] = []
    for (const [provider, route] of Object.entries(routes)) {
      if (route.profileId !== id) continue
      routes[provider] = { mode: 'direct' }
      resetProviders.push(provider)
    }
    configStore.set('providerRoutes', routes)
    deleteEncryptedSecret(profileSecretId(id))
    auditRepository.write({
      category: 'proxy',
      action: 'proxy.profile.delete',
      outcome: 'success',
      details: { profileId: id, resetProviders },
    })
  }

  setRoute(input: ProviderRouteSetRequest): ProviderRoute {
    const provider = input.provider.trim()
    if (!PROVIDER_ID.test(provider)) throw new Error('Invalid provider identifier')
    if (
      input.mode === 'profile' &&
      !configStore
        .get('proxyProfiles')
        .some((profile) => profile.id === input.profileId)
    ) {
      throw new Error('A valid proxy profile is required')
    }
    const route: Omit<ProviderRoute, 'provider'> =
      input.mode === 'profile'
        ? { mode: 'profile', profileId: input.profileId }
        : { mode: input.mode }
    configStore.set('providerRoutes', {
      ...configStore.get('providerRoutes'),
      [provider]: route,
    })
    auditRepository.write({
      category: 'proxy',
      action: 'provider.route.set',
      outcome: 'success',
      details: { provider, mode: route.mode, profileId: route.profileId },
    })
    return { provider, ...route }
  }

  runtimeConfig(): ProviderRoutingRuntime {
    const profiles = new Map(configStore.get('proxyProfiles').map((item) => [item.id, item]))
    const routes: ProviderRoutingRuntime['routes'] = {}
    for (const route of configuredRoutes()) {
      const profile = route.profileId ? profiles.get(route.profileId) : undefined
      if (route.mode === 'profile' && !profile) {
        // Corrupt/stale references fail closed to direct instead of inheriting
        // an unrelated ambient proxy.
        routes[route.provider] = { mode: 'direct' }
        continue
      }
      routes[route.provider] = {
        mode: route.mode,
        profileId: route.profileId,
        ...(route.mode === 'profile' && profile
          ? {
              proxyUrl: proxyUrlForProfile(
                profile,
                getEncryptedSecret(profileSecretId(profile.id)),
              ),
              noProxy: profile.noProxy,
            }
          : {}),
      }
    }
    const detected = systemProxy()
    return {
      routes,
      systemProxyUrl: detected.url,
      systemNoProxy: detected.noProxy,
    }
  }

  async diagnose(provider: string): Promise<ProviderConnectivityResult> {
    if (!PROVIDER_ID.test(provider)) throw new Error('Invalid provider identifier')
    const route =
      configuredRoutes().find((item) => item.provider === provider) ??
      ({ provider, mode: 'system' } satisfies ProviderRoute)
    const stages: ConnectivityStage[] = []
    const targetResult = await timedStage('resolve-target', async () => {
      const baseUrl = await providerBaseUrl(provider)
      if (!baseUrl) throw new Error(`No endpoint found for provider "${provider}"`)
      const url = new URL(baseUrl)
      if (!['http:', 'https:'].includes(url.protocol)) {
        throw new Error('Provider endpoint must use HTTP or HTTPS')
      }
      url.username = ''
      url.password = ''
      return url
    })
    stages.push(targetResult.stage)
    if (!targetResult.value) {
      return this.failedDiagnostic(provider, route, stages, targetResult.error)
    }

    const runtime = this.runtimeConfig()
    const env = providerEnvironmentForRoute(runtime, provider)
    const proxyUrl =
      route.mode === 'profile'
        ? runtime.routes[provider]?.proxyUrl
        : route.mode === 'system'
          ? runtime.systemProxyUrl
          : undefined
    const noProxy =
      route.mode === 'profile'
        ? runtime.routes[provider]?.noProxy
        : route.mode === 'system'
          ? runtime.systemNoProxy
          : undefined
    const effectiveProxyUrl =
      proxyUrl && !noProxyMatches(targetResult.value, noProxy) ? proxyUrl : undefined
    const dnsTarget = effectiveProxyUrl
      ? new URL(effectiveProxyUrl).hostname
      : targetResult.value.hostname
    const dnsResult = await timedStage('dns', () => lookup(dnsTarget))
    stages.push({
      ...dnsResult.stage,
      detail: effectiveProxyUrl ? 'Proxy host resolved' : 'Provider host resolved',
    })
    if (dnsResult.error) {
      return this.failedDiagnostic(
        provider,
        route,
        stages,
        dnsResult.error,
        targetResult.value.origin,
      )
    }
    const httpResult = await timedStage('tcp-tls-http', () =>
      probeHttp(targetResult.value!, proxyUrl, noProxy),
    )
    stages.push({
      ...httpResult.stage,
      detail: httpResult.value
        ? `HTTP ${httpResult.value}; network path is reachable`
        : httpResult.stage.detail,
    })
    if (httpResult.error) {
      return this.failedDiagnostic(
        provider,
        route,
        stages,
        httpResult.error,
        targetResult.value.origin,
      )
    }
    const result: ProviderConnectivityResult = {
      ok: true,
      provider,
      route,
      routeLabel: this.routeLabel(route),
      targetOrigin: targetResult.value.origin,
      httpStatus: httpResult.value,
      stages,
      credentialsSent: false,
      inferenceSent: false,
      systemProxyModified: false,
    }
    auditRepository.write({
      category: 'proxy',
      action: 'provider.connectivity',
      outcome: 'success',
      details: {
        provider,
        routeMode: route.mode,
        profileId: route.profileId,
        targetOrigin: result.targetOrigin,
        httpStatus: result.httpStatus,
        credentialsSent: false,
        inferenceSent: false,
        environmentKeys: Object.keys(env),
      },
    })
    return result
  }

  private failedDiagnostic(
    provider: string,
    route: ProviderRoute,
    stages: ConnectivityStage[],
    error: unknown,
    targetOrigin?: string,
  ): ProviderConnectivityResult {
    const failure = failureFromUnknown(error, 'network')
    auditRepository.write({
      category: 'proxy',
      action: 'provider.connectivity',
      outcome: 'failed',
      details: {
        provider,
        routeMode: route.mode,
        profileId: route.profileId,
        targetOrigin,
        failure,
        credentialsSent: false,
        inferenceSent: false,
      },
    })
    return {
      ok: false,
      provider,
      route,
      routeLabel: this.routeLabel(route),
      targetOrigin,
      stages,
      failure,
      credentialsSent: false,
      inferenceSent: false,
      systemProxyModified: false,
    }
  }

  private routeLabel(route: ProviderRoute): string {
    if (route.mode === 'direct') return 'direct'
    if (route.mode === 'system') return 'system'
    const name = publicProfiles().find((profile) => profile.id === route.profileId)?.name
    return name ? `profile:${name}` : 'profile:missing'
  }
}

let instance: ProviderRoutingService | null = null

export function getProviderRoutingService(): ProviderRoutingService {
  instance ??= new ProviderRoutingService()
  return instance
}
