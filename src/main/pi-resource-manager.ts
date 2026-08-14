import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import { BrowserWindow } from 'electron'
import type {
  PiPackageMutationProgress,
  PiPackageMutationRequest,
  PiPackageMutationResponse,
  PiPackageUpdateCheckRequest,
  PiPackageUpdateCheckResponse,
  PiResourceCenterKind,
  PiResourceFilterSetRequest,
  PiResourceFilterSetResponse,
} from '@shared/pi-resource-center'
import type { PackageSource, ProgressEvent, SettingsManager } from '@earendil-works/pi-coding-agent'
import { auditRepository } from './audit/audit-repository'
import { getActiveSdkModule } from './ipc/sdk-session'
import { collectPiResourceCenterSnapshot } from './pi-resource-center-service'
import { emitRuntimeEvent } from './runtime-event-bus'
import { getTrustedWorkspaceRoot } from './trusted-workspace'
import { workerManager } from './worker-manager'

type Scope = 'user' | 'project'

let mutationTail: Promise<void> = Promise.resolve()

function enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
  const result = mutationTail.then(operation, operation)
  mutationTail = result.then(() => undefined, () => undefined)
  return result
}

function packageId(scope: Scope, source: string): string {
  return `${scope}:${source}`
}

function activeTrustedWorkspace(requested?: string): string {
  const trusted = getTrustedWorkspaceRoot()
  if (!trusted) throw new Error('No active trusted workspace')
  const workspacePath = resolve(trusted)
  if (requested && resolve(requested) !== workspacePath) {
    throw new Error('Requested workspace is not the active trusted workspace')
  }
  return workspacePath
}

function assertSafePackageSource(source: string): void {
  if (/\p{Cc}/u.test(source)) throw new Error('Package source contains control characters')
  const protocolSource = source.startsWith('git:') ? source.slice(4) : source
  if (!/^(https?|ssh|git):\/\//i.test(protocolSource)) return
  const parsed = new URL(protocolSource)
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('Package URLs must not contain credentials, query strings, or fragments')
  }
}

function publishProgress(progress: PiPackageMutationProgress): void {
  emitRuntimeEvent('ipc:pi-resource-operation-progress', progress)
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send('ipc:pi-resource-operation-progress', progress)
    }
  }
}

function progressMessage(event: ProgressEvent): string | undefined {
  return event.message?.trim() || undefined
}

async function createContext(workspacePath: string) {
  const sdk = await getActiveSdkModule()
  const agentDir = sdk.getAgentDir()
  const settingsManager = sdk.SettingsManager.create(workspacePath, agentDir)
  const manager = new sdk.DefaultPackageManager({ cwd: workspacePath, agentDir, settingsManager })
  return { manager, settingsManager }
}

async function reloadActiveResources(
  workspacePath: string,
): Promise<'reloaded' | 'deferred' | 'not-running'> {
  if (!workerManager.isRunning || resolve(workerManager.cwd || '') !== workspacePath) {
    return 'not-running'
  }
  const hasActiveTurn = workerManager.listSessionRuntime().some(
    (session) => session.running && resolve(session.cwd) === workspacePath,
  )
  if (hasActiveTurn) return 'deferred'
  await workerManager.reloadResources()
  return 'reloaded'
}

function auditPackageMutation(
  request: PiPackageMutationRequest,
  source: string,
  outcome: 'success' | 'failed',
  error?: unknown,
): void {
  auditRepository.write({
    category: 'operation',
    action: `pi.package.${request.action}`,
    outcome,
    details: {
      source,
      scope: request.action === 'install' ? request.scope : request.packageId.split(':', 1)[0],
      ...(error ? { error: error instanceof Error ? error.message : String(error) } : {}),
    },
  })
}

export async function mutatePiPackage(
  request: PiPackageMutationRequest,
): Promise<PiPackageMutationResponse> {
  const workspacePath = activeTrustedWorkspace(request.workspaceId)
  const operationId = randomUUID()
  const requestedSource = request.action === 'install' ? request.source.trim() : request.packageId
  publishProgress({
    operationId,
    action: request.action,
    phase: 'queued',
    source: requestedSource,
  })

  return enqueueMutation(async () => {
    const { manager, settingsManager } = await createContext(workspacePath)
    let source = requestedSource
    let scope: Scope
    if (request.action === 'install') {
      scope = request.scope
      assertSafePackageSource(source)
    } else {
      const configured = manager.listConfiguredPackages()
      const pkg = configured.find((entry) => packageId(entry.scope, entry.source) === request.packageId)
      if (!pkg) throw new Error('Package is not configured in the active Pi workspace')
      source = pkg.source
      scope = pkg.scope
    }
    if (scope === 'project' && !settingsManager.isProjectTrusted()) {
      throw new Error('Project-local Pi packages require a trusted project')
    }

    manager.setProgressCallback((event) => {
      publishProgress({
        operationId,
        action: request.action,
        phase: event.type === 'start' ? 'started' : 'progress',
        source,
        message: progressMessage(event),
      })
    })

    try {
      if (request.action === 'install') {
        await manager.installAndPersist(source, { local: scope === 'project' })
      } else if (request.action === 'remove') {
        const removed = await manager.removeAndPersist(source, { local: scope === 'project' })
        if (!removed) throw new Error('Pi package settings did not contain this package')
      } else {
        await manager.update(source)
      }
      await settingsManager.flush()
      const workerReload = await reloadActiveResources(workspacePath)
      const snapshot = await collectPiResourceCenterSnapshot({ workspaceId: workspacePath })
      publishProgress({ operationId, action: request.action, phase: 'completed', source })
      auditPackageMutation(request, source, 'success')
      return { ok: true, operationId, workerReload, snapshot }
    } catch (error) {
      publishProgress({
        operationId,
        action: request.action,
        phase: 'failed',
        source,
        message: error instanceof Error ? error.message : String(error),
      })
      auditPackageMutation(request, source, 'failed', error)
      throw error
    } finally {
      manager.setProgressCallback(undefined)
    }
  })
}

