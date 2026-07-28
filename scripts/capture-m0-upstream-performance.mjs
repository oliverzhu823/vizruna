#!/usr/bin/env node
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import os, { tmpdir } from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const appRootArg = process.argv.find((value) => value.startsWith('--app-root='))
const outputArg = process.argv.find((value) => value.startsWith('--output='))
const commitArg = process.argv.find((value) => value.startsWith('--commit='))
const runsArg = process.argv.find((value) => value.startsWith('--runs='))
const appRoot = path.resolve(appRootArg?.slice('--app-root='.length) || '')
const outputPath = path.resolve(
  outputArg?.slice('--output='.length) ||
    path.join(root, 'dist', 'performance', 'm0-upstream-baseline.json'),
)
const commit = commitArg?.slice('--commit='.length) || 'unknown'
const runCount = Number(runsArg?.slice('--runs='.length) || 20)

if (!appRootArg || !existsSync(path.join(appRoot, 'package.json'))) {
  throw new Error('--app-root must point to a prepared upstream checkout')
}
if (!Number.isInteger(runCount) || runCount < 5 || runCount > 100) {
  throw new Error('--runs must be an integer between 5 and 100')
}

const mainEntry = path.join(appRoot, 'out', 'main', 'index.js')
if (!existsSync(mainEntry)) {
  throw new Error(`Upstream production build missing: ${mainEntry}`)
}
const appRequire = createRequire(path.join(appRoot, 'package.json'))
const electronExecutable = appRequire('electron')

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)]
}

function valueSummary(values) {
  return {
    samples: values.length,
    min: Math.round(Math.min(...values) * 100) / 100,
    median: Math.round(percentile(values, 50) * 100) / 100,
    p95: Math.round(percentile(values, 95) * 100) / 100,
    max: Math.round(Math.max(...values) * 100) / 100,
  }
}

const temporaryRoot = mkdtempSync(
  path.join(tmpdir(), 'pi-enterprise-m0-upstream-performance-'),
)
const coldStarts = []
const idleWorkingSetsMiB = []

try {
  for (let index = 0; index < runCount; index += 1) {
    const isolatedRoot = path.join(temporaryRoot, `run-${index}`)
    const started = performance.now()
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry, `--user-data-dir=${path.join(isolatedRoot, 'user-data')}`],
      env: {
        ...process.env,
        PI_E2E: '1',
        PI_CODING_AGENT_DIR: path.join(isolatedRoot, 'pi-agent'),
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
        ELECTRON_NO_ATTACH_CONSOLE: '1',
      },
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      await window.getByRole('button', { name: /^(设置|Settings)$/ }).waitFor({
        state: 'visible',
        timeout: 45_000,
      })
      coldStarts.push(performance.now() - started)
      await window.waitForTimeout(250)
      const metrics = await app.evaluate(({ app }) => app.getAppMetrics())
      idleWorkingSetsMiB.push(
        metrics.reduce(
          (total, metric) => total + metric.memory.workingSetSize,
          0,
        ) / 1024,
      )
    } finally {
      await app.close()
    }
  }

  const result = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    source: {
      repository: 'https://github.com/justhil/pi-app.git',
      commit,
      appRoot,
    },
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      cpu: os.cpus()[0]?.model,
      logicalCpuCount: os.cpus().length,
      totalMemoryGiB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      runCount,
      mode: 'production build with isolated app and Pi data',
    },
    measurements: {
      coldStartMs: valueSummary(coldStarts),
      idleProcessWorkingSetMiB: valueSummary(idleWorkingSetsMiB),
    },
  }
  mkdirSync(path.dirname(outputPath), { recursive: true })
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
  console.log(`[m0-performance] evidence: ${outputPath}`)
} finally {
  rmSync(temporaryRoot, { recursive: true, force: true })
}
