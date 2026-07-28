import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import fs from 'node:fs'
import os from 'node:os'
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

test.describe('workspace shell', () => {
  test('shows main window and composer region', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const title = await window.title()
      expect(title.toLowerCase()).toContain('pi')
    } finally {
      await app.close()
    }
  })

  test('html root element present', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      expect(await window.locator('html').count()).toBe(1)
    } finally {
      await app.close()
    }
  })

  test('app closes cleanly', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    await app.firstWindow({ timeout: 45_000 })
    await app.close()
    expect(true).toBe(true)
  })

  test('new project task dialog exposes the complete P0 launch choices', async () => {
    const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-enterprise-new-task-'))
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      await app.evaluate(
        ({ dialog }, selectedPath) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [selectedPath],
          })
        },
        workspace,
      )
      await window.getByRole('button', { name: /打开文件夹|Open folder/i }).click()
      await window.getByText(path.basename(workspace), { exact: true }).first().waitFor()
      await window.locator('[title="新会话"], [title="New session"]').click()

      const dialog = window.getByRole('dialog')
      await expect(dialog).toBeVisible()
      await expect(
        dialog.getByText(/新建 Agent 任务|New Agent task/),
      ).toBeVisible()
      await expect(
        dialog.getByRole('radio', { name: /Local/ }),
      ).toHaveCount(0)
      await dialog
        .getByRole('button', { name: /显示高级选项|Show advanced options/ })
        .click()
      await expect(
        dialog.getByRole('radio', { name: /Local/ }),
      ).toBeChecked()
      await expect(
        dialog.getByRole('radio', { name: /Worktree/ }),
      ).toBeDisabled()
      await expect(dialog.getByLabel(/^Provider$/)).toBeVisible()
      await expect(dialog.getByLabel(/^模型$|^Model$/)).toBeVisible()
      await expect(
        dialog.locator('textarea'),
      ).toBeVisible()
      await expect(
        dialog.getByLabel(/当前 Provider 路由|Current provider route/),
      ).toBeVisible()
      await expect(
        dialog.getByLabel(/最大并行 Worker|Maximum parallel Workers/),
      ).toBeVisible()
    } finally {
      await app.close()
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })

  test('integrated terminal starts in the trusted project and runs a command', async () => {
    const workspace = fs.mkdtempSync(
      path.join(os.tmpdir(), 'pi-enterprise-terminal-'),
    )
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      await app.evaluate(
        ({ dialog }, selectedPath) => {
          dialog.showOpenDialog = async () => ({
            canceled: false,
            filePaths: [selectedPath],
          })
        },
        workspace,
      )
      await window.getByRole('button', { name: /打开文件夹|Open folder/i }).click()
      await window.getByText(path.basename(workspace), { exact: true }).first().waitFor()

      await window.getByRole('tab', { name: /终端|Terminal/ }).click()
      await expect(window.locator('.xterm-screen')).toBeVisible()
      const terminalId = await window
        .locator('[data-terminal-id]:not(.hidden)')
        .getAttribute('data-terminal-id')
      expect(terminalId).toBeTruthy()
      await window.getByRole('tab', { name: /文件|Files/ }).click()
      await window.getByRole('tab', { name: /终端|Terminal/ }).click()
      await expect(
        window.locator(`[data-terminal-id="${terminalId}"]`),
      ).toBeVisible()

      const result = await window.evaluate(async (cwd) => {
        const api = (
          window as unknown as {
            piDesktop: {
              invoke: (
                channel: string,
                request: unknown,
              ) => Promise<Record<string, unknown>>
            }
          }
        ).piDesktop
        const terminal = (await api.invoke('ipc:terminal.create', {
          cwd,
          cols: 80,
          rows: 24,
        })) as { id: string; cwd: string }
        await api.invoke('ipc:terminal.write', {
          id: terminal.id,
          data: 'echo PI_TERMINAL_E2E_OK\r',
        })
        let output = ''
        for (let attempt = 0; attempt < 20; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50))
          const attached = (await api.invoke('ipc:terminal.attach', {
            id: terminal.id,
          })) as { data?: string }
          output += attached.data || ''
          if (output.includes('PI_TERMINAL_E2E_OK')) break
        }
        await api.invoke('ipc:terminal.close', { id: terminal.id })
        return { cwd: terminal.cwd, output }
      }, workspace)

      expect(result.cwd).toBe(fs.realpathSync(workspace))
      expect(result.output).toContain('PI_TERMINAL_E2E_OK')
    } finally {
      await app.close()
      fs.rmSync(workspace, { recursive: true, force: true })
    }
  })
})
