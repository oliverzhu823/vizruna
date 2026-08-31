import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const workflow = readFileSync(join(root, '.github/workflows/prerelease.yml'), 'utf8')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

describe('Vizruna-web tag distribution', () => {
  it('runs browser E2E before publishing', () => {
    assert.match(workflow, /npm run test:e2e:install/)
    assert.match(workflow, /npm run test:e2e:web/)
    assert.equal(manifest.scripts['rebuild:native:node'], 'npm rebuild better-sqlite3 node-pty')
    assert.match(
      manifest.scripts['test:e2e:web'],
      /^npm run rebuild:native:node && npm run build:web && playwright test/
    )
  })

  it('creates a versioned source archive containing the double-click launcher', () => {
    assert.match(workflow, /Vizruna-web-\$\{VERSION\}-source\.zip/)
    assert.match(workflow, /git archive --format=zip/)
    assert.match(workflow, /Start-Vizruna-web\.command/)
  })

  it('publishes no desktop installer or packaged application', () => {
    assert.doesNotMatch(workflow, /package:mac:unsigned/)
    assert.doesNotMatch(workflow, /npm run test:package/)
    assert.doesNotMatch(workflow, /npm run test:e2e(?:\s|$)/)
    assert.doesNotMatch(workflow, /find dist|arm64\.zip/)
    assert.match(workflow, /name: Vizruna-web \$\{\{ github\.ref_name \}\}/)
    assert.match(workflow, /find release-assets[^\n]+-name '\*\.dmg'[^\n]+"0"/)
    assert.match(workflow, /tags:[\s\S]*- 'v\*'/)
    assert.match(workflow, /prerelease: \$\{\{ contains\(github\.ref_name, '-'\) \}\}/)
  })

  it('includes the web archive in checksums and provenance', () => {
    const archiveAt = workflow.indexOf('git archive --format=zip')
    const checksumAt = workflow.indexOf('generate-release-checksums.mjs')
    const attestationAt = workflow.indexOf('actions/attest-build-provenance')
    assert.ok(archiveAt > 0)
    assert.ok(checksumAt > archiveAt)
    assert.ok(attestationAt > checksumAt)
    assert.match(workflow, /subject-path: release-assets\/\*\*/)
  })
})
