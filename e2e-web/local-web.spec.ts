import { expect, test } from '@playwright/test'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'

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
  const workerStart = await invoke('ipc:workspace.ensureWorker', { path: workspacePath })
  expect(workerStart.status, JSON.stringify(workerStart.body)).toBe(200)
  expect(workerStart.body.result).toMatchObject({ ok: true, workspaceId: workspacePath })
  expect(workerStart.body.result.sessionId).toBeTruthy()
  const runtimeState = await invoke('ipc:runtime.getState', { workspaceId: workspacePath })
  expect(runtimeState.status, JSON.stringify(runtimeState.body)).toBe(200)
  expect(runtimeState.body.result.state).toMatchObject({ sessionId: workerStart.body.result.sessionId })

  const terminalCreate = await invoke('ipc:terminal.create', { cwd: workspacePath, cols: 80, rows: 24 })
  expect(terminalCreate.status, JSON.stringify(terminalCreate.body)).toBe(200)
  const terminalId = terminalCreate.body.result.id as string
  expect(terminalId).toBeTruthy()
  const terminalWrite = await invoke('ipc:terminal.write', { id: terminalId, data: 'printf vizruna-node-terminal\\n' })
  expect(terminalWrite.status, JSON.stringify(terminalWrite.body)).toBe(200)
  await page.waitForTimeout(100)
  const terminalAttach = await invoke('ipc:terminal.attach', { id: terminalId })
  expect(terminalAttach.status, JSON.stringify(terminalAttach.body)).toBe(200)
  expect(terminalAttach.body.result.data).toContain('vizruna-node-terminal')
  await invoke('ipc:terminal.close', { id: terminalId })
  const webExports = capabilities.slice(6, 8)
  for (const exported of webExports) {
    expect(exported.body.result.download.filename).toBeTruthy()
    expect(exported.body.result.download.base64.length).toBeGreaterThan(20)
  }

  const createdProfile = await invoke('ipc:agentProfile.create', {
    name: 'Web E2E version comparison Agent',
    systemPrompt: 'Return evidence before conclusions.',
    promptMode: 'append',
  })
  expect(createdProfile.status, JSON.stringify(createdProfile.body)).toBe(200)
  const profileId = createdProfile.body.result.profile.id as string
  const firstVersions = await invoke('ipc:agentVersion.list', { profileId })
  const version1 = firstVersions.body.result.versions[0]
  const updatedProfile = await invoke('ipc:agentProfile.update', {
    id: profileId,
    systemPrompt: 'Return verified evidence, risks, and then conclusions.',
  })
  expect(updatedProfile.status, JSON.stringify(updatedProfile.body)).toBe(200)
  const nextVersions = await invoke('ipc:agentVersion.list', { profileId })
  const version2 = nextVersions.body.result.versions[0]
  expect(version2.number).toBe(2)

  const incomingPath = join(workspacePath, '.vizruna', `e2e-import-${Date.now()}`)
  mkdirSync(join(incomingPath, 'extensions'), { recursive: true })
  const sourceProfile = {
    id: profileId,
    ...version2.config,
    status: 'active',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  writeFileSync(join(incomingPath, 'package.json'), JSON.stringify({
    name: '@vizruna/web-e2e-import', version: '0.2.0',
    pi: { extensions: ['./extensions/agent-profile.ts'] },
    vizruna: { profileId, versionId: version2.id },
  }))
  writeFileSync(join(incomingPath, 'README.md'), 'E2E package')
  writeFileSync(join(incomingPath, 'DELIVERY_CHECKLIST.md'), 'E2E checklist')
  writeFileSync(join(incomingPath, 'extensions', 'agent-profile.ts'), 'export default function () {}')
  writeFileSync(join(incomingPath, 'vizruna-agent.json'), JSON.stringify({
    schemaVersion: 1, sdkVersion: '0.84.1', profile: sourceProfile, version: version2,
    dependencies: { packages: [], resources: [] },
  }))
  const incomingRelativePath = relative(workspacePath, incomingPath)
  const importPreview = await invoke('ipc:pi.packageStudio.import.preview', {
    workspaceId: workspacePath,
    packagePath: incomingRelativePath,
  })
  expect(importPreview.status, JSON.stringify(importPreview.body)).toBe(200)
  expect(importPreview.body.result.plan).toMatchObject({
    artifactValid: true,
    identityStatus: 'new',
    localVersionStatus: 'candidate',
    credentialsIncluded: false,
  })
  const importApply = await invoke('ipc:pi.packageStudio.import.apply', {
    workspaceId: workspacePath,
    packagePath: incomingRelativePath,
    installAgentPackage: false,
    installDependencies: false,
    importConfiguration: true,
    confirmed: true,
  })
  expect(importApply.status, JSON.stringify(importApply.body)).toBe(200)
  expect(importApply.body.result).toMatchObject({
    ok: true,
    profile: { importProvenance: { sourceProfileId: profileId, sourceVersionId: version2.id } },
    version: { status: 'candidate', number: 1 },
  })
  expect(importApply.body.result.profile.id).not.toBe(profileId)

  const assetCatalogResponse = await invoke('ipc:agentAsset.list', { workspacePath })
  expect(assetCatalogResponse.status, JSON.stringify(assetCatalogResponse.body)).toBe(200)
  expect(assetCatalogResponse.body.result.catalog.assets).toEqual(expect.arrayContaining([
    expect.objectContaining({
      profileId,
      building: true,
      validated: false,
      delivered: false,
      package: { status: 'not-exported' },
    }),
  ]))

  const deliveryPreview = await invoke('ipc:pi.packageStudio.preview', {
    profileId,
    versionId: version2.id,
    workspaceId: workspacePath,
  })
  expect(deliveryPreview.status, JSON.stringify(deliveryPreview.body)).toBe(200)
  expect(deliveryPreview.body.result.plan).toMatchObject({
    installable: false,
    delivery: { status: 'blocked', credentialsIncluded: false },
  })
  expect(deliveryPreview.body.result.plan.files).toContain('DELIVERY_CHECKLIST.md')

  const baselineSuiteResponse = await invoke('ipc:agentEvaluation.suite.create', {
    name: 'Web E2E baseline',
    workspacePath,
    profileId,
    versionId: version1.id,
  })
  expect(baselineSuiteResponse.status, JSON.stringify(baselineSuiteResponse.body)).toBe(200)
  const baselineSuite = baselineSuiteResponse.body.result.suite
  const scenarioResponse = await invoke('ipc:agentEvaluation.scenario.create', {
    suiteId: baselineSuite.id,
    name: 'Evidence report',
    prompt: 'Prepare the evidence report.',
    expectedOutcome: 'Cites evidence and records risks.',
    tags: ['e2e'],
  })
  expect(scenarioResponse.status, JSON.stringify(scenarioResponse.body)).toBe(200)
  const clonedSuiteResponse = await invoke('ipc:agentEvaluation.suite.cloneVersion', {
    sourceSuiteId: baselineSuite.id,
    targetVersionId: version2.id,
    name: 'Web E2E candidate',
  })
  expect(clonedSuiteResponse.status, JSON.stringify(clonedSuiteResponse.body)).toBe(200)
  const clonedBundle = clonedSuiteResponse.body.result.bundle
  expect(clonedBundle.suite).toMatchObject({
    name: 'Web E2E candidate',
    versionId: version2.id,
    baselineSuiteId: baselineSuite.id,
  })
  expect(clonedBundle.scenarios).toHaveLength(1)
  expect(clonedBundle.scenarios[0]).toMatchObject({
    name: 'Evidence report',
    prompt: 'Prepare the evidence report.',
  })
  const comparisonResponse = await invoke('ipc:agentEvaluation.compare', {
    baselineSuiteId: baselineSuite.id,
    candidateSuiteId: clonedBundle.suite.id,
  })
  expect(comparisonResponse.status, JSON.stringify(comparisonResponse.body)).toBe(200)
  expect(comparisonResponse.body.result.comparison).toMatchObject({
    outcome: 'insufficient',
    baselineVersionId: version1.id,
    candidateVersionId: version2.id,
    counts: { insufficient: 1 },
  })

  const readinessResponse = await invoke('ipc:agentVersion.readiness', {
    versionId: version2.id,
    suiteId: clonedBundle.suite.id,
  })
  expect(readinessResponse.status, JSON.stringify(readinessResponse.body)).toBe(200)
  expect(readinessResponse.body.result.gate).toMatchObject({
    eligible: false,
    versionId: version2.id,
    suiteId: clonedBundle.suite.id,
    blockers: ['run-missing'],
    baselineRequired: false,
  })

  const reportResponse = await invoke('ipc:agentEvaluation.report.export', {
    baselineSuiteId: baselineSuite.id,
    candidateSuiteId: clonedBundle.suite.id,
    locale: 'en',
    includeContent: false,
  })
  expect(reportResponse.status, JSON.stringify(reportResponse.body)).toBe(200)
  expect(reportResponse.body.result).toMatchObject({ outcome: 'insufficient' })
  expect(reportResponse.body.result.download.filename).toMatch(/\.md$/)
  const reportMarkdown = Buffer.from(
    reportResponse.body.result.download.base64,
    'base64',
  ).toString('utf8')
  expect(reportMarkdown).toContain('Insufficient evidence')
  expect(reportMarkdown).not.toContain('Prepare the evidence report.')
  expect(reportMarkdown).not.toContain('Return evidence before conclusions.')

  await page.getByRole('button', { name: /Agent 配置库|Agent Configurations/ }).click()
  await expect(page.getByRole('heading', { name: /Agent 配置库|Agent Configurations/ })).toBeVisible()
  await expect(page.getByRole('button', { name: /开发中|In development/ })).toBeVisible()
  await expect(page.getByText('Web E2E version comparison Agent').first()).toBeVisible()
  const importedBadge = page.getByText(/由交付版本 v2 导入|Imported from delivery v2/)
  await expect(importedBadge).toBeVisible()
  await expect(page.getByText(/尚未导出|Not exported/).first()).toBeVisible()
  await page.getByRole('button', { name: /导入 Package|Import Package/ }).click()
  const importDialog = page.getByRole('dialog', { name: /导入并复现 Agent|Import and reproduce Agent/ })
  await importDialog.getByRole('textbox').fill(incomingRelativePath)
  await importDialog.getByRole('button', { name: /开始检查|Inspect/ }).click()
  await expect(importDialog.getByText(/来源验证仅作为交付物溯源|Source validation is retained/)).toBeVisible()
  await expect(importDialog.getByText(/不会导入任何凭据|No credentials are imported/)).toBeVisible()
  await importDialog.getByRole('button', { name: /取消|Cancel/ }).click()
  const sourceAgentCard = page.locator('article').filter({ hasText: 'Web E2E version comparison Agent', hasNot: importedBadge })
  await sourceAgentCard.getByRole('button', { name: /^(打包|Package)$/ }).click()
  await expect(page.getByRole('dialog', { name: /Pi Package Studio/ })).toBeVisible()
  await expect(page.getByText(/目标环境就绪度|Target environment readiness/)).toBeVisible()
  await expect(page.getByText('DELIVERY_CHECKLIST.md')).toBeVisible()
  await page.getByRole('dialog', { name: /Pi Package Studio/ }).getByRole('button', { name: /取消|Cancel/ }).click()
  await page.getByRole('button', { name: /返回|Back/ }).click()

  await page.getByRole('button', { name: /^(设置|Settings)$/ }).click()
  await expect(
    page.getByText(/Vizruna-web 通过启动包更新|Vizruna-web updates through its launcher package/),
  ).toBeVisible()
  await expect(page.getByRole('button', { name: /检查更新|Check for updates/ })).toHaveCount(0)
  rmSync(incomingPath, { recursive: true, force: true })
})

test('allows the startup token to be exchanged only once', async ({ request }) => {
  const repeated = await request.post('/api/auth', {
    data: { token: 'vizruna-web-e2e-token' },
  })
  expect(repeated.status()).toBe(401)
})
