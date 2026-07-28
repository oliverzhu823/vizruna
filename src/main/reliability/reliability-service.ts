import { app } from 'electron'
import { gzipSync } from 'node:zlib'
import { writeFile } from 'node:fs/promises'
import type {
  AuditExportRequest,
  AuditQuery,
  AuditQueryResult,
  DiagnosticsPreview,
  FileExportResult,
  MetadataBackup,
  ReliabilitySnapshot,
} from '@shared/reliability'
import { PRODUCT_NAME, PRODUCT_PACKAGE_NAME } from '@shared/product-identity'
import { auditRepository } from '../audit/audit-repository'
import { configStore } from '../config-store'
import { sqliteIndex } from '../sqlite-index'
import { workerManager } from '../worker-manager'
import { failureFromUnknown } from './failure-model'
import { capturePerformance } from './performance-monitor'
import { buildReconciliationSnapshot } from './reconciliation-service'
import { redactSensitive } from './redaction'

const EXCLUDED_DATA = [
  'Pi JSONL conversation bodies',
  'complete prompts and model responses',
  'API keys and OAuth tokens',
  'cookies and authorization headers',
  'proxy usernames and passwords',
  'environment variable values',
]

function safeSettings(): Record<string, unknown> {
  return {
    language: configStore.get('language'),
    theme: configStore.get('theme'),
    autoOpenLastProject: configStore.get('autoOpenLastProject'),
    autoCheckRegistryUpdates: configStore.get('autoCheckRegistryUpdates'),
    maxSessionWorkers: configStore.get('maxSessionWorkers'),
    sessionWorkerIdleTimeoutMinutes: configStore.get(
      'sessionWorkerIdleTimeoutMinutes',
    ),
    timelineMaxAutoExpandedTools: configStore.get(
      'timelineMaxAutoExpandedTools',
    ),
    rightPanelCount: Object.keys(configStore.get('rightPanelPrefs')).length,
    extensionOverrideCount: Object.keys(
      configStore.get('extensionOverrides'),
    ).length,
    skillOverrideCount: Object.keys(configStore.get('skillOverrides')).length,
  }
}

function serializeAudit(request: AuditExportRequest, result: AuditQueryResult): string {
  if (request.format === 'jsonl') {
    return `${result.events.map((event) => JSON.stringify(event)).join('\n')}\n`
  }
  return `${JSON.stringify(
    {
      exportedAt: Date.now(),
      query: request.query ?? {},
      total: result.total,
      events: result.events,
    },
    null,
    2,
  )}\n`
}

export class ReliabilityService {
  async snapshot(rootWorkspacePath?: string): Promise<ReliabilitySnapshot> {
    const workers = workerManager.diagnosticSnapshot()
    const reconciliation = await buildReconciliationSnapshot(rootWorkspacePath)
    const recentAudit = auditRepository.query({ limit: 500 })
    const recentFailures = recentAudit.events
      .filter((event) => event.outcome === 'failed')
      .slice(0, 20)
      .map((event) =>
        failureFromUnknown(
          event.details?.error ??
            event.details?.lastError ??
            `${event.category}.${event.action} failed`,
        ),
      )
    return {
      generatedAt: Date.now(),
      integrity: sqliteIndex.integrityCheck(),
      auditEventCount: recentAudit.total,
      backupCount: sqliteIndex.listMetadataBackups().length,
      performance: capturePerformance(workers),
      workers,
      reconciliation,
      recentFailures,
    }
  }

  queryAudit(query?: AuditQuery): AuditQueryResult {
    return auditRepository.query(query)
  }

  async exportAudit(
    request: AuditExportRequest,
    path: string,
  ): Promise<FileExportResult> {
    const result = this.queryAudit({ ...request.query, limit: 10_000 })
    const redacted = redactSensitive(result)
    const content = serializeAudit(request, redacted.value)
    await writeFile(path, content, { encoding: 'utf8', mode: 0o600 })
    auditRepository.write({
      category: 'security',
      action: 'audit.export',
      outcome: 'success',
      details: {
        format: request.format,
        eventCount: result.events.length,
        bytes: Buffer.byteLength(content),
        redactionCount: redacted.redactionCount,
      },
    })
    return { cancelled: false, path, bytes: Buffer.byteLength(content) }
  }

