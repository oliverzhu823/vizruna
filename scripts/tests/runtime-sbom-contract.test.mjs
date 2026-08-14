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
    assert.match(sbomScript, /npm 11 can omit hoisted packages/)
    assert.match(sbomScript, /'ls', '--omit=dev', '--all', '--json'/)
    assert.match(sbomScript, /productionPackages/)
    assert.match(sbomScript, /pi-coding-agent', '0\.84\.1'/)
    assert.match(sbomScript, /brace-expansion', '5\.0\.9'/)
    assert.match(sbomScript, /dompurify', '3\.4\.13'/)
    assert.match(sbomScript, /fast-uri', '3\.1\.5'/)
    assert.match(sbomScript, /protobufjs', '7\.6\.5'/)
    assert.match(sbomScript, /undici', '8\.9\.0'/)
  })
})
