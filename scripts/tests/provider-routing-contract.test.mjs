import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

test('provider routing is Worker-isolated and never writes process or system proxy state', () => {
  const shared = read('packages/shared/provider-routing.ts')
  const worker = read('src/worker/provider-routing-runtime.ts')
  const mainFiles = [
    'src/main/provider-routing/provider-routing-service.ts',
    'src/main/worker-manager-pool.ts',
    'src/main/worker-manager.ts',
  ]
    .map(read)
    .join('\n')
  const production = `${shared}\n${worker}\n${mainFiles}`

  assert.match(shared, /'direct' \| 'system' \| 'profile'/)
  assert.match(worker, /getAuth/)
  assert.match(worker, /providerEnvironmentForRoute/)
  assert.match(worker, /currentConfig\(\)/)
  assert.match(worker, /setGlobalDispatcher/)
  assert.match(worker, /host: '127\.0\.0\.1'/)
  assert.match(worker, /requestAuthentication/)
  assert.doesNotMatch(
    production,
    /process\.env\.(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)\s*=/,
  )
  assert.doesNotMatch(production, /networksetup\s+-set(?:web|secureweb)proxy/i)
  assert.doesNotMatch(production, /scutil\s+--set/i)
})

test('proxy profiles cover HTTP, HTTPS, SOCKS5, SOCKS5H, and NO_PROXY', () => {
  const shared = read('packages/shared/provider-routing.ts')
  const schemas = read('src/main/ipc/schemas.ts')
  const service = read('src/main/provider-routing/provider-routing-service.ts')

  assert.match(shared, /'http' \| 'https' \| 'socks5' \| 'socks5h'/)
  assert.match(shared, /noProxy\?: string/)
  assert.match(schemas, /'socks5', 'socks5h'/)
  assert.match(service, /noProxyConfigured/)
  assert.doesNotMatch(service, /details:\s*\{[^}]*noProxy:/s)
})

test('profile secrets stay behind safeStorage and are not exposed by config IPC', () => {
  const service = read('src/main/provider-routing/provider-routing-service.ts')
  const secretStore = read('src/main/secret-store.ts')
  const shared = read('packages/shared/provider-routing.ts')

  assert.match(service, /setEncryptedSecret/)
  assert.match(service, /getEncryptedSecret/)
  assert.match(secretStore, /safeStorage\.encryptString/)
  assert.match(shared, /passwordConfigured: boolean/)
  assert.doesNotMatch(shared, /interface ProxyProfile \{[^}]*\bpassword\??: string/)
})

test('routing IPC is allowlisted, schema-validated, and pushed to live Workers', () => {
  const channels = read('packages/shared/ipc-channels.ts')
  const handlers = read('src/main/ipc/handlers/provider-routing.ts')
  const schemas = read('src/main/ipc/schemas.ts')
  const manager = read('src/main/worker-manager.ts')

  for (const channel of [
    'ipc:providerRouting.get',
    'ipc:providerRouting.set',
    'ipc:providerRouting.diagnose',
    'ipc:proxyProfile.save',
    'ipc:proxyProfile.delete',
  ]) {
    assert.match(channels, new RegExp(channel.replace('.', '\\.')))
    assert.match(handlers, new RegExp(channel.replace('.', '\\.')))
  }
  assert.match(handlers, /registerHandlerWithSchema/)
  assert.match(schemas, /confirmed: z\.literal\(true\)/)
  assert.match(manager, /updateProviderRouting/)
  assert.match(manager, /pendingProviderRouting/)
  assert.match(manager, /event\.phase === 'idle'/)
  assert.match(handlers, /applyToLiveWorkers/)
})

test('connectivity diagnostics send neither credentials nor inference payloads', () => {
  const service = read('src/main/provider-routing/provider-routing-service.ts')

  assert.match(service, /method: 'HEAD'/)
  assert.match(service, /credentialsSent: false/)
  assert.match(service, /inferenceSent: false/)
  assert.match(service, /systemProxyModified: false/)
  assert.doesNotMatch(service, /Authorization:/)
})
