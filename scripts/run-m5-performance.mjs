#!/usr/bin/env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import os from 'node:os'
import path from 'node:path'
import { performance } from 'node:perf_hooks'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { _electron as electron } from '@playwright/test'

const require = createRequire(import.meta.url)
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainEntry = path.join(root, 'out/main/index.js')
const baselineEvidencePath = path.join(
  root,
  'docs',
  'startup',
  'evidence',
  'm0-upstream-performance.json',
)
const electronExecutable = require('electron')
const runCountArg = process.argv.find((value) => value.startsWith('--runs='))
const runCount = Number(runCountArg?.slice('--runs='.length) || 20)
if (!Number.isInteger(runCount) || runCount < 5 || runCount > 100) {
  throw new Error('--runs must be an integer between 5 and 100')
}
if (!existsSync(mainEntry)) {
  throw new Error('Production build missing; run npm run build first')
}
if (!existsSync(baselineEvidencePath)) {
  throw new Error(`M0 performance baseline missing: ${baselineEvidencePath}`)
}

const baselineEvidence = JSON.parse(readFileSync(baselineEvidencePath, 'utf8'))
const baselineIdleP95MiB = Number(
  baselineEvidence?.measurements?.idleProcessWorkingSetMiB?.p95,
)
if (!Number.isFinite(baselineIdleP95MiB) || baselineIdleP95MiB <= 0) {
  throw new Error('M0 performance baseline has no valid idle-memory P95')
}
const idleProcessWorkingSetMaxGrowthPercent = 20
const idleProcessWorkingSetP95LimitMiB =
  Math.round(
    baselineIdleP95MiB *
      (1 + idleProcessWorkingSetMaxGrowthPercent / 100) *
      100,
  ) / 100

const thresholds = {
  coldStartP95Ms: 5_000,
  workspaceSessionListP95Ms: 2_000,
  sessionSwitchP95Ms: 1_000,
  composerRenderP95Ms: 100,
  mainToUiEventP95Ms: 500,
  cancelSignalP95Ms: 1_000,
  idleProcessWorkingSetBaselineP95MiB: baselineIdleP95MiB,
  idleProcessWorkingSetMaxGrowthPercent,
  idleProcessWorkingSetP95LimitMiB,
}

function percentile(values, percentileValue) {
  const sorted = [...values].sort((left, right) => left - right)
  return sorted[Math.max(0, Math.ceil((percentileValue / 100) * sorted.length) - 1)]
}

function summary(values) {
  const measured = valueSummary(values)
  return {
    samples: measured.samples,
    minMs: measured.min,
    medianMs: measured.median,
    p95Ms: measured.p95,
    maxMs: measured.max,
  }
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

function launchEnvironment(userData) {
  return {
    ...process.env,
    PI_E2E: '1',
    PI_E2E_USER_DATA: userData,
    PI_CODING_AGENT_DIR: path.join(userData, 'pi-agent'),
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    ELECTRON_NO_ATTACH_CONSOLE: '1',
  }
}

async function launch(userData) {
  return electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    env: launchEnvironment(userData),
    timeout: 60_000,
  })
}

function createPerformanceSessions(agentDirectory, workspace) {
  const resolvedWorkspace = path.resolve(workspace)
  const encodedWorkspace = `--${resolvedWorkspace
    .replace(/^[/\\]/, '')
    .replace(/[/\\:]/g, '-')}--`
  const sessionDirectory = path.join(
    agentDirectory,
    'sessions',
    encodedWorkspace,
  )
  mkdirSync(sessionDirectory, { recursive: true })
  const capturedAt = Date.now()
  return ['A', 'B'].map((suffix, index) => {
    const id = `performance-session-${suffix.toLowerCase()}`
    const title = `Performance Session ${suffix}`
    const timestamp = capturedAt + index
    const entries = [
      {
        type: 'session',
        version: 3,
        id,
        timestamp: new Date(timestamp).toISOString(),
        cwd: resolvedWorkspace,
      },
      {
        type: 'message',
        id: `message-${suffix.toLowerCase()}`,
        parentId: null,
        timestamp: new Date(timestamp).toISOString(),
        message: {
          role: 'user',
          content: title,
          timestamp,
        },
      },
    ]
    writeFileSync(
      path.join(sessionDirectory, `${id}.jsonl`),
      `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`,
    )
    return title
  })
}

const temporaryRoot = mkdtempSync(path.join(tmpdir(), 'pi-enterprise-m5-performance-'))
const coldStarts = []
const coldIdleWorkingSetsMiB = []
let benchmarkApp