export async function checkPiPackageUpdates(
  request: PiPackageUpdateCheckRequest,
): Promise<PiPackageUpdateCheckResponse> {
  const workspacePath = activeTrustedWorkspace(request.workspaceId)
  await mutationTail
  const { manager } = await createContext(workspacePath)
  const updates = await manager.checkForAvailableUpdates()
  return {
    checkedAt: Date.now(),
    packageIds: updates.map((entry) => packageId(entry.scope, entry.source)),
  }
}

function applyExactFilter(current: string[], relativePath: string, enabled: boolean): string[] {
  const normalized = relativePath.replace(/^\.\//, '').replace(/\\/g, '/')
  const withoutExactRule = current.filter((entry) => {
    const candidate = /^[+\-!]/.test(entry) ? entry.slice(1) : entry
    return candidate.replace(/^\.\//, '').replace(/\\/g, '/') !== normalized
  })
  return [...withoutExactRule, `${enabled ? '+' : '-'}${normalized}`]
}

function updatePackageFilter(
  settingsManager: SettingsManager,
  scope: Scope,
  source: string,
  kind: PiResourceCenterKind,
  relativePath: string,
  enabled: boolean,
): void {
  const settings = scope === 'user'
    ? settingsManager.getGlobalSettings()
    : settingsManager.getProjectSettings()
  const packages = [...(settings.packages || [])]
  const index = packages.findIndex((entry) =>
    (typeof entry === 'string' ? entry : entry.source) === source)
  if (index < 0) throw new Error('Package is no longer present in Pi settings')
  const existing = packages[index]
  const next: Exclude<PackageSource, string> = typeof existing === 'string'
    ? { source: existing }
    : { ...existing }
  next[kind] = applyExactFilter(next[kind] || [], relativePath, enabled)
  packages[index] = next
  if (scope === 'user') settingsManager.setPackages(packages)
  else settingsManager.setProjectPackages(packages)
}

function updateTopLevelFilter(
  settingsManager: SettingsManager,
  scope: Scope,
  kind: PiResourceCenterKind,
  relativePath: string,
  enabled: boolean,
): void {
  const settings = scope === 'user'
    ? settingsManager.getGlobalSettings()
    : settingsManager.getProjectSettings()
  const next = applyExactFilter(settings[kind] || [], relativePath, enabled)
  if (scope === 'user') {
    if (kind === 'extensions') settingsManager.setExtensionPaths(next)
    if (kind === 'skills') settingsManager.setSkillPaths(next)
    if (kind === 'prompts') settingsManager.setPromptTemplatePaths(next)
    if (kind === 'themes') settingsManager.setThemePaths(next)
  } else {
    if (kind === 'extensions') settingsManager.setProjectExtensionPaths(next)
    if (kind === 'skills') settingsManager.setProjectSkillPaths(next)
    if (kind === 'prompts') settingsManager.setProjectPromptTemplatePaths(next)
    if (kind === 'themes') settingsManager.setProjectThemePaths(next)
  }
}

export async function setPiResourceFilter(
  request: PiResourceFilterSetRequest,
): Promise<PiResourceFilterSetResponse> {
  const workspacePath = activeTrustedWorkspace(request.workspaceId)
  return enqueueMutation(async () => {
    const before = await collectPiResourceCenterSnapshot({ workspaceId: workspacePath })
    const resource = Object.values(before.resources)
      .flat()
      .find((entry) => entry.id === request.resourceId)
    if (!resource || !resource.configurable || !resource.relativePath) {
      throw new Error('Resource cannot be configured in the active Pi workspace')
    }
    if (resource.scope === 'temporary') {
      throw new Error('Temporary Pi resources cannot be persisted')
    }
    const { settingsManager } = await createContext(workspacePath)
    if (resource.scope === 'project' && !settingsManager.isProjectTrusted()) {
      throw new Error('Project-local Pi resources require a trusted project')
    }
    if (resource.packageId) {
      const pkg = before.packages.find((entry) => entry.id === resource.packageId)
      if (!pkg) throw new Error('Resource package is no longer configured')
      updatePackageFilter(
        settingsManager,
        pkg.scope,
        pkg.source,
        resource.kind,
        resource.relativePath,
        request.enabled,
      )
    } else {
      updateTopLevelFilter(
        settingsManager,
        resource.scope,
        resource.kind,
        resource.relativePath,
        request.enabled,
      )
    }
    await settingsManager.flush()
    const workerReload = await reloadActiveResources(workspacePath)
    auditRepository.write({
      category: 'operation',
      action: 'pi.resource.filter.set',
      outcome: 'success',
      details: {
        resourceId: resource.id,
        kind: resource.kind,
        scope: resource.scope,
        enabled: request.enabled,
      },
    })
    return {
      ok: true,
      workerReload,
      snapshot: await collectPiResourceCenterSnapshot({ workspaceId: workspacePath }),
    }
  })
}

export const piResourceManagerTestApi = {
  applyExactFilter,
  assertSafePackageSource,
}
