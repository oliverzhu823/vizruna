import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  isOfficialVizrunaRemote,
  repositoryFromRemote,
} from '../update-vizruna-web-source.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

describe('Vizruna-web source updater', () => {
  it('accepts only the official GitHub repository', () => {
    assert.equal(isOfficialVizrunaRemote('https://github.com/oliverzhu823/vizruna.git'), true)
    assert.equal(isOfficialVizrunaRemote('git@github.com:oliverzhu823/vizruna.git'), true)
    assert.equal(isOfficialVizrunaRemote('ssh://git@github.com/oliverzhu823/vizruna'), true)
    assert.equal(isOfficialVizrunaRemote('https://github.com/attacker/vizruna.git'), false)
    assert.equal(isOfficialVizrunaRemote('https://evil.example/oliverzhu823/vizruna.git'), false)
    assert.equal(repositoryFromRemote('file:///tmp/vizruna'), null)
  })

  it('launcher invokes updater before dependency installation and build', () => {
    const launcher = readFileSync(join(root, 'Start-Vizruna-web.command'), 'utf8')
    const updateAt = launcher.indexOf('update-vizruna-web-source.mjs')
    const installAt = launcher.indexOf('npm ci')
    const buildAt = launcher.indexOf('npm run build:web')
    const dependencyBlockEnd = launcher.indexOf('\nfi', installAt)
    assert.ok(updateAt > 0)
    assert.ok(updateAt < installAt)
    assert.ok(updateAt < buildAt)
    assert.ok(dependencyBlockEnd > installAt)
    assert.ok(dependencyBlockEnd < buildAt, 'a clean install must still build before startup')
    assert.match(launcher, /VIZRUNA_WEB_SKIP_UPDATE/)
    assert.match(launcher, /mktemp "\$\{TMPDIR:-\/tmp\}\/vizruna-web-startup/)
    assert.match(launcher, /npm ci --no-audit --no-fund/)
    assert.match(launcher, /tail -n 120 "\$STARTUP_LOG"/)
  })

  it('updater requires a clean main branch and fast-forward merge', () => {
    const source = readFileSync(join(root, 'scripts/update-vizruna-web-source.mjs'), 'utf8')
    assert.match(source, /branch.*--show-current/)
    assert.match(source, /status.*--porcelain/)
    assert.match(source, /merge-base.*--is-ancestor/)
    assert.match(source, /merge.*--ff-only/)
  })
})
