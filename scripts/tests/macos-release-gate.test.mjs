import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
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
})

test('release workflow cannot publish an unsigned macOS artifact', () => {
  const workflow = read('.github/workflows/release.yml')
  const candidateWorkflow = read('.github/workflows/release-candidate.yml')
  const runner = read('scripts/run-macos-release.mjs')
  const verifier = read('scripts/verify-macos-release.mjs')

  assert.match(candidateWorkflow, /npm run package:mac:release/)
  assert.match(candidateWorkflow, /runs-on:\s*macos-15/)
  assert.match(candidateWorkflow, /npm run verify/)
  assert.match(candidateWorkflow, /npm run test:e2e/)
  assert.match(candidateWorkflow, /npm audit --audit-level=low/)
  assert.match(candidateWorkflow, /npm audit --omit=dev --audit-level=low/)
  assert.ok(
    candidateWorkflow.indexOf('npm run verify') <
      candidateWorkflow.indexOf('npm run package:mac:release'),
  )
  assert.ok(
    candidateWorkflow.indexOf('npm run test:e2e') <
      candidateWorkflow.indexOf('npm run package:mac:release'),
  )
  assert.match(candidateWorkflow, /environment:\s*v0\.1-candidate/)
  assert.match(candidateWorkflow, /MAC_CSC_LINK/)
  assert.match(candidateWorkflow, /APPLE_APP_SPECIFIC_PASSWORD/)
  assert.doesNotMatch(
    candidateWorkflow,
    /build-mac:[\s\S]*CSC_IDENTITY_AUTO_DISCOVERY:\s*false/,
  )
  assert.doesNotMatch(workflow, /npm run package:mac:release/)
  assert.match(workflow, /actions\/download-artifact@v4/)
  assert.match(workflow, /run-id:.*candidate_run_id/)
  assert.match(workflow, /sha256sum --check/)
  assert.match(runner, /macos-release-preflight/)
  assert.match(runner, /PI_RELEASE_REQUIRE_NOTARIZATION:\s*'1'/)
  assert.match(verifier, /codesign/)
  assert.match(verifier, /spctl/)
  assert.match(verifier, /stapler/)
  assert.match(verifier, /Developer ID Application:/)
})

test('v0.1 release publishes only macOS and requires exact evidence approval', () => {
  const workflow = read('.github/workflows/release.yml')

  assert.doesNotMatch(workflow, /^\s{2}build-win:/m)
  assert.doesNotMatch(workflow, /^\s{2}build-linux:/m)
  assert.doesNotMatch(workflow, /^\s{2}build-mac:/m)
  assert.doesNotMatch(workflow, /dist\/\*Setup\*\.exe|dist\/\*\.AppImage/)
  assert.match(workflow, /authorize-release:[\s\S]*environment:\s*v0\.1-release/)
  assert.match(workflow, /release:[\s\S]*needs:\s*\[authorize-release\]/)
  assert.match(workflow, /RELEASE_EVIDENCE_COMMIT/)
  assert.match(workflow, /RELEASE_CANDIDATE_RUN_ID/)
  assert.match(workflow, /RELEASE_DMG_SHA256/)
  assert.match(workflow, /RELEASE_ZIP_SHA256/)
  assert.match(workflow, /APPROVED_COMMIT.*GITHUB_SHA/s)
  assert.match(workflow, /RUN_HEAD_SHA.*GITHUB_SHA/s)
  assert.match(workflow, /TAG_VERSION.*PACKAGE_VERSION/s)
  assert.match(workflow, /name:\s*pi-desktop-mac-candidate-/)
})

test('release verification covers app, DMG, and ZIP artifacts', () => {
  const verifier = read('scripts/verify-macos-release.mjs')
  const hook = read('scripts/notarize-release-artifacts.cjs')

  assert.match(verifier, /missing arm64 DMG/)
  assert.match(verifier, /missing arm64 ZIP/)
  assert.match(verifier, /DMG notarization ticket/)
  assert.match(hook, /\.endsWith\('\.dmg'\)/)
  assert.match(hook, /await notarize/)
})