  async diagnosticsPreview(
    rootWorkspacePath?: string,
  ): Promise<DiagnosticsPreview> {
    const reliability = await this.snapshot(rootWorkspacePath)
    const audit = this.queryAudit({
      workspaceId: rootWorkspacePath,
      limit: 100,
    })
    const rawSnapshot = {
      manifest: {
        product: PRODUCT_NAME,
        packageName: PRODUCT_PACKAGE_NAME,
        appVersion: app.getVersion(),
        generatedAt: Date.now(),
        formatVersion: 1,
      },
      runtime: {
        platform: process.platform,
        arch: process.arch,
        node: process.versions.node,
        electron: process.versions.electron,
        chrome: process.versions.chrome,
      },
      settings: safeSettings(),
      reliability,
      recentAudit: audit.events,
      privacy: {
        included: [
          'application and runtime versions',
          'redacted operational audit events',
          'Worker state without session content',
          'SQLite integrity and backup metadata',
          'Git/worktree reconciliation differences',
          'process memory and uptime snapshot',
        ],
        excluded: EXCLUDED_DATA,
      },
    }
    const redacted = redactSensitive(rawSnapshot)
    const json = JSON.stringify(redacted.value)
    return {
      generatedAt: Date.now(),
      packageFormat: 'json.gz',
      includedSections: Object.keys(rawSnapshot),
      excludedData: EXCLUDED_DATA,
      estimatedBytes: gzipSync(json).byteLength,
      redactionCount: redacted.redactionCount,
      snapshot: redacted.value,
    }
  }

  async exportDiagnostics(
    rootWorkspacePath: string | undefined,
    path: string,
  ): Promise<FileExportResult> {
    const preview = await this.diagnosticsPreview(rootWorkspacePath)
    const packageBody = {
      generatedAt: preview.generatedAt,
      packageFormat: preview.packageFormat,
      includedSections: preview.includedSections,
      excludedData: preview.excludedData,
      redactionCount: preview.redactionCount,
      snapshot: preview.snapshot,
    }
    const data = gzipSync(`${JSON.stringify(packageBody, null, 2)}\n`)
    await writeFile(path, data, { mode: 0o600 })
    auditRepository.write({
      category: 'security',
      action: 'diagnostics.export',
      outcome: 'success',
      workspaceId: rootWorkspacePath,
      details: {
        bytes: data.byteLength,
        redactionCount: preview.redactionCount,
        format: preview.packageFormat,
      },
    })
    return { cancelled: false, path, bytes: data.byteLength }
  }

  listBackups(): MetadataBackup[] {
    return sqliteIndex.listMetadataBackups()
  }

  createBackup(): MetadataBackup {
    const backup = sqliteIndex.createMetadataBackup('manual')
    auditRepository.write({
      category: 'recovery',
      action: 'metadata.backup.create',
      outcome: 'success',
      details: {
        backupId: backup.id,
        bytes: backup.bytes,
        schemaVersion: backup.schemaVersion,
      },
    })
    return backup
  }

  restoreBackup(backupId: string): {
    restored: MetadataBackup
    rollback: MetadataBackup
  } {
    try {
      const result = sqliteIndex.restoreMetadataBackup(backupId)
      auditRepository.write({
        category: 'recovery',
        action: 'metadata.backup.restore',
        outcome: 'success',
        details: {
          backupId,
          rollbackBackupId: result.rollback.id,
          piJsonlModified: false,
        },
      })
      return result
    } catch (error) {
      auditRepository.write({
        category: 'recovery',
        action: 'metadata.backup.restore',
        outcome: 'failed',
        details: {
          backupId,
          error: failureFromUnknown(error, 'recovery'),
          piJsonlModified: false,
        },
      })
      throw error
    }
  }
}

let instance: ReliabilityService | null = null

export function getReliabilityService(): ReliabilityService {
  instance ??= new ReliabilityService()
  return instance
}

