import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  Download,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
} from 'lucide-react'
import type {
  AuditEventRecord,
  AuditOutcome,
} from '@shared/audit-events'
import type {
  DiagnosticsPreview,
  MetadataBackup,
  ReliabilitySnapshot,
} from '@shared/reliability'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { SettingsPageHeader } from './settings-shell'
import { saveBrowserDownload } from '@renderer/lib/browser-download'

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  const order = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** order).toFixed(order === 0 ? 0 : 1)} ${units[order]}`
}

function ActionButton({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'electron-no-drag inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        danger
          ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
          : 'border-border bg-background hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

function Section({
  title,
  description,
  children,
}: {
  title: string
  description?: string
  children: React.ReactNode
}) {
  return (
    <section className="rounded-xl border border-border/60 bg-card/40 p-4">
      <div className="mb-3">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        {description ? (
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  )
}

export function ReliabilitySettingsPanel() {
  const { t } = useTranslation()
  const [snapshot, setSnapshot] = useState<ReliabilitySnapshot | null>(null)
  const [events, setEvents] = useState<AuditEventRecord[]>([])
  const [auditTotal, setAuditTotal] = useState(0)
  const [outcome, setOutcome] = useState<AuditOutcome | ''>('')
  const [backups, setBackups] = useState<MetadataBackup[]>([])
  const [preview, setPreview] = useState<DiagnosticsPreview | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [restoreId, setRestoreId] = useState<string | null>(null)
  const [confirmation, setConfirmation] = useState('')

  const loadAudit = useCallback(async (nextOutcome: AuditOutcome | '' = outcome) => {
    const result = await ipcClient.invoke('audit.query', {
      ...(nextOutcome ? { outcome: nextOutcome } : {}),
      limit: 200,
    })
    setEvents(result.events ?? [])
    setAuditTotal(result.total ?? 0)
  }, [outcome])

  const refresh = useCallback(async () => {
    setBusy('refresh')
    try {
      const [reliability, backupResult] = await Promise.all([
        ipcClient.invoke('reliability.snapshot', {}),
        ipcClient.invoke('metadataBackup.list', {}),
        loadAudit(),
      ])
      setSnapshot(reliability.snapshot ?? null)
      setBackups(backupResult.backups ?? [])
    } catch (error) {
      toast.error(t('settings:reliability.actionFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }, [loadAudit, t])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const previewDiagnostics = async () => {
    setBusy('preview')
    try {
      const result = await ipcClient.invoke('diagnostics.preview', {})
      setPreview(result.preview)
    } catch (error) {
      toast.error(t('settings:reliability.actionFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }

  const exportDiagnostics = async () => {
    setBusy('diagnostics-export')
    try {
      const result = await ipcClient.invoke('diagnostics.export', {})
      saveBrowserDownload(result.download)
      if (!result.cancelled) toast.success(t('settings:reliability.exported'))
    } finally {
      setBusy(null)
    }
  }

  const exportAudit = async (format: 'json' | 'jsonl') => {
    setBusy(`audit-${format}`)
    try {
      const result = await ipcClient.invoke('audit.export', {
        query: { ...(outcome ? { outcome } : {}), limit: 10_000 },
        format,
      })
      saveBrowserDownload(result.download)
      if (!result.cancelled) toast.success(t('settings:reliability.exported'))
    } finally {
      setBusy(null)
    }
  }

  const createBackup = async () => {
    setBusy('backup')
    try {
      const result = await ipcClient.invoke('metadataBackup.create', {})
      setBackups((current) => [result.backup, ...current])
      toast.success(t('settings:reliability.backupCreated'))
    } finally {
      setBusy(null)
    }
  }

  const restoreBackup = async () => {
    if (!restoreId || confirmation !== 'RESTORE_METADATA') return
    setBusy('restore')
    try {
      await ipcClient.invoke('metadataBackup.restore', {
        backupId: restoreId,
        confirmation: 'RESTORE_METADATA',
      })
      toast.success(t('settings:reliability.restoreComplete'))
      setRestoreId(null)
      setConfirmation('')
      await refresh()
    } catch (error) {
      toast.error(t('settings:reliability.restoreFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title={t('settings:reliability.title')}
        description={t('settings:reliability.description')}
        action={
          <ActionButton onClick={() => void refresh()} disabled={busy != null}>
            <RefreshCw className={cn('h-3.5 w-3.5', busy === 'refresh' && 'animate-spin')} />
            {t('settings:reliability.refresh')}
          </ActionButton>
        }
      />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-xl border border-border/60 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('settings:reliability.database')}
          </div>
          <div className="mt-2 flex items-center gap-2 text-[13px] font-medium">
            {snapshot?.integrity.ok ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            )}
            {snapshot?.integrity.ok
              ? t('settings:reliability.healthy')
              : t('settings:reliability.needsAttention')}
          </div>
        </div>
        <div className="rounded-xl border border-border/60 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('settings:reliability.workers')}
          </div>
          <div className="mt-2 text-[18px] font-semibold">{snapshot?.workers.poolSize ?? '—'}</div>
        </div>
        <div className="rounded-xl border border-border/60 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('settings:reliability.auditEvents')}
          </div>
          <div className="mt-2 text-[18px] font-semibold">{snapshot?.auditEventCount ?? '—'}</div>
        </div>
        <div className="rounded-xl border border-border/60 p-3">
          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
            {t('settings:reliability.reconciliationIssues')}
          </div>
          <div className="mt-2 text-[18px] font-semibold">
            {snapshot?.reconciliation.issues.length ?? '—'}
          </div>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Section
          title={t('settings:reliability.diagnostics')}
          description={t('settings:reliability.diagnosticsDesc')}
        >
          <div className="flex flex-wrap gap-2">
            <ActionButton onClick={() => void previewDiagnostics()} disabled={busy != null}>
              <ShieldCheck className="h-3.5 w-3.5" />
              {t('settings:reliability.preview')}
            </ActionButton>
            <ActionButton
              onClick={() => void exportDiagnostics()}
              disabled={busy != null || !preview}
            >
              <Download className="h-3.5 w-3.5" />
              {t('settings:reliability.exportPackage')}
            </ActionButton>
          </div>
          {preview ? (
            <div className="mt-3 space-y-2 text-[11px] text-muted-foreground">
              <p>
                {t('settings:reliability.packageSummary', {
                  size: formatBytes(preview.estimatedBytes),
                  count: preview.redactionCount,
                })}
              </p>
              <div>
                <span className="font-medium text-foreground">
                  {t('settings:reliability.excluded')}:
                </span>{' '}
                {preview.excludedData.join(' · ')}
              </div>
              <details>
                <summary className="cursor-pointer text-foreground">
                  {t('settings:reliability.previewJson')}
                </summary>
                <pre className="mt-2 max-h-72 overflow-auto rounded-lg bg-muted/60 p-3 text-[10px] leading-relaxed">
                  {JSON.stringify(preview.snapshot, null, 2)}
                </pre>
              </details>
            </div>
          ) : null}
        </Section>

        <Section
          title={t('settings:reliability.metadataBackup')}
          description={t('settings:reliability.metadataBackupDesc')}
        >
          <ActionButton onClick={() => void createBackup()} disabled={busy != null}>
            <Archive className="h-3.5 w-3.5" />
            {t('settings:reliability.createBackup')}
          </ActionButton>
          <div className="mt-3 max-h-64 space-y-2 overflow-auto">
            {backups.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                {t('settings:reliability.noBackups')}
              </p>
            ) : (
              backups.map((backup) => (
                <div
                  key={backup.id}
                  className="flex items-center justify-between gap-3 rounded-lg border border-border/50 px-3 py-2"
                >
                  <div className="min-w-0 text-[11px]">
                    <div className="truncate font-medium">{backup.fileName}</div>
                    <div className="mt-0.5 text-muted-foreground">
                      {new Date(backup.createdAt).toLocaleString()} · {formatBytes(backup.bytes)} · v
                      {backup.schemaVersion}
                    </div>
                  </div>
                  <ActionButton
                    onClick={() => {
                      setRestoreId(backup.id)
                      setConfirmation('')
                    }}
                    disabled={busy != null}
                    danger
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    {t('settings:reliability.restore')}
                  </ActionButton>
                </div>
              ))
            )}
          </div>
          {restoreId ? (
            <div className="mt-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-[11px] leading-relaxed">
                {t('settings:reliability.restoreConfirm')}
              </p>
              <div className="mt-2 flex flex-wrap gap-2">
                <input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  placeholder="RESTORE_METADATA"
                  className="min-w-48 flex-1 rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px]"
                />
                <ActionButton
                  danger
                  disabled={confirmation !== 'RESTORE_METADATA' || busy != null}
                  onClick={() => void restoreBackup()}
                >
                  {t('settings:reliability.confirmRestore')}
                </ActionButton>
                <ActionButton onClick={() => setRestoreId(null)}>
                  {t('settings:reliability.cancel')}
                </ActionButton>
              </div>
            </div>
          ) : null}
        </Section>
      </div>

      <Section
        title={t('settings:reliability.audit')}
        description={t('settings:reliability.auditDesc')}
      >
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={outcome}
            onChange={(event) => {
              const value = event.target.value as AuditOutcome | ''
              setOutcome(value)
              void loadAudit(value)
            }}
            className="rounded-md border border-border bg-background px-2.5 py-1.5 text-[12px]"
          >
            <option value="">{t('settings:reliability.allOutcomes')}</option>
            <option value="success">{t('settings:reliability.success')}</option>
            <option value="blocked">{t('settings:reliability.blocked')}</option>
            <option value="failed">{t('settings:reliability.failed')}</option>
          </select>
          <span className="text-[11px] text-muted-foreground">
            {t('settings:reliability.total', { count: auditTotal })}
          </span>
          <div className="ml-auto flex gap-2">
            <ActionButton onClick={() => void exportAudit('json')} disabled={busy != null}>
              JSON
            </ActionButton>
            <ActionButton onClick={() => void exportAudit('jsonl')} disabled={busy != null}>
              JSONL
            </ActionButton>
          </div>
        </div>
        <div className="mt-3 max-h-80 overflow-auto rounded-lg border border-border/50">
          {events.map((event) => (
            <div
              key={event.id}
              className="grid grid-cols-[150px_100px_1fr] gap-3 border-b border-border/40 px-3 py-2 text-[11px] last:border-b-0"
            >
              <span className="text-muted-foreground">
                {new Date(event.timestamp).toLocaleString()}
              </span>
              <span
                className={cn(
                  'font-medium',
                  event.outcome === 'failed' && 'text-destructive',
                  event.outcome === 'blocked' && 'text-amber-500',
                  event.outcome === 'success' && 'text-emerald-600',
                )}
              >
                {event.outcome}
              </span>
              <span className="truncate">
                {event.category} · {event.action}
              </span>
            </div>
          ))}
        </div>
      </Section>

      {snapshot?.reconciliation.issues.length ? (
        <Section
          title={t('settings:reliability.reconciliation')}
          description={snapshot.reconciliation.note}
        >
          <div className="space-y-2">
            {snapshot.reconciliation.issues.map((issue) => (
              <div key={`${issue.kind}:${issue.resourceId}`} className="rounded-lg bg-muted/50 p-3 text-[11px]">
                <div className="font-medium">{issue.message}</div>
                <div className="mt-1 text-muted-foreground">{issue.suggestion}</div>
              </div>
            ))}
          </div>
        </Section>
      ) : null}
    </div>
  )
}
