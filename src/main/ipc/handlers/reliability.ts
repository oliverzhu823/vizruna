import { app, BrowserWindow, dialog } from 'electron'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getTrustedWorkspaceRoot } from '../../trusted-workspace'
import { getReliabilityService } from '../../reliability/reliability-service'
import { buildReconciliationSnapshot } from '../../reliability/reconciliation-service'
import { registerHandlerWithSchema } from '../registry'
import {
  auditExportSchema,
  auditQuerySchema,
  metadataRestoreSchema,
  reliabilityRootSchema,
} from '../schemas'
import { runtimeIdentity } from '../../bootstrap-path'

const MAX_WEB_EXPORT_BYTES = 32 * 1024 * 1024

async function webDownload(options: {
  filename: string
  mimeType: string
  write: (path: string) => Promise<unknown>
}) {
  const directory = mkdtempSync(join(app.getPath('temp'), 'vizruna-web-export-'))
  const path = join(directory, options.filename)
  try {
    await options.write(path)
    const data = readFileSync(path)
    if (data.byteLength > MAX_WEB_EXPORT_BYTES) throw new Error('WEB_EXPORT_TOO_LARGE')
    return {
      cancelled: false,
      bytes: data.byteLength,
      download: {
        filename: options.filename,
        mimeType: options.mimeType,
        base64: data.toString('base64'),
      },
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}

function trustedWorkspace(requested?: string): string | undefined {
  const trusted = getTrustedWorkspaceRoot()
  if (requested && requested !== trusted) {
    throw new Error('Requested workspace is not the active trusted workspace')
  }
  return trusted ?? undefined
}

async function savePath(options: {
  title: string
  defaultPath: string
  extension: string
  name: string
}): Promise<string | null> {
  if (BrowserWindow.getAllWindows().length === 0) app.focus({ steal: true })
  const win = BrowserWindow.getFocusedWindow() || BrowserWindow.getAllWindows()[0]
  const dialogOptions = {
    title: options.title,
    defaultPath: options.defaultPath,
    filters: [{ name: options.name, extensions: [options.extension] }],
  }
  const result = win
    ? await dialog.showSaveDialog(win, dialogOptions)
    : await dialog.showSaveDialog(dialogOptions)
  return result.canceled || !result.filePath ? null : result.filePath
}

function timestamp(): string {
  return new Date().toISOString().replace(/[:.]/g, '-')
}

export function registerReliabilityHandlers(): void {
  registerHandlerWithSchema(
    'ipc:reliability.snapshot',
    reliabilityRootSchema,
    async (request) => ({
      snapshot: await getReliabilityService().snapshot(
        trustedWorkspace(request.rootWorkspacePath),
      ),
    }),
  )

  registerHandlerWithSchema(
    'ipc:reliability.reconcile',
    reliabilityRootSchema,
    async (request) => ({
      reconciliation: await buildReconciliationSnapshot(
        trustedWorkspace(request.rootWorkspacePath),
      ),
    }),
  )

  registerHandlerWithSchema('ipc:audit.query', auditQuerySchema, async (request) =>
    getReliabilityService().queryAudit(request),
  )

  registerHandlerWithSchema('ipc:audit.export', auditExportSchema, async (request) => {
    if (runtimeIdentity.channel === 'web') {
      const filename = `vizruna-audit-${timestamp()}.${request.format}`
      return webDownload({
        filename,
        mimeType: request.format === 'jsonl' ? 'application/x-ndjson' : 'application/json',
        write: (path) => getReliabilityService().exportAudit(request, path),
      })
    }
    const path = await savePath({
      title: '导出脱敏审计日志',
      defaultPath: `pi-enterprise-audit-${timestamp()}.${request.format}`,
      extension: request.format,
      name: request.format === 'jsonl' ? 'JSON Lines' : 'JSON',
    })
    if (!path) return { cancelled: true }
    return getReliabilityService().exportAudit(request, path)
  })

  registerHandlerWithSchema(
    'ipc:diagnostics.preview',
    reliabilityRootSchema,
    async (request) => ({
      preview: await getReliabilityService().diagnosticsPreview(
        trustedWorkspace(request.rootWorkspacePath),
      ),
    }),
  )

  registerHandlerWithSchema(
    'ipc:diagnostics.export',
    reliabilityRootSchema,
    async (request) => {
      const root = trustedWorkspace(request.rootWorkspacePath)
      if (runtimeIdentity.channel === 'web') {
        const filename = `vizruna-diagnostics-${timestamp()}.json.gz`
        return webDownload({
          filename,
          mimeType: 'application/gzip',
          write: (path) => getReliabilityService().exportDiagnostics(root, path),
        })
      }
      const path = await savePath({
        title: '导出脱敏诊断包',
        defaultPath: `pi-enterprise-diagnostics-${timestamp()}.json.gz`,
        extension: 'gz',
        name: 'Compressed JSON',
      })
      if (!path) return { cancelled: true }
      return getReliabilityService().exportDiagnostics(root, path)
    },
  )

  registerHandlerWithSchema(
    'ipc:metadataBackup.list',
    reliabilityRootSchema,
    async () => ({ backups: getReliabilityService().listBackups() }),
  )

  registerHandlerWithSchema(
    'ipc:metadataBackup.create',
    reliabilityRootSchema,
    async () => ({ backup: getReliabilityService().createBackup() }),
  )

  registerHandlerWithSchema(
    'ipc:metadataBackup.restore',
    metadataRestoreSchema,
    async (request) => getReliabilityService().restoreBackup(request.backupId),
  )
}
