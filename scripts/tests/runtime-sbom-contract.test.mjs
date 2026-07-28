import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const sbomScript = readFileSync('scripts/generate-sbom.mjs', 'utf8')

describe('runtime SBOM reflects the packaged Pi dependency patches', () => {
  it('patches shrinkwrapped Pi dependencies during every install', () => {
    assert.match(packageJson.scripts.postinstall, /patch-pi-sdk-dependencies\.mjs/)
  })

  it('resolves the Electron platform binary before parallel tests can race', () => {
    assert.match(packageJson.scripts.postinstall, /ensure-electron-binary\.mjs/)
  })

  it('inspects installed production dependencies instead of stale shrinkwrap metadata', () => {
    assert.doesNotMatch(sbomScript, /--package-lock-only/)
    assert.match(sbomScript, /brace-expansion', '5\.0\.8'/)
    assert.match(sbomScript, /protobufjs', '7\.6\.5'/)
  })
})
