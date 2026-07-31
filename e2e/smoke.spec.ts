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
  // Linux CI: avoid dbus/session noise
  ELECTRON_NO_ATTACH_CONSOLE: '1',
}

async function launchApp(extraEnv: Record<string, string> = {}) {
  return electron.launch({
    executablePath: electronExecutable,
    args: [mainEntry],
    env: { ...baseEnv, ...extraEnv },
    timeout: 60_000,
  })
}

test.describe('Vizruna smoke', () => {
  test('launches built app and shows window', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const title = await window.title()
      expect(title).toBe('Vizruna')
    } finally {
      await app.close()
    }
  })

  test('window has document root after load', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const root = await window.evaluate(() => !!document.documentElement)
      expect(root).toBe(true)
    } finally {
      await app.close()
    }
  })

  test('launches with sandbox disabled via PI_RENDERER_SANDBOX=0', async () => {
    const app = await launchApp({ PI_RENDERER_SANDBOX: '0' })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      expect(await window.title()).toBeTruthy()
    } finally {
      await app.close()
    }
  })

  test('exposes the Agents orchestration panel without crashing the lazy route', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const agentsTab = window.getByRole('tab', { name: 'Agents' })
      await expect(agentsTab).toBeVisible()
      await agentsTab.click()
      await expect(
        window.getByText(/请先打开项目|Open a project first/),
      ).toBeVisible()
    } finally {
      await app.close()
    }
  })

  test('opens the Agent Case library and keeps creation disabled without a source conversation', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const casesEntry = window.getByRole('button', { name: /^(Agent Cases|Agent 案例)$/ })
      await expect(casesEntry).toBeVisible()
      await casesEntry.click()
      await expect(
        window.getByRole('heading', { name: /^(Agent Cases|Agent 案例)$/ }),
      ).toBeVisible()
      await expect(
        window.getByRole('button', {
          name: /^(Save current conversation|沉淀当前对话)$/,
        }),
      ).toBeDisabled()
    } finally {
      await app.close()
    }
  })

  test('keeps message chrome clear and uses the composer type scale', async () => {
    const app = await launchApp()
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const layout = await window.evaluate(() => {
        // The no-project smoke state intentionally has no chat column. Mount a
        // deterministic probe that uses the production classes instead of
        // depending on persisted user/project data.
        const host = document.createElement('div')
        host.className = 'main-chat-column relative'
        host.style.cssText =
          'position:fixed;left:0;top:0;width:800px;height:600px;overflow:hidden;visibility:hidden'
        document.body.appendChild(host)

        const controls = document.createElement('div')
        controls.className =
          'main-col-floating-controls absolute right-3 top-2 z-20 flex flex-col gap-1'
        controls.style.width = '28px'
        controls.style.height = '60px'
        host.appendChild(controls)
        const composerProbe = document.createElement('div')
        composerProbe.className = 'composer-shell'
        composerProbe.innerHTML =
          '<div class="rich-input"></div><span class="composer-meta-text"></span>'
        host.appendChild(composerProbe)
        const input = composerProbe.querySelector<HTMLElement>('.rich-input')!
        const meta = composerProbe.querySelector<HTMLElement>('.composer-meta-text')!

        const content = document.createElement('div')
        content.className = 'chat-content-column'
        content.style.position = 'absolute'
        content.style.inset = '0'
        content.style.pointerEvents = 'none'
        content.innerHTML =
          '<div class="timeline-user-row"><div class="message-hover-shell items-end"><div class="timeline-user-bubble">UI probe</div></div></div>'
        host.appendChild(content)

        const bubble = content.querySelector<HTMLElement>('.timeline-user-bubble')!
        const contentStyle = getComputedStyle(content)
        const result = {
          bodyFontSize: getComputedStyle(input).fontSize,
          metaFontSize: getComputedStyle(meta).fontSize,
          leftPadding: Number.parseFloat(contentStyle.paddingLeft),
          rightPadding: Number.parseFloat(contentStyle.paddingRight),
          bubbleRight: bubble.getBoundingClientRect().right,
          controlsLeft: controls.getBoundingClientRect().left,
        }
        host.remove()
        return result
      })

      expect(layout.bodyFontSize).toBe('15px')
      expect(layout.metaFontSize).toBe('12px')
      expect(layout.rightPadding - layout.leftPadding).toBeGreaterThanOrEqual(60)
      expect(layout.bubbleRight).toBeLessThanOrEqual(layout.controlsLeft - 8)
    } finally {
      await app.close()
    }
  })
})
