import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { CheckCircle2, GitBranch, Loader2, Play, ShieldCheck, X } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentEvaluationSuiteBundle } from '@shared/agent-evaluation'
import type { AgentProfile } from '@shared/agent-profile'
import {
  diffAgentVersions,
  type AgentVersion,
  type AgentVersionValidationGate,
} from '@shared/agent-version'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

export function AgentVersionHistoryDialog({
  profile,
  onClose,
  onUse,
  onChanged,
}: {
  profile: AgentProfile
  onClose: () => void
  onUse: (versionId: string) => void
  onChanged: () => void
}) {
  const { t, i18n } = useTranslation('agents')
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const [versions, setVersions] = useState<AgentVersion[]>([])
  const [suites, setSuites] = useState<AgentEvaluationSuiteBundle[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [validating, setValidating] = useState(false)
  const [readiness, setReadiness] = useState<AgentVersionValidationGate | null>(null)
  const [readinessLoading, setReadinessLoading] = useState(false)

  const load = async () => {
    setLoading(true)
    try {
      const [versionResponse, evaluationResponse] = await Promise.all([
        ipcClient.invoke('agentVersion.list', { profileId: profile.id }),
        ipcClient.invoke('agentEvaluation.list', {
          workspacePath: currentWorkspace || undefined,
        }),
      ])
      const nextVersions = (versionResponse?.versions ?? []) as AgentVersion[]
      setVersions(nextVersions)
      setSuites(evaluationResponse.suites)
      setSelectedId((current) =>
        nextVersions.some((version) => version.id === current)
          ? current
          : nextVersions[0]?.id || '',
      )
    } catch (error) {
      toast.error(t('versions.loadFailed'), { description: String(error) })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [currentWorkspace, profile.id])

  const selected = versions.find((version) => version.id === selectedId) ?? versions[0]
  const previous = selected
    ? versions.find((version) => version.number === selected.number - 1)
    : undefined
  const differences = useMemo(
    () => selected && previous ? diffAgentVersions(previous.config, selected.config) : [],
    [previous, selected],
  )
  const suite = selected
    ? suites.find((item) => item.suite.versionId === selected.id && item.suite.status === 'active')
    : undefined

  useEffect(() => {
    let active = true
    if (!selected || selected.status !== 'candidate' || !suite) {
      setReadiness(null)
      setReadinessLoading(false)
      return () => { active = false }
    }
    setReadiness(null)
    setReadinessLoading(true)
    void ipcClient.invoke('agentVersion.readiness', {
      versionId: selected.id,
      suiteId: suite.suite.id,
    }).then((response) => {
      if (active) setReadiness(response.gate)
    }).catch((error) => {
      if (active) toast.error(t('versions.readinessFailed'), { description: String(error) })
    }).finally(() => {
      if (active) setReadinessLoading(false)
    })
    return () => { active = false }
  }, [selected?.id, selected?.status, suite?.suite.id, t])

  const validate = async () => {
    if (!selected || !suite || !readiness?.eligible || validating) return
    setValidating(true)
    try {
      await ipcClient.invoke('agentVersion.validate', {
        versionId: selected.id,
        suiteId: suite.suite.id,
      })
      toast.success(t('versions.validated'))
      await load()
      onChanged()
    } catch (error) {
      toast.error(t('versions.validationFailed'), { description: String(error) })
    } finally {
      setValidating(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[125] flex items-center justify-center bg-black/45 p-5 backdrop-blur-[2px]" onMouseDown={(event) => { if (event.target === event.currentTarget && !validating) onClose() }}>
      <div role="dialog" aria-modal="true" aria-label={t('versions.title')} className="flex max-h-[90vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl">
        <header className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary"><GitBranch className="h-4.5 w-4.5" /></div>
            <div className="min-w-0"><h2 className="text-[16px] font-semibold text-foreground">{t('versions.title')}</h2><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{profile.name} · {t('versions.subtitle')}</p></div>
          </div>
          <button type="button" aria-label={t('form.cancel')} onClick={onClose} disabled={validating} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"><X className="h-4 w-4" /></button>
        </header>

        {loading && versions.length === 0 ? (
          <div className="flex min-h-[26rem] items-center justify-center text-[12px] text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('loading')}</div>
        ) : (
          <div className="grid min-h-0 flex-1 md:grid-cols-[15rem_minmax(0,1fr)]">
            <aside className="min-h-0 overflow-y-auto border-b border-border/60 bg-muted/10 p-3 md:border-b-0 md:border-r">
              <div className="mb-2 px-2 text-[9px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t('versions.timeline')}</div>
              <div className="space-y-1.5">
                {versions.map((version) => (
                  <button key={version.id} type="button" onClick={() => setSelectedId(version.id)} className={cn('w-full rounded-xl border px-3 py-2.5 text-left transition-colors', selected?.id === version.id ? 'border-primary/35 bg-primary/[0.06]' : 'border-transparent hover:border-border hover:bg-accent/40')}>
                    <div className="flex items-center justify-between gap-2"><span className="text-[12px] font-semibold text-foreground">v{version.number}</span><span className={cn('rounded-full px-2 py-0.5 text-[8px]', version.status === 'candidate' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300')}>{t(`versions.status.${version.status}`)}</span></div>
                    <div className="mt-1 font-mono text-[8px] text-muted-foreground">{version.digest.slice(0, 12)}</div>
                  </button>
                ))}
              </div>
            </aside>

            <main className="min-h-0 overflow-y-auto p-5">
              {selected ? (
                <div className="space-y-4">
                  <section className="flex flex-wrap items-start justify-between gap-4 rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
                    <div><div className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">{t('versions.immutableVersion')}</div><div className="mt-1 text-[20px] font-semibold text-foreground">v{selected.number}</div><div className="mt-1 font-mono text-[9px] text-muted-foreground">sha256:{selected.digest}</div><div className="mt-2 text-[10px] text-muted-foreground">{new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(selected.createdAt)}</div></div>
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => onUse(selected.id)} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 px-3 py-2 text-[11px] font-medium text-primary hover:bg-primary/5"><Play className="h-3.5 w-3.5" />{t('versions.useVersion', { number: selected.number })}</button>
                      {selected.status === 'candidate' ? (
                        <button type="button" onClick={() => void validate()} disabled={!suite || !readiness?.eligible || readinessLoading || validating} title={!suite ? t('versions.needsSuite') : !readiness?.eligible ? t('versions.notReady') : undefined} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground disabled:opacity-40">{validating || readinessLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}{t('versions.validate')}</button>
                      ) : <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/10 px-3 py-2 text-[11px] font-medium text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" />{t(`versions.status.${selected.status}`)}</span>}
                    </div>
                  </section>

                  {selected.status === 'candidate' && !suite ? <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.05] px-3 py-2.5 text-[10px] text-amber-800 dark:text-amber-200">{t('versions.needsSuite')}</div> : null}

                  {selected.status === 'candidate' && suite ? (
                    <section className={cn('rounded-xl border px-3.5 py-3', readiness?.eligible ? 'border-emerald-500/25 bg-emerald-500/[0.05]' : 'border-amber-500/25 bg-amber-500/[0.05]')}>
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] font-semibold text-foreground">{t('versions.readinessTitle')}</div>
                        <span className={cn('rounded-full px-2 py-0.5 text-[9px] font-medium', readiness?.eligible ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/15 text-amber-800 dark:text-amber-200')}>
                          {readinessLoading ? t('versions.readinessChecking') : readiness?.eligible ? t('versions.readinessReady') : t('versions.readinessBlocked')}
                        </span>
                      </div>
                      {readiness?.comparisonOutcome ? <div className="mt-2 text-[10px] text-muted-foreground">{t('versions.baselineOutcome', { outcome: t(`versions.outcomes.${readiness.comparisonOutcome}`) })}</div> : null}
                      {readiness && readiness.blockers.length > 0 ? <ul className="mt-2 space-y-1 text-[10px] text-amber-900 dark:text-amber-100">{readiness.blockers.map((blocker) => <li key={blocker}>• {t(`versions.blockers.${blocker}`)}</li>)}</ul> : null}
                      {readiness?.eligible ? <p className="mt-2 text-[10px] text-emerald-800 dark:text-emerald-200">{t('versions.readinessReadyHint')}</p> : null}
                    </section>
                  ) : null}

                  {selected.validation ? (
                    <section className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.04] px-3.5 py-3">
                      <div className="text-[11px] font-semibold text-foreground">{t('versions.validationEvidence')}</div>
                      <div className="mt-2 grid gap-2 text-[10px] text-muted-foreground sm:grid-cols-2">
                        <div>{t('versions.validatedAt', { date: new Intl.DateTimeFormat(i18n.language, { dateStyle: 'medium', timeStyle: 'short' }).format(selected.validation.validatedAt) })}</div>
                        <div>{t('versions.validatedRuns', { count: selected.validation.runIds.length })}</div>
                        {selected.validation.baselineVersionId ? <div>{t('versions.validatedBaseline', { number: versions.find((version) => version.id === selected.validation?.baselineVersionId)?.number ?? '?' })}</div> : null}
                        {selected.validation.comparisonOutcome ? <div>{t('versions.baselineOutcome', { outcome: t(`versions.outcomes.${selected.validation.comparisonOutcome}`) })}</div> : null}
                      </div>
                    </section>
                  ) : null}

                  <section className="rounded-xl border border-border/60">
                    <div className="border-b border-border/50 px-3.5 py-3 text-[11px] font-medium text-foreground">{previous ? t('versions.diffFrom', { number: previous.number }) : t('versions.firstVersion')}</div>
                    {differences.length > 0 ? <div className="divide-y divide-border/40">{differences.map((difference) => <div key={difference.field} className="grid gap-2 px-3.5 py-3 lg:grid-cols-[9rem_minmax(0,1fr)]"><div className="text-[10px] font-medium text-foreground">{t(`versions.fields.${difference.field}`)}</div><div className="grid gap-2 sm:grid-cols-2"><div className="max-h-24 overflow-hidden rounded-lg bg-destructive/[0.04] p-2 font-mono text-[9px] leading-relaxed text-muted-foreground">{difference.before || '—'}</div><div className="max-h-24 overflow-hidden rounded-lg bg-emerald-500/[0.05] p-2 font-mono text-[9px] leading-relaxed text-muted-foreground">{difference.after || '—'}</div></div></div>)}</div> : <div className="px-3.5 py-8 text-center text-[10px] text-muted-foreground">{t('versions.noDiff')}</div>}
                  </section>
                </div>
              ) : null}
            </main>
          </div>
        )}
      </div>
    </div>
  )
}
