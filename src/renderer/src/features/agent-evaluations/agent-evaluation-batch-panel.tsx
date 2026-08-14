import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, CircleAlert, Loader2, Play, Square, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { AgentEvaluationBatch, AgentEvaluationSuiteBundle } from '@shared/agent-evaluation'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'

const ACTIVE = new Set<AgentEvaluationBatch['status']>(['queued', 'running'])

export function AgentEvaluationBatchPanel({
  bundle,
  canRun,
  onRunsChanged,
}: {
  bundle: AgentEvaluationSuiteBundle
  canRun: boolean
  onRunsChanged: () => void
}) {
  const { t } = useTranslation('evaluations')
  const [batch, setBatch] = useState<AgentEvaluationBatch | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [starting, setStarting] = useState(false)
  const [cancelling, setCancelling] = useState(false)
  const completedBatchId = useRef<string | null>(null)

  const refresh = useCallback(async () => {
    const response = await ipcClient.invoke('agentEvaluation.batch.latest', {
      suiteId: bundle.suite.id,
    })
    setBatch(response.batch)
    return response.batch
  }, [bundle.suite.id])

  useEffect(() => {
    setBatch(null)
    completedBatchId.current = null
    void refresh()
  }, [refresh])

  useEffect(() => {
    if (!batch || !ACTIVE.has(batch.status)) return
    const timer = window.setInterval(() => {
      void ipcClient.invoke('agentEvaluation.batch.get', { batchId: batch.id }).then((response) => {
        setBatch(response.batch)
        if (!ACTIVE.has(response.batch.status) && completedBatchId.current !== response.batch.id) {
          completedBatchId.current = response.batch.id
          onRunsChanged()
        }
      })
    }, 750)
    return () => window.clearInterval(timer)
  }, [batch?.id, batch?.status, onRunsChanged])

  const counts = useMemo(() => {
    const result = { completed: 0, failed: 0, cancelled: 0 }
    for (const item of batch?.items ?? []) {
      if (item.status === 'completed') result.completed += 1
      else if (item.status === 'failed') result.failed += 1
      else if (item.status === 'cancelled') result.cancelled += 1
    }
    return result
  }, [batch])
  const finished = counts.completed + counts.failed + counts.cancelled
  const progress = batch?.items.length ? Math.round((finished / batch.items.length) * 100) : 0
  const running = !!batch && ACTIVE.has(batch.status)

  const start = async () => {
    setStarting(true)
    try {
      const response = await ipcClient.invoke('agentEvaluation.batch.start', {
        suiteId: bundle.suite.id,
      })
      setBatch(response.batch)
      setConfirmOpen(false)
    } catch (error) {
      toast.error(t('messages.batchStartFailed'), { description: String(error) })
    } finally {
      setStarting(false)
    }
  }

  const cancel = async () => {
    if (!batch) return
    setCancelling(true)
    try {
      const response = await ipcClient.invoke('agentEvaluation.batch.cancel', { batchId: batch.id })
      setBatch(response.batch)
    } catch (error) {
      toast.error(t('messages.batchCancelFailed'), { description: String(error) })
    } finally {
      setCancelling(false)
    }
  }

  return (
    <section className="mt-6 rounded-2xl border border-border bg-muted/[0.08]">
      <div className="flex flex-wrap items-start justify-between gap-4 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
            <Play className="h-3.5 w-3.5" />
            {t('batch.title')}
          </div>
          <p className="mt-1 max-w-2xl text-[10px] leading-relaxed text-muted-foreground">
            {t('batch.description')}
          </p>
        </div>
        {running ? (
          <button type="button" onClick={() => void cancel()} disabled={cancelling} className="inline-flex items-center gap-2 rounded-lg border border-destructive/25 px-3 py-2 text-[11px] text-destructive hover:bg-destructive/5 disabled:opacity-50">
            {cancelling ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Square className="h-3.5 w-3.5" />}
            {t('batch.cancel')}
          </button>
        ) : (
          <button type="button" onClick={() => setConfirmOpen(true)} disabled={!canRun || bundle.scenarios.length === 0} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40">
            <Play className="h-3.5 w-3.5" />
            {batch ? t('batch.rerun') : t('batch.start')}
          </button>
        )}
      </div>

      {batch ? (
        <div className="border-t border-border px-5 py-4">
          <div className="flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
            <span>{t(`batch.status.${batch.status}`)}</span>
            <span>{t('batch.progress', { finished, total: batch.items.length })}</span>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted">
            <div className="h-full rounded-full bg-primary transition-[width] duration-300" style={{ width: `${progress}%` }} />
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            {batch.items.map((item) => (
              <div key={item.scenarioId} className="flex min-w-0 items-start gap-2 rounded-lg border border-border/70 bg-background px-3 py-2">
                {item.status === 'running' || item.status === 'pending' ? <Loader2 className={cn('mt-0.5 h-3 w-3 shrink-0 text-primary', item.status === 'running' && 'animate-spin')} /> : item.status === 'completed' ? <Check className="mt-0.5 h-3 w-3 shrink-0 text-emerald-600" /> : <CircleAlert className="mt-0.5 h-3 w-3 shrink-0 text-destructive" />}
                <div className="min-w-0">
                  <div className="truncate text-[10px] font-medium text-foreground-secondary">{item.scenarioName}</div>
                  <div className="mt-0.5 text-[9px] text-muted-foreground">{t(`batch.itemStatus.${item.status}`)}</div>
                  {item.error ? <div className="mt-1 line-clamp-2 text-[9px] leading-relaxed text-destructive">{item.error}</div> : null}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {confirmOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[1px]">
          <div role="dialog" aria-modal="true" aria-label={t('batch.confirmTitle')} className="w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-[16px] font-semibold text-foreground">{t('batch.confirmTitle')}</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t('batch.confirmDescription', { count: bundle.scenarios.length })}</p>
              </div>
              <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-3 p-5">
              <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.06] px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">{t('batch.costNotice')}</div>
              <div className="flex justify-end gap-2 pt-2">
                <button type="button" onClick={() => setConfirmOpen(false)} className="rounded-lg border border-border px-3 py-2 text-[11px] text-muted-foreground hover:bg-accent">{t('common:cancel')}</button>
                <button type="button" onClick={() => void start()} disabled={starting} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground disabled:opacity-50">
                  {starting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  {t('batch.confirm')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