try {
  for (let index = 0; index < runCount; index += 1) {
    const started = performance.now()
    const app = await launch(path.join(temporaryRoot, `cold-${index}`))
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
      coldIdleWorkingSetsMiB.push(
        metrics.reduce(
          (total, metric) => total + metric.memory.workingSetSize,
          0,
        ) / 1024,
      )
    } finally {
      await app.close()
    }
  }

  benchmarkApp = await launch(path.join(temporaryRoot, 'interactive'))
  const window = await benchmarkApp.firstWindow({ timeout: 45_000 })
  await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
  const workspaceLoads = []
  for (let index = 0; index < runCount; index += 1) {
    const workspace = path.join(temporaryRoot, `workspace-${String(index).padStart(3, '0')}`)
    mkdirSync(workspace)
    await benchmarkApp.evaluate(
      ({ dialog }, selectedPath) => {
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [selectedPath],
        })
      },
      workspace,
    )
    const started = performance.now()
    await window.getByRole('button', { name: /打开文件夹|Open Folder/i }).click()
    await window.getByText(path.basename(workspace), { exact: true }).first().waitFor({
      state: 'visible',
      timeout: 30_000,
    })
    await window.locator('[contenteditable="true"]').first().waitFor({
      state: 'visible',
      timeout: 30_000,
    })
    workspaceLoads.push(performance.now() - started)
  }

  const composerRenders = await window.evaluate(async (samples) => {
    const editor = document.querySelector('[contenteditable="true"]')
    if (!(editor instanceof HTMLElement)) throw new Error('Composer editor not found')
    const shell = editor.closest('.composer-shell')
    if (!(shell instanceof HTMLElement)) throw new Error('Composer shell not found')

    const waitForSendButton = (present) =>
      new Promise((resolve, reject) => {
        const matches = () => !!shell.querySelector('button.composer-send') === present
        if (matches()) {
          resolve(undefined)
          return
        }
        const timeout = window.setTimeout(() => {
          observer.disconnect()
          reject(new Error('Composer render observation timed out'))
        }, 2_000)
        const observer = new MutationObserver(() => {
          if (!matches()) return
          window.clearTimeout(timeout)
          observer.disconnect()
          resolve(undefined)
        })
        observer.observe(shell, { childList: true, subtree: true, attributes: true })
      })

    const timings = []
    for (let index = 0; index < samples; index += 1) {
      editor.textContent = ''
      editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContent' }))
      await waitForSendButton(false)
      const started = performance.now()
      editor.textContent = `benchmark-${index}`
      editor.dispatchEvent(
        new InputEvent('input', {
          bubbles: true,
          data: String(index),
          inputType: 'insertText',
        }),
      )
      await waitForSendButton(true)
      timings.push(performance.now() - started)
    }
    return timings
  }, Math.max(50, runCount * 5))

  const idleProcessMetrics = await benchmarkApp.evaluate(({ app }) =>
    app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      workingSetSizeKiB: metric.memory.workingSetSize,
    })),
  )
  const idleWorkingSetMiB =
    idleProcessMetrics.reduce(
      (total, metric) => total + metric.workingSetSizeKiB,
      0,
    ) / 1024

  const activeWorkspace = path.join(
    temporaryRoot,
    `workspace-${String(runCount - 1).padStart(3, '0')}`,
  )
  await window.evaluate(
    (workspacePath) =>
      window.piDesktop?.invoke('ipc:workspace.ensureWorker', {
        path: workspacePath,
      }),
    activeWorkspace,
  )
  const eventLatencies = await window.evaluate(async (samples) => {
    if (!window.piDesktop) throw new Error('Preload API unavailable')
    const timings = []
    document.documentElement.dataset.piMeasureAppPaint = 'true'
    try {
      for (let index = 0; index < samples; index += 1) {
        const level = index % 2 === 0 ? 'high' : 'medium'
        const started = performance.now()
        const startedWallClock = Date.now()
        await new Promise((resolve, reject) => {
          const timeout = window.setTimeout(() => {
            window.removeEventListener(
              'pi-enterprise-desktop:app-event-painted',
              onPainted,
            )
            reject(new Error('Main-to-UI paint observation timed out'))
          }, 2_000)
          const onPainted = (rawEvent) => {
            const detail = rawEvent.detail
            if (
              detail?.type !== 'run' ||
              detail?.phase !== 'state' ||
              Number(detail?.timestamp || 0) < startedWallClock
            ) {
              return
            }
            window.clearTimeout(timeout)
            window.removeEventListener(
              'pi-enterprise-desktop:app-event-painted',
              onPainted,
            )
            resolve(undefined)
          }
          window.addEventListener(
            'pi-enterprise-desktop:app-event-painted',
            onPainted,
          )
          window.piDesktop
            .invoke('ipc:thinkingLevel.set', { sessionId: '', level })
            .catch((error) => {
              window.clearTimeout(timeout)
              window.removeEventListener(
                'pi-enterprise-desktop:app-event-painted',
                onPainted,
              )
              reject(error)
            })
        })
        timings.push(performance.now() - started)
      }
    } finally {
      delete document.documentElement.dataset.piMeasureAppPaint
    }
    return timings
  }, Math.max(20, runCount))

  const cancelLatencies = await window.evaluate(async (samples) => {
    if (!window.piDesktop) throw new Error('Preload API unavailable')
    const timings = []
    for (let index = 0; index < samples; index += 1) {
      const started = performance.now()
      await window.piDesktop.invoke('ipc:prompt.abort', {})
      timings.push(performance.now() - started)
    }
    return timings
  }, Math.max(20, runCount))

  const sessionTitles = createPerformanceSessions(
    path.join(temporaryRoot, 'interactive', 'pi-agent'),
    activeWorkspace,
  )
  const listedSessions = await window.evaluate(async (workspaceId) => {
    if (!window.piDesktop) throw new Error('Preload API unavailable')
    const response = await window.piDesktop.invoke('ipc:session.list', {
      workspaceId,
    })
    return response.sessions || []
  }, activeWorkspace)
  if (listedSessions.length !== sessionTitles.length) {
    throw new Error(
      `Expected ${sessionTitles.length} performance sessions, received ${listedSessions.length}: ${JSON.stringify(listedSessions)}`,
    )
  }
  await window.getByRole('button', { name: /打开文件夹|Open Folder/i }).click()
  const sessionRows = sessionTitles.map((title) =>
    window.locator('.sidebar-session-row').filter({ hasText: title }),
  )
  await Promise.all(
    sessionRows.map((row) => row.waitFor({ state: 'visible', timeout: 10_000 })),
  )
  const sessionSwitches = []
  for (let index = 0; index < Math.max(20, runCount); index += 1) {
    const targetIndex = index % sessionTitles.length
    const started = performance.now()
    await sessionRows[targetIndex].click()
    await window
      .locator('.timeline-scroll-viewport .timeline-user-bubble')
      .filter({ hasText: sessionTitles[targetIndex] })
      .waitFor({ state: 'visible', timeout: 5_000 })
    sessionSwitches.push(performance.now() - started)
  }

  await window.waitForTimeout(1_000)
  const oneWorkerProcessMetrics = await benchmarkApp.evaluate(({ app }) =>
    app.getAppMetrics().map((metric) => ({
      type: metric.type,
      pid: metric.pid,
      workingSetSizeKiB: metric.memory.workingSetSize,
    })),
  )
  const oneWorkerWorkingSetMiB =
    oneWorkerProcessMetrics.reduce(
      (total, metric) => total + metric.workingSetSizeKiB,
      0,
    ) / 1024

  const result = {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    environment: {
      platform: process.platform,
      arch: process.arch,
      node: process.version,
      electron: process.versions.electron,
      cpu: os.cpus()[0]?.model,
      logicalCpuCount: os.cpus().length,
      totalMemoryGiB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      runCount,
      mode: 'production build with isolated PI_E2E user data',
    },
    baseline: {
      evidencePath: path.relative(root, baselineEvidencePath),
      sourceRepository: baselineEvidence?.source?.repository,
      sourceCommit: baselineEvidence?.source?.commit,
      capturedAt: baselineEvidence?.capturedAt,
    },
    thresholds,
    measurements: {
      coldStart: summary(coldStarts),
      workspaceSessionList: summary(workspaceLoads),
      sessionSwitch: summary(sessionSwitches),
      composerRender: summary(composerRenders),
      mainToUiEvent: summary(eventLatencies),
      cancelSignal: summary(cancelLatencies),
      coldIdleProcessWorkingSetMiB: valueSummary(coldIdleWorkingSetsMiB),
      interactiveIdleProcessWorkingSetMiB:
        Math.round(idleWorkingSetMiB * 10) / 10,
      idleProcessMetrics,
      oneWorkerProcessWorkingSetMiB:
        Math.round(oneWorkerWorkingSetMiB * 10) / 10,
      oneWorkerProcessMetrics,
    },
  }
  const outputDir = path.join(root, 'dist', 'performance')
  mkdirSync(outputDir, { recursive: true })
  const outputPath = path.join(outputDir, 'm5-performance.json')
  writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`)
  console.log(JSON.stringify(result, null, 2))
  console.log(`[m5-performance] evidence: ${outputPath}`)

  const failures = []
  if (result.measurements.coldStart.p95Ms > thresholds.coldStartP95Ms) {
    failures.push('cold start P95')
  }
  if (
    result.measurements.workspaceSessionList.p95Ms >
    thresholds.workspaceSessionListP95Ms
  ) {
    failures.push('workspace/session list P95')
  }
  if (result.measurements.sessionSwitch.p95Ms > thresholds.sessionSwitchP95Ms) {
    failures.push('session switch P95')
  }
  if (result.measurements.composerRender.p95Ms > thresholds.composerRenderP95Ms) {
    failures.push('composer render P95')
  }
  if (
    result.measurements.mainToUiEvent.p95Ms >
    thresholds.mainToUiEventP95Ms
  ) {
    failures.push('Main-to-UI event P95')
  }
  if (result.measurements.cancelSignal.p95Ms > thresholds.cancelSignalP95Ms) {
    failures.push('cancel signal P95')
  }
  if (
    result.measurements.coldIdleProcessWorkingSetMiB.p95 >
    thresholds.idleProcessWorkingSetP95LimitMiB
  ) {
    failures.push('cold idle process working-set P95')
  }
  if (failures.length > 0) {
    throw new Error(`Performance thresholds exceeded: ${failures.join(', ')}`)
  }
} finally {
  if (benchmarkApp) await benchmarkApp.close().catch(() => undefined)
  rmSync(temporaryRoot, { recursive: true, force: true })
}
