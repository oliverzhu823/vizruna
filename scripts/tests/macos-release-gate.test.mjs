import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

test('macOS builder enables hardened runtime, entitlements, and notarization', () => {
  const builder = read('electron-builder.yml')
  assert.match(builder, /hardenedRuntime:\s*true/)
  assert.match(builder, /entitlements:\s*build\/entitlements\.mac\.plist/)
  assert.match(
    builder,
    /entitlementsInherit:\s*build\/entitlements\.mac\.inherit\.plist/,
  )
  assert.match(builder, /notarize:\s*true/)
  assert.match(
    builder,
    /afterAllArtifactBuild:\s*scripts\/notarize-release-artifacts\.cjs/,
  )
  assert.match(builder, /from:\s*NOTICE\.md[\s\S]*to:\s*legal\/NOTICE\.md/)
  assert.match(
    builder,
    /from:\s*THIRD_PARTY_LICENSES[\s\S]*to:\s*legal\/THIRD_PARTY_LICENSES/,
  )
})

test('all tag releases publish Vizruna-web source only', () => {
  const workflow = read('.github/workflows/prerelease.yml')

  assert.match(workflow, /tags:[\s\S]*- 'v\*'/)
  assert.match(workflow, /Vizruna-web-\$\{VERSION\}-source\.zip/)
  assert.match(workflow, /name: Vizruna-web \$\{\{ github\.ref_name \}\}/)
  assert.match(workflow, /prerelease: \$\{\{ contains\(github\.ref_name, '-'\) \}\}/)
  assert.doesNotMatch(workflow, /package:mac|test:package|\.dmg'[^\n]*-exec cp/)
  assert.equal(existsSync(join(root, '.github/workflows/release.yml')), false)
  assert.equal(existsSync(join(root, '.github/workflows/release-candidate.yml')), false)
})

test('alpha prerelease publishes Vizruna-web only', () => {
  const workflow = read('.github/workflows/prerelease.yml')

  assert.match(workflow, /Vizruna-web-\$\{VERSION\}-source\.zip/)
  assert.match(workflow, /npm run test:e2e:web/)
  assert.match(workflow, /node scripts\/ci-audit\.mjs/)
  assert.match(workflow, /prerelease: \$\{\{ contains\(github\.ref_name, '-'\) \}\}/)
  assert.match(workflow, /actions\/attest-build-provenance@v2/)
  assert.doesNotMatch(workflow, /npm run package:mac:unsigned|npm run test:package/)
  assert.doesNotMatch(workflow, /\.dmg'[^\n]*-exec cp|arm64\.zip/)
  assert.doesNotMatch(workflow, /MAC_CSC_LINK|APPLE_APP_SPECIFIC_PASSWORD/)
  assert.doesNotMatch(workflow, /environment:\s*v0\.1-candidate/)
})

test('unsigned in-app updates verify official assets before targeted quarantine handling', () => {
  const downloader = read('src/main/app-update-download.ts')
  const security = read('src/main/app-update-security.ts')

  assert.match(security, /hostname\.toLowerCase\(\) !== 'github\.com'/)
  assert.match(security, /checksum\.fileName !== UPDATE_CHECKSUM_FILE_NAME/)
  assert.match(security, /asset\.tag !== checksum\.tag/)
  assert.match(downloader, /fetchExpectedChecksum/)
  assert.match(downloader, /sha256Matches/)
  assert.match(downloader, /checksum_mismatch/)
  assert.ok(downloader.indexOf('sha256Matches') < downloader.indexOf('shell.openPath(dest)'))
  assert.ok(
    downloader.indexOf('clearVerifiedDmgQuarantine(dest') <
      downloader.indexOf('shell.openPath(dest)'),
  )
  assert.match(downloader, /spawnSync\('\/usr\/bin\/xattr'/)
  assert.match(downloader, /\['-d', 'com\.apple\.quarantine', path\]/)
  assert.doesNotMatch(downloader, /spctl|--master-disable|\/Applications\/Vizruna\.app/)
})

test('retired desktop release tooling is not an active GitHub workflow', () => {
  assert.equal(existsSync(join(root, '.github/workflows/release.yml')), false)
  assert.equal(existsSync(join(root, '.github/workflows/release-candidate.yml')), false)
  assert.equal(existsSync(join(root, 'scripts/run-macos-release.mjs')), true)
  assert.equal(existsSync(join(root, 'scripts/verify-macos-release.mjs')), true)
})

test('release verification covers app, DMG, and ZIP artifacts', () => {
  const verifier = read('scripts/verify-macos-release.mjs')
  const hook = read('scripts/notarize-release-artifacts.cjs')

  assert.match(verifier, /missing arm64 DMG/)
  assert.match(verifier, /missing arm64 ZIP/)
  assert.match(verifier, /DMG notarization ticket/)
  assert.match(hook, /\.endsWith\('\.dmg'\)/)
  assert.match(hook, /await notarize/)
  assert.match(hook, /stapler', 'staple'/)
})
