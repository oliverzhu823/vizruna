import { expect, test } from '@playwright/test'

test('rejects unauthenticated and cross-origin API requests', async ({ request }) => {
  const health = await request.get('/api/health')
  expect(health.status()).toBe(401)

  const crossOrigin = await request.post('/api/auth', {
    headers: { Origin: 'https://evil.example' },
    data: { token: 'vizruna-web-e2e-token' },
  })
  expect(crossOrigin.status()).toBe(403)
})

test('authenticates, renders Vizruna-web, and uses the shared RPC contract', async ({ page }) => {
  await page.goto('/?e2e=1#token=vizruna-web-e2e-token')
  await expect(page).toHaveTitle('Vizruna-web')
  await expect(page.getByText('Vizruna-web', { exact: true })).toBeVisible()
  const openFolder = page.getByRole('button', { name: /打开文件夹|Open folder/ })
  await expect(openFolder).toBeVisible()

  await openFolder.click()
  const pathDialog = page.getByRole('dialog', { name: /在 Vizruna-web 中打开项目|Open a project in Vizruna-web/ })
  await expect(pathDialog).toBeVisible()
  const pathInput = pathDialog.getByRole('textbox')
  await pathInput.fill('/vizruna-web-e2e/does-not-exist')
  await pathDialog.getByRole('button', { name: /打开项目|Open project/ }).click()
  await expect(
    pathDialog.getByText(/无法打开该文件夹|This folder could not be opened/),
  ).toBeVisible()
  await pathInput.fill(process.cwd())
  await pathDialog.getByRole('button', { name: /打开项目|Open project/ }).click()
  await expect(pathDialog).toHaveCount(0)

  const health = await page.evaluate(async () => {
    const response = await fetch('/api/health')
    return { status: response.status, body: await response.json() }
  })
  expect(health.status).toBe(200)
  expect(health.body).toMatchObject({ ok: true, product: 'Vizruna-web', runtime: 'web' })

  const mediaRuntime = await page.evaluate(() => ({
    secureContext: window.isSecureContext,
    mediaDevices: typeof navigator.mediaDevices?.getUserMedia === 'function',
    mediaRecorder: typeof MediaRecorder === 'function',
  }))
  expect(mediaRuntime).toEqual({
    secureContext: true,
    mediaDevices: true,
    mediaRecorder: true,
  })

  const settings = await page.evaluate(async () => {
    const response = await fetch('/api/rpc', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Vizruna-Requested-With': 'Vizruna-web',
      },
      body: JSON.stringify({ channel: 'ipc:settings.get', request: { key: 'theme' } }),
    })
    return { status: response.status, body: await response.json() }
  })
  expect(settings.status).toBe(200)
  expect(settings.body).toMatchObject({ ok: true, result: { settings: { theme: 'system' } } })

  const invoke = async (channel: string, request: unknown = {}) => page.evaluate(
    async ({ rpcChannel, rpcRequest }) => {
      const response = await fetch('/api/rpc', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Vizruna-Requested-With': 'Vizruna-web',
        },
        body: JSON.stringify({ channel: rpcChannel, request: rpcRequest }),
      })
      return { status: response.status, body: await response.json() }
    },
    { rpcChannel: channel, rpcRequest: request },
  )

  const workspacePath = process.cwd()
  const capabilities = [
    await invoke('ipc:workspace.open', { path: workspacePath, awaitWorker: false }),
    await invoke('ipc:review.getDiff', { scope: 'git' }),
    await invoke('ipc:worktree.capability', { rootWorkspacePath: workspacePath }),
    await invoke('ipc:orchestration.list', { rootWorkspacePath: workspacePath }),
    await invoke('ipc:reliability.snapshot', { rootWorkspacePath: workspacePath }),
    await invoke('ipc:diagnostics.preview', { rootWorkspacePath: workspacePath }),
    await invoke('ipc:audit.export', { query: { limit: 10 }, format: 'json' }),
    await invoke('ipc:diagnostics.export', { rootWorkspacePath: workspacePath }),
    await invoke('ipc:asr.builtinStatus'),
    await invoke('ipc:providerAuth.list'),
  ]
  for (const capability of capabilities) {
    expect(capability.status, JSON.stringify(capability.body)).toBe(200)
    expect(capability.body).toMatchObject({ ok: true })
  }
  const webExports = capabilities.slice(6, 8)
  for (const exported of webExports) {
    expect(exported.body.result.download.filename).toBeTruthy()
    expect(exported.body.result.download.base64.length).toBeGreaterThan(20)
  }

  await page.getByRole('button', { name: /^(设置|Settings)$/ }).click()
  await expect(
    page.getByText(/Vizruna-web 通过启动包更新|Vizruna-web updates through its launcher package/),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /检查更新|Check for updates/ })).toHaveCount(0)
})

test('allows the startup token to be exchanged only once', async ({ request }) => {
  const repeated = await request.post('/api/auth', {
    data: { token: 'vizruna-web-e2e-token' },
  })
  expect(repeated.status()).toBe(401)
})
