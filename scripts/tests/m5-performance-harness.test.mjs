import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync('scripts/run-m5-performance.mjs', 'utf8')

test('M5 performance harness enforces approved P95 thresholds', () => {
  assert.match(source, /coldStartP95Ms: 5_000/)
  assert.match(source, /workspaceSessionListP95Ms: 2_000/)
  assert.match(source, /sessionSwitchP95Ms: 1_000/)
  assert.match(source, /composerRenderP95Ms: 100/)
  assert.match(source, /mainToUiEventP95Ms: 500/)
  assert.match(source, /cancelSignalP95Ms: 1_000/)
  assert.match(source, /idleProcessWorkingSetMaxGrowthPercent = 20/)
  assert.match(source, /m0-upstream-performance\.json/)
  assert.match(source, /coldIdleProcessWorkingSetMiB\.p95/)
  assert.match(source, /idleProcessWorkingSetP95LimitMiB/)
  assert.match(source, /percentile\(values, 95\)/)
  assert.match(source, /throw new Error\(`Performance thresholds exceeded:/)
})

test('M5 performance harness uses isolated data and real production Electron', () => {
  assert.match(source, /out\/main\/index\.js/)
  assert.match(source, /PI_E2E_USER_DATA/)
  assert.match(source, /PI_CODING_AGENT_DIR/)
  assert.match(source, /getAppMetrics/)
  assert.match(source, /Performance Session/)
  assert.match(source, /app-event-painted/)
  assert.match(source, /timeline-user-bubble/)
  assert.match(source, /ipc:thinkingLevel\.set/)
  assert.match(source, /ipc:prompt\.abort/)
  assert.match(source, /m5-performance\.json/)
})
