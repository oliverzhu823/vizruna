import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()

test('the public CLI owns the stable runtime command surface', () => {
  const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  const cli = readFileSync(join(root, 'src/runtime/cli.ts'), 'utf8')
  assert.equal(manifest.bin.vizruna, 'scripts/vizruna.mjs')
  for (const command of ['doctor', 'runtime', 'agent', 'run', 'status', 'stop', 'evidence', 'evaluation']) {
    assert.match(cli, new RegExp(`['\"\x60]${command}['\"\x60]`))
  }
  assert.doesNotMatch(cli, /print\(\{ ok: true, \.\.\.state \}\)/, 'runtime start must not print its bearer token')
  assert.doesNotMatch(cli, /print\(\{ running: await healthy\(state\), state \}\)/, 'runtime status must not print its bearer token')
})

test('the local launcher and zero-argument CLI start the pure Node web host', () => {
  const launcher = readFileSync(join(root, 'Start-Vizruna-web.command'), 'utf8')
  const wrapper = readFileSync(join(root, 'scripts/vizruna.mjs'), 'utf8')
  const cli = readFileSync(join(root, 'src/runtime/cli.ts'), 'utf8')
  const webWrapper = readFileSync(join(root, 'scripts/vizruna-node-web.mjs'), 'utf8')
  assert.match(launcher, /node scripts\/vizruna\.mjs web/)
  assert.match(wrapper, /out.*main.*cli\.js/s)
  assert.match(wrapper, /child\.kill\(signal\)/)
  assert.match(cli, /args\.shift\(\) \|\| 'web'/)
  assert.match(cli, /vizruna-node-web\.mjs/)
  assert.match(webWrapper, /out.*node-web.*server\.mjs/s)
  assert.doesNotMatch(webWrapper, /electron/)
})

test('the npm distribution contains prebuilt web assets and compliance notices', () => {
  const prepare = readFileSync(join(root, 'scripts/prepare-npm-package.mjs'), 'utf8')
  const packageTest = readFileSync(join(root, 'scripts/test-npm-package.mjs'), 'utf8')
  for (const artifact of ['node-web', 'renderer', 'main']) assert.match(prepare, new RegExp(`['\"]${artifact}['\"]`))
  assert.match(prepare, /NOTICE\.md/)
  assert.match(prepare, /THIRD_PARTY_LICENSES/)
  assert.match(packageTest, /authentication_required|status !== 401/)
  assert.match(packageTest, /healthBody\.product !== 'Vizruna-web'/)
})

test('RPC v1 keeps loopback, authentication, CSRF, and resumable-event guards', () => {
  const server = readFileSync(join(root, 'src/runtime/rpc-server.ts'), 'utf8')
  assert.match(server, /127\.0\.0\.1/)
  assert.match(server, /Bearer /)
  assert.match(server, /x-vizruna-requested-with/)
  assert.match(server, /last-event-id/)
  assert.match(server, /VIZRUNA_RUNTIME_RPC_VERSION/)
})
