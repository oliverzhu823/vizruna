import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('scripts/capture-m0-upstream-performance.mjs', 'utf8')

test('M0 upstream performance capture is isolated and records reproducible evidence', () => {
  assert.match(source, /--app-root=/)
  assert.match(source, /--user-data-dir=/)
  assert.match(source, /PI_CODING_AGENT_DIR/)
  assert.match(source, /getAppMetrics/)
  assert.match(source, /idleProcessWorkingSetMiB/)
  assert.match(source, /source:[\s\S]*repository:[\s\S]*commit/)
})
