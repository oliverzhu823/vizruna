import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainEntry = path.join(root, 'out/main/index.js')

const baseEnv = {
  ...process.env,
  PI_E2E: '1',
  ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  ELECTRON_NO_ATTACH_CONSOLE: '1',
}

test.describe('composer', () => {
  test('input area is focusable when present', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const textarea = window.locator('textarea, [contenteditable="true"]').first()
      const count = await textarea.count()
      if (count > 0) {
        await textarea.focus()
        expect(await textarea.evaluate((el) => document.activeElement === el)).toBeTruthy()
      } else {
        expect(await window.title()).toBeTruthy()
      }
    } finally {
      await app.close()
    }
  })

  test('development runtime has an isolated visible identity', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const identity = await app.evaluate(({ app, BrowserWindow }) => ({
        appName: app.getName(),
        nativeWindowTitle: BrowserWindow.getAllWindows()[0]?.getTitle(),
        userDataPath: app.getPath('userData'),
        piAgentDirectory: process.env.PI_CODING_AGENT_DIR,
        runtimeChannel: process.env.VIZRUNA_RUNTIME_CHANNEL,
      }))
      expect(identity.appName).toBe('Vizruna Dev')
      expect(identity.nativeWindowTitle).toBe('Vizruna Dev')
      expect(identity.runtimeChannel).toBe('development')
      expect(identity.userDataPath).toMatch(/Vizruna Dev-e2e-\d+$/)
      expect(identity.piAgentDirectory).toBe(
        path.join(identity.userDataPath, 'pi-agent'),
      )
    } finally {
      await app.close()
    }
  })

  test('body element exists in renderer', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      expect(await window.locator('body').count()).toBe(1)
    } finally {
      await app.close()
    }
  })
})
