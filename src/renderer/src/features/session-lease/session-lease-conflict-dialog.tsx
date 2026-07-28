import { useId } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'

function formatTimestamp(value: string | undefined, language: string): string {
  if (!value) return '—'
  const timestamp = Date.parse(value)
  if (!Number.isFinite(timestamp)) return value
  return new Intl.DateTimeFormat(language.startsWith('zh') ? 'zh-CN' : 'en', {
    dateStyle: 'medium',
    timeStyle: 'medium',
  }).format(timestamp)
}

export function SessionLeaseConflictDialog() {
  const { t, i18n } = useTranslation('lease')
  const titleId = useId()
  const snapshot = useUIStore((state) => state.sessionLeaseSnapshot)
  const open = useUIStore((state) => state.sessionLeaseDialogOpen)
  const pending = useUIStore((state) => state.sessionLeaseTakeoverPending)
  const dismiss = useUIStore((state) => state.dismissSessionLeaseDialog)
  const setPending = useUIStore((state) => state.setSessionLeaseTakeoverPending)
  const setSnapshot = useUIStore((state) => state.setSessionLeaseSnapshot)

  if (!open || !snapshot) return null

  const holder = snapshot.record
  const goBack = () => {
    const store = useUIStore.getState()
    store.setCurrentSession(null)
    store.clearTimeline()
    store.clearFileChanges()
    store.setHistoryMeta(0, 0, null)
    store.setHistoryLoading(false)
    store.setWorkerLiveSnapshot({ sessionId: null, sessionFile: null, status: 'idle' })
    store.setSessionLeaseSnapshot(null)
    void ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
  }

  const takeOver = async () => {
    if (pending) return
    setPending(true)
    try {
      const result = await ipcClient.invoke('session.lease.takeover', {
        sessionFile: snapshot.sessionFile,
        confirmed: true,
      })
      if (result?.acquired && result.snapshot) {
        setSnapshot(result.snapshot)
        return
      }
      if (result?.snapshot) {
        setSnapshot(result.snapshot, { openConflictDialog: true })
      }
    } catch {
      setPending(false)
    }
  }

  return createPortal(
    <div
      className="electron-no-drag fixed inset-0 z-[650] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[1px]"
      role="presentation"
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="mt-0.5 rounded-lg bg-amber-500/15 p-2 text-amber-600 dark:text-amber-300">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 id={titleId} className="text-[15px] font-semibold text-foreground">
              {t('title')}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {snapshot.disposition === 'stale' ? t('staleDescription') : t('description')}
            </p>
          </div>
        </div>

        <dl className="mb-4 grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 gap-y-2 rounded-lg border border-border/70 bg-muted/30 p-3 text-[12px]">
          <dt className="text-muted-foreground">{t('holder')}</dt>
          <dd className="truncate text-foreground">{holder?.appId || t('unknown')}</dd>
          <dt className="text-muted-foreground">{t('hostAndPid')}</dt>
          <dd className="text-foreground">
            {holder ? `${holder.hostname} · PID ${holder.pid}` : t('unknown')}
          </dd>
          <dt className="text-muted-foreground">{t('lastHeartbeat')}</dt>
          <dd className="text-foreground">
            {formatTimestamp(holder?.refreshedAt, i18n.resolvedLanguage || i18n.language)}
          </dd>
          <dt className="text-muted-foreground">{t('reason')}</dt>
          <dd className="break-all text-foreground">{t(`reasons.${snapshot.reason}`)}</dd>
        </dl>

        <p className="mb-5 rounded-lg bg-amber-500/10 px-3 py-2 text-[11px] leading-relaxed text-amber-800 dark:text-amber-200/90">
          {t('takeoverRisk')}
        </p>

        <div className="flex flex-wrap justify-end gap-2">
          <button
            type="button"
            className="rounded-md px-3 py-1.5 text-[12px] text-foreground-secondary hover:bg-accent hover:text-accent-foreground"
            onClick={goBack}
            disabled={pending}
          >
            {t('goBack')}
          </button>
          <button
            type="button"
            className="rounded-md border border-border px-3 py-1.5 text-[12px] text-foreground hover:bg-accent"
            onClick={dismiss}
            disabled={pending}
          >
            {t('keepReadOnly')}
          </button>
          <button
            type="button"
            className="rounded-md bg-destructive px-3 py-1.5 text-[12px] text-destructive-foreground hover:bg-destructive/90 disabled:opacity-50"
            onClick={() => void takeOver()}
            disabled={pending}
          >
            {pending ? t('takingOver') : t('forceTakeover')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}

