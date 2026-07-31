import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import type { AppUpdateAvailableInfo, AppUpdateDownloadProgress } from '@shared/app-update'
import { ipcClient, onAppUpdateDownloadProgress } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'

const UPDATE_ERROR_KEYS: Record<string, string> = {
  download_in_progress: 'update:errors.downloadInProgress',
  untrusted_release_source: 'update:errors.untrustedReleaseSource',
  checksum_download_failed: 'update:errors.checksumDownloadFailed',
  checksum_manifest_invalid: 'update:errors.checksumManifestInvalid',
  checksum_entry_missing: 'update:errors.checksumEntryMissing',
  checksum_mismatch: 'update:errors.checksumMismatch',
  quarantine_inspection_failed: 'update:errors.quarantineInspectionFailed',
  quarantine_remove_failed: 'update:errors.quarantineRemoveFailed',
  installer_download_failed: 'update:errors.installerDownloadFailed',
  installer_open_failed: 'update:errors.installerOpenFailed',
}

function plainReleaseNotes(markdown: string): string {
  const text = String(markdown || '')
    .replace(/\r\n/g, '\n')
    // strip simple markdown chrome for a readable announcement
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/\*\*(.*?)\*\*/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim()
  return text
}

export function AppUpdateDialog({
  info,
  onDismiss,
}: {
  info: AppUpdateAvailableInfo
  onDismiss: () => void
}) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<AppUpdateDownloadProgress | null>(null)
  const canInstallInApp = Boolean(info.downloadUrl && info.downloadName && info.checksumUrl)

  const notes = useMemo(() => {
    const plain = plainReleaseNotes(info.releaseNotes)
    if (plain) return plain
    return t('update:noNotes')
  }, [info.releaseNotes, t])

  useEffect(() => {
    return onAppUpdateDownloadProgress((payload) => {
      setProgress(payload)
      if (payload.phase === 'done' || payload.phase === 'error') {
        setBusy(false)
      }
    })
  }, [])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onDismiss()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onDismiss])

  const ignoreThisVersion = async () => {
    await ipcClient.invoke('app.ignoreUpdateVersion', { version: info.latestVersion })
    onDismiss()
  }

  const startUpdate = async () => {
    if (!canInstallInApp || !info.downloadUrl || !info.downloadName || !info.checksumUrl) {
      void ipcClient.invoke('app.openRelease', { url: info.releaseUrl })
      return
    }
    setBusy(true)
    setProgress({
      phase: 'verifying',
      receivedBytes: 0,
      totalBytes: 0,
      percent: -1,
      fileName: info.downloadName,
    })
    const result = await ipcClient.invoke('app.downloadUpdate', {
      url: info.downloadUrl,
      fileName: info.downloadName,
      checksumUrl: info.checksumUrl,
    })
    if (!result?.ok) {
      setBusy(false)
      setProgress({
        phase: 'error',
        receivedBytes: 0,
        totalBytes: 0,
        percent: -1,
        error: result?.error || 'download_failed',
      })
    }
  }

  const progressLabel = (() => {
    if (!progress) return null
    if (progress.phase === 'error') {
      const errorKey = UPDATE_ERROR_KEYS[progress.error || ''] || 'update:errors.unknown'
      return t('update:downloadFailed', { error: t(errorKey) })
    }
    if (progress.phase === 'launching' || progress.phase === 'done') {
      return t('update:launchingInstaller')
    }
    if (progress.phase === 'verifying') return t('update:verifyingPackage')
    if (progress.phase === 'preparing') return t('update:preparingInstaller')
    if (progress.percent >= 0) {
      return t('update:downloadingPercent', { percent: progress.percent })
    }
    return t('update:downloading')
  })()

  return createPortal(
    <div
      className="electron-no-drag fixed inset-0 z-[700] flex items-center justify-center bg-black/45 p-4"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="app-update-title"
        className="flex max-h-[min(88vh,640px)] w-full max-w-lg flex-col overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-2xl"
      >
        <div className="border-b border-border/60 px-5 py-4">
          <h2 id="app-update-title" className="text-[16px] font-semibold tracking-tight">
            {t('update:title')}
          </h2>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {t('update:versionLine', {
              latest: info.latestVersion,
              current: info.currentVersion,
            })}
          </p>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <div className="mb-2 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
            {t('update:notesHeading')}
          </div>
          <pre className="whitespace-pre-wrap break-words font-sans text-[13px] leading-relaxed text-foreground/90">
            {notes}
          </pre>
          <p className="mt-4 rounded-lg border border-border/70 bg-muted/35 px-3 py-2 text-[12px] leading-relaxed text-muted-foreground">
            {canInstallInApp
              ? t('update:securityVerifiedHint')
              : t('update:securityManualHint')}
          </p>
          {progressLabel ? (
            <p
              className={cn(
                'mt-4 text-[12px]',
                progress?.phase === 'error' ? 'text-destructive' : 'text-muted-foreground',
              )}
            >
              {progressLabel}
            </p>
          ) : null}
          {progress && progress.phase === 'downloading' && progress.percent >= 0 ? (
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-primary transition-[width] duration-200"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 bg-muted/20 px-4 py-3">
          <button
            type="button"
            disabled={busy}
            onClick={onDismiss}
            className="rounded-lg px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:opacity-50"
          >
            {t('update:remindLater')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void ignoreThisVersion()}
            className="rounded-lg border border-border px-3 py-1.5 text-[13px] hover:bg-accent/50 disabled:opacity-50"
          >
            {t('update:ignoreVersion')}
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void startUpdate()}
            className="rounded-lg bg-primary px-3 py-1.5 text-[13px] font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {busy
              ? t('update:updating')
              : canInstallInApp
                ? t('update:updateNow')
                : t('update:openRelease')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
