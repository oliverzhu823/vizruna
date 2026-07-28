import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { extractFile } from '@electron/asar'
import { _electron as electron } from '@playwright/test'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const sourceManifest = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
)
const appPath = resolve(
  process.argv[2] || join(root, 'dist', 'mac-arm64', 'Vizruna.app'),
)
const contentsPath = join(appPath, 'Contents')
const executablePath = join(contentsPath, 'MacOS', 'Vizruna')
const asarPath = join(contentsPath, 'Resources', 'app.asar')
const infoPlistPath = join(contentsPath, 'Info.plist')
const testUserData = mkdtempSync(join(tmpdir(), 'pi-enterprise-package-smoke-'))

for (const path of [appPath, executablePath, asarPath, infoPlistPath]) {
  assert.ok(existsSync(path), `missing packaged artifact: ${path}`)
}

function readAsarJson(path) {
  return JSON.parse(extractFile(asarPath, path).toString('utf8'))
}

const manifest = readAsarJson('package.json')
assert.equal(manifest.name, 'vizruna')
assert.equal(manifest.productName, 'Vizruna')
assert.equal(manifest.version, sourceManifest.version)

const braceExpansion = readAsarJson('node_modules/brace-expansion/package.json')
const protobuf = readAsarJson('node_modules/protobufjs/package.json')
const proxyChain = readAsarJson('node_modules/proxy-chain/package.json')
const undici = readAsarJson('node_modules/undici/package.json')
assert.equal(braceExpansion.version, '5.0.8')
assert.equal(protobuf.version, '7.6.5')
assert.equal(proxyChain.version, '3.0.0')
assert.equal(undici.version, '8.5.0')

const plistResult = spawnSync(
  'plutil',
  ['-extract', 'CFBundleIdentifier', 'raw', '-o', '-', infoPlistPath],
  { encoding: 'utf8' },
)
assert.equal(plistResult.status, 0, plistResult.stderr)
assert.equal(plistResult.stdout.trim(), 'com.vizruna.desktop')

const electronApp = await electron.launch({
  executablePath,
  env: {
    ...process.env,
    PI_E2E: '1',
    PI_E2E_USER_DATA: testUserData,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  },
  timeout: 60_000,
})

try {
  const window = await electronApp.firstWindow({ timeout: 45_000 })
  await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
  assert.equal(await window.title(), 'Vizruna')

  const runtimeIdentity = await electronApp.evaluate(({ app }) => ({
    name: app.getName(),
    version: app.getVersion(),
    userData: app.getPath('userData'),
  }))
  assert.equal(runtimeIdentity.name, 'Vizruna')
  assert.equal(runtimeIdentity.version, sourceManifest.version)
  assert.equal(runtimeIdentity.userData, testUserData)

  console.log(
    `[package-smoke] verified ${runtimeIdentity.name} ${runtimeIdentity.version} at ${appPath}`,
  )
  console.log(`[package-smoke] userData ${runtimeIdentity.userData}`)
  console.log(
    `[package-smoke] runtime dependencies brace-expansion@${braceExpansion.version}, protobufjs@${protobuf.version}, proxy-chain@${proxyChain.version}, undici@${undici.version}`,
  )
} finally {
  await electronApp.close()
  rmSync(testUserData, { recursive: true, force: true })
}
