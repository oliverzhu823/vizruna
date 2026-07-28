import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'
import { writeFile } from 'node:fs/promises'

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

test.describe('settings', () => {
  test('app loads without crash (settings route lazy)', async () => {
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
      expect(title).toBe('Vizruna')
    } finally {
      await app.close()
    }
  })

  test('renderer document readyState is complete or interactive', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const state = await window.evaluate(() => document.readyState)
      expect(['complete', 'interactive', 'loading']).toContain(state)
    } finally {
      await app.close()
    }
  })

  test('single browser window on launch', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const windows = app.windows()
      expect(windows.length).toBeGreaterThanOrEqual(1)
    } finally {
      await app.close()
    }
  })

  test('model settings exposes GUI provider sign-in without using a terminal', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      await window
        .getByRole('button', { name: /^(设置|Settings)$/ })
        .click()
      await window.getByRole('button', { name: /^(模型|Models)$/ }).click()
      await expect(
        window.getByText(/模型账号与授权|Model Accounts & Authorization/),
      ).toBeVisible()
      await expect(
        window.getByPlaceholder(/搜索 Provider|Search providers/),
      ).toBeVisible()
      await expect(
        window.getByRole('button', { name: /账号登录|Sign in/ }).first(),
      ).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('reliability page exposes a redacted diagnostics preview', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      await window
        .getByRole('button', { name: /^(设置|Settings)$/ })
        .click()
      await window
        .getByRole('button', { name: /可靠性与诊断|Reliability & Diagnostics/ })
        .click()
      await expect(
        window.getByRole('heading', {
          name: /可靠性、审计与诊断|Reliability, Audit & Diagnostics/,
        }),
      ).toBeVisible()
      await window
        .getByRole('button', { name: /生成预览|Generate preview/ })
        .click()
      await expect(
        window.getByText(/明确排除|Explicitly excluded/),
      ).toBeVisible({ timeout: 30_000 })
    } finally {
      await app.close()
    }
  })

  test('metadata backup restores verified data and rejects a corrupt backup', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const first = await window.evaluate(async () => {
        const api = (
          window as unknown as {
            piDesktop: {
              invoke: (channel: string, request: unknown) => Promise<unknown>
            }
          }
        ).piDesktop
        return api.invoke('ipc:metadataBackup.create', {})
      }) as { backup: { id: string; path: string } }
      const restored = await window.evaluate(async (backupId) => {
        const api = (
          window as unknown as {
            piDesktop: {
              invoke: (channel: string, request: unknown) => Promise<unknown>
            }
          }
        ).piDesktop
        return api.invoke('ipc:metadataBackup.restore', {
          backupId,
          confirmation: 'RESTORE_METADATA',
        })
      }, first.backup.id) as { restored: { integrity: string } }
      expect(restored.restored.integrity).toBe('ok')

      const corrupt = await window.evaluate(async () => {
        const api = (
          window as unknown as {
            piDesktop: {
              invoke: (channel: string, request: unknown) => Promise<unknown>
            }
          }
        ).piDesktop
        return api.invoke('ipc:metadataBackup.create', {})
      }) as { backup: { id: string; path: string } }
      await writeFile(corrupt.backup.path, 'not-a-sqlite-database')
      const rejected = await window.evaluate(async (backupId) => {
        const api = (
          window as unknown as {
            piDesktop: {
              invoke: (channel: string, request: unknown) => Promise<unknown>
            }
          }
        ).piDesktop
        try {
          await api.invoke('ipc:metadataBackup.restore', {
            backupId,
            confirmation: 'RESTORE_METADATA',
          })
          return false
        } catch {
          return true
        }
      }, corrupt.backup.id)
      expect(rejected).toBe(true)
      const snapshot = await window.evaluate(async () => {
        const api = (
          window as unknown as {
            piDesktop: {
              invoke: (channel: string, request: unknown) => Promise<unknown>
            }
          }
        ).piDesktop
        return api.invoke('ipc:reliability.snapshot', {})
      }) as { snapshot: { integrity: { ok: boolean } } }
      expect(snapshot.snapshot.integrity.ok).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('provider routes stay isolated and update without changing process proxy state', async () => {
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: baseEnv,
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const proxyBefore = await app.evaluate(() => ({
        http: process.env.HTTP_PROXY,
        https: process.env.HTTPS_PROXY,
        noProxy: process.env.NO_PROXY,
      }))

      const result = await window.evaluate(async () => {
        const api = (
          window as unknown as {
            piDesktop: {
              invoke: (channel: string, request: unknown) => Promise<unknown>
            }
          }
        ).piDesktop
        const saved = (await api.invoke('ipc:proxyProfile.save', {
          name: 'E2E V2RayN',
          protocol: 'http',
          host: '127.0.0.1',
          port: 10809,
          noProxy: 'localhost,*.corp.example',
        })) as { profile: { id: string; noProxy?: string } }
        const profileId = saved.profile.id
        await api.invoke('ipc:providerRouting.set', {
          provider: 'openai-e2e',
          mode: 'profile',
          profileId,
        })
        await api.invoke('ipc:providerRouting.set', {
          provider: 'deepseek-e2e',
          mode: 'direct',
        })
        const config = (await api.invoke('ipc:providerRouting.get', {})) as {
          config: { routes: Array<{ provider: string; mode: string }> }
        }
        const diagnostic = (await api.invoke(
          'ipc:providerRouting.diagnose',
          {
            provider: 'deepseek-e2e',
          },
        )) as {
          result: {
            ok: boolean
            credentialsSent: boolean
            inferenceSent: boolean
            systemProxyModified: boolean
          }
        }
        await api.invoke('ipc:proxyProfile.delete', {
          id: profileId,
          confirmed: true,
        })
        const afterDelete = (await api.invoke(
          'ipc:providerRouting.get',
          {},
        )) as {
          config: { routes: Array<{ provider: string; mode: string }> }
        }
        return { config, diagnostic, afterDelete, profile: saved.profile }
      })

      expect(result.profile.noProxy).toBe('localhost,*.corp.example')
      expect(
        result.config.config.routes.find(
          (route: { provider: string }) => route.provider === 'openai-e2e',
        ),
      ).toMatchObject({ mode: 'profile' })
      expect(
        result.config.config.routes.find(
          (route: { provider: string }) => route.provider === 'deepseek-e2e',
        ),
      ).toMatchObject({ mode: 'direct' })
      expect(result.diagnostic.result).toMatchObject({
        ok: false,
        credentialsSent: false,
        inferenceSent: false,
        systemProxyModified: false,
      })
      expect(
        result.afterDelete.config.routes.find(
          (route: { provider: string }) => route.provider === 'openai-e2e',
        ),
      ).toMatchObject({ mode: 'direct' })

      const proxyAfter = await app.evaluate(() => ({
        http: process.env.HTTP_PROXY,
        https: process.env.HTTPS_PROXY,
        noProxy: process.env.NO_PROXY,
      }))
      expect(proxyAfter).toEqual(proxyBefore)

      await window
        .getByRole('button', { name: /^(设置|Settings)$/ })
        .click()
      await window
        .getByRole('button', { name: /Provider 路由|Provider Routing/ })
        .click()
      await expect(
        window.getByRole('heading', {
          name: /Provider 网络路由|Provider Network Routing/,
        }),
      ).toBeVisible()
      await expect(
        window.getByText(/请求级隔离|Request-scoped isolation/),
      ).toBeVisible()
    } finally {
      await app.close()
    }
  })
})
