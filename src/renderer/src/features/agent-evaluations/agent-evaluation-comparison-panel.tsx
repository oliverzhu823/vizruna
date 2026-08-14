import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  ArrowDownRight,
  ArrowRight,
  ArrowUpRight,
  CircleEqual,
  Clock3,
  Download,
  Gauge,
  Loader2,
  Scale,
  Wrench,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { LucideIcon } from 'lucide-react'
import type {
  AgentEvaluationComparisonOutcome,
  AgentEvaluationScenarioComparison,
  AgentEvaluationSuiteBundle,
  AgentEvaluationVersionComparison,
} from '@shared/agent-evaluation'
import type { AgentVersion } from '@shared/agent-version'
import { ipcClient } from '@renderer/lib/ipc-client'
import { saveBrowserDownload } from '@renderer/lib/browser-download'
import { cn } from '@renderer/lib/utils'

function outcomeClass(outcome: AgentEvaluationComparisonOutcome): string {
  if (outcome === 'improved') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (outcome === 'regressed') return 'border-destructive/30 bg-destructive/10 text-destructive'
  if (outcome === 'mixed') return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
  if (outcome === 'equivalent') return 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-300'
  return 'border-border bg-muted/40 text-muted-foreground'
}

function OutcomeIcon({ outcome }: { outcome: AgentEvaluationComparisonOutcome }) {
  if (outcome === 'improved') return <ArrowUpRight className="h-4 w-4" />
  if (outcome === 'regressed') return <ArrowDownRight className="h-4 w-4" />
  if (outcome === 'mixed') return <Scale className="h-4 w-4" />
  if (outcome === 'equivalent') return <CircleEqual className="h-4 w-4" />
  return <AlertTriangle className="h-4 w-4" />
}

function signed(value: number, digits = 0): string {
  const formatted = new Intl.NumberFormat(undefined, {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(Math.abs(value))
  if (value === 0) return formatted
  return `${value > 0 ? '+' : '−'}${formatted}`
}

function deltaClass(value: number | null, lowerIsBetter = true): string {
  if (value == null || value === 0) return 'text-muted-foreground'
  const better = lowerIsBetter ? value < 0 : value > 0
  return better ? 'text-emerald-700 dark:text-emerald-300' : 'text-destructive'
}

function verdictLabelKey(verdict?: string): string {
  return verdict ? `assessment.${verdict}` : 'comparison.noRun'
}

function ScenarioComparisonRow({ item }: { item: AgentEvaluationScenarioComparison }) {
  const { t } = useTranslation('evaluations')
  const durationDelta = item.baselineRun?.metrics.durationMs != null && item.candidateRun?.metrics.durationMs != null
    ? item.candidateRun.metrics.durationMs - item.baselineRun.metrics.durationMs
    : null
  const costDelta = item.baselineRun && item.candidateRun
    ? item.candidateRun.metrics.cost - item.baselineRun.metrics.cost
    : null
  return (
    <div className="grid gap-3 border-t border-border/50 px-4 py-3 first:border-t-0 lg:grid-cols-[minmax(10rem,1.4fr)_minmax(11rem,1fr)_minmax(7rem,.7fr)_minmax(7rem,.7fr)] lg:items-center">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-medium text-foreground">{item.name}</div>
        {item.reasons.length > 0 ? (
          <div className="mt-1 flex flex-wrap gap-1">
            {item.reasons.map((reason) => (
              <span key={reason} className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">
                {t(`comparison.reason.${reason}`)}
              </span>
            ))}
          </div>
        ) : null}
      </div>
      <div className="flex min-w-0 items-center gap-2 text-[10px]">
        <span className="truncate text-muted-foreground">{t(verdictLabelKey(item.baselineRun?.verdict))}</span>
        <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground/60" />
        <span className="truncate font-medium text-foreground">{t(verdictLabelKey(item.candidateRun?.verdict))}</span>
        <span className={cn('ml-auto shrink-0 rounded-full border px-2 py-0.5', outcomeClass(item.outcome))}>
          {t(`comparison.outcome.${item.outcome}`)}
        </span>
      </div>
      <div className="min-w-0 text-[10px] text-muted-foreground">
        <div className="truncate">{item.baselineRun?.modelId || '—'}</div>
        <div className="mt-0.5 truncate text-foreground-secondary">{item.candidateRun?.modelId || '—'}</div>
      </div>
      <div className="flex gap-3 text-[10px]">
        <span className={deltaClass(durationDelta)}>
          {durationDelta == null ? '—' : `${signed(durationDelta / 1000, 1)}s`}
        </span>
        <span className={deltaClass(costDelta)}>
          {costDelta == null ? '—' : `$${signed(costDelta, 4)}`}
        </span>
      </div>
    </div>
  )
}

function MetricDeltaCard({
  label,
  value,
  raw,
  lowerIsBetter,
  icon: Icon,
}: {
  label: string
  value: string
  raw: number | null
  lowerIsBetter: boolean
  icon: LucideIcon
}) {
  return (
    <div className="rounded-xl border border-border bg-background px-3 py-2.5">
      <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <div className={cn('mt-1 text-[16px] font-semibold', deltaClass(raw, lowerIsBetter))}>{value}</div>
    </div>
  )
}

export function AgentEvaluationComparisonPanel({
  candidate,
  baselineOptions,
  versions,
}: {
  candidate: AgentEvaluationSuiteBundle
  baselineOptions: AgentEvaluationSuiteBundle[]
  versions: AgentVersion[]
}) {
  const { t, i18n } = useTranslation('evaluations')
  const versionMap = useMemo(
    () => new Map(versions.map((version) => [version.id, version])),
    [versions],
  )
  const candidateVersion = candidate.suite.versionId
    ? versionMap.get(candidate.suite.versionId)
    : undefined
  const sortedOptions = useMemo(() => [...baselineOptions].sort((a, b) => {
    const aNumber = a.suite.versionId ? versionMap.get(a.suite.versionId)?.number ?? 0 : 0
    const bNumber = b.suite.versionId ? versionMap.get(b.suite.versionId)?.number ?? 0 : 0
    return bNumber - aNumber
  }), [baselineOptions, versionMap])
  const preferredBaseline = sortedOptions.find((item) => item.suite.id === candidate.suite.baselineSuiteId)
    || sortedOptions.find((item) => {
      const number = item.suite.versionId ? versionMap.get(item.suite.versionId)?.number : undefined
      return number != null && candidateVersion != null && number < candidateVersion.number
    })
    || sortedOptions[0]
  const [selectedBaselineId, setSelectedBaselineId] = useState(preferredBaseline?.suite.id || '')
  const effectiveBaselineId = sortedOptions.some((item) => item.suite.id === selectedBaselineId)
    ? selectedBaselineId
    : preferredBaseline?.suite.id || ''
  const [comparison, setComparison] = useState<AgentEvaluationVersionComparison | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportOpen, setExportOpen] = useState(false)
  const [includeContent, setIncludeContent] = useState(false)
  const [exporting, setExporting] = useState(false)

  const exportReport = async () => {
    if (!effectiveBaselineId) return
    setExporting(true)
    try {
      const response = await ipcClient.invoke('agentEvaluation.report.export', {
        baselineSuiteId: effectiveBaselineId,
        candidateSuiteId: candidate.suite.id,
        locale: i18n.resolvedLanguage?.startsWith('en') ? 'en' : 'zh',
        includeContent,
      })
      if (!saveBrowserDownload(response.download)) throw new Error('BROWSER_DOWNLOAD_UNAVAILABLE')
      setExportOpen(false)
      toast.success(t('messages.reportExported'))
    } catch (reason) {
      toast.error(t('messages.reportExportFailed'), { description: String(reason) })
    } finally {
      setExporting(false)
    }
  }

  useEffect(() => {
    if (!effectiveBaselineId) {
      setComparison(null)
      setError(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    void ipcClient.invoke('agentEvaluation.compare', {
      baselineSuiteId: effectiveBaselineId,
      candidateSuiteId: candidate.suite.id,
    }).then((response) => {
      if (!cancelled) setComparison(response.comparison)
    }).catch((reason) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [candidate.suite.id, effectiveBaselineId])

  if (sortedOptions.length === 0) return null
  const baseline = sortedOptions.find((item) => item.suite.id === effectiveBaselineId)
  const baselineVersion = baseline?.suite.versionId
    ? versionMap.get(baseline.suite.versionId)
    : undefined
  return (
    <section className="mt-6 overflow-hidden rounded-2xl border border-border bg-muted/[0.08]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div>
          <div className="flex items-center gap-2 text-[12px] font-semibold text-foreground">
            <Scale className="h-4 w-4 text-primary" />
            {t('comparison.title')}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground">{t('comparison.description')}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2 text-[10px]">
          <span className="text-muted-foreground">{t('comparison.baseline')}</span>
          <select
            value={effectiveBaselineId}
            onChange={(event) => setSelectedBaselineId(event.target.value)}
            className="rounded-lg border border-border bg-background px-3 py-2 text-[10px] text-foreground outline-none focus:border-primary/60"
          >
            {sortedOptions.map((item) => {
              const version = item.suite.versionId ? versionMap.get(item.suite.versionId) : undefined
              return <option key={item.suite.id} value={item.suite.id}>{item.suite.name} · v{version?.number ?? '?'}</option>
            })}
          </select>
          <ArrowRight className="h-3 w-3 text-muted-foreground" />
          <span className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2 font-mono text-primary">
            v{candidateVersion?.number ?? '?'}
          </span>
          <button
            type="button"
            disabled={!comparison || loading}
            onClick={() => setExportOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-3 py-2 text-foreground-secondary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Download className="h-3 w-3" />
            {t('report.action')}
          </button>
        </div>
      </div>

      {loading ? (
        <div className="flex min-h-40 items-center justify-center text-[11px] text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />{t('comparison.loading')}
        </div>
      ) : error ? (
        <div className="m-4 rounded-xl border border-destructive/25 bg-destructive/5 px-4 py-3 text-[11px] text-destructive">{error}</div>
      ) : comparison ? (
        <>
          <div className="grid gap-3 px-5 py-4 md:grid-cols-2 xl:grid-cols-[1.35fr_repeat(5,1fr)]">
            <div className={cn('rounded-xl border p-3', outcomeClass(comparison.outcome))}>
              <div className="flex items-center gap-2 text-[11px] font-semibold">
                <OutcomeIcon outcome={comparison.outcome} />
                {t(`comparison.outcome.${comparison.outcome}`)}
              </div>
              <p className="mt-1 text-[9px] leading-relaxed opacity-80">
                {t(`comparison.explanation.${comparison.outcome}`)}
              </p>
            </div>
            <MetricDeltaCard label={t('comparison.metric.passRate')} value={comparison.delta.passRatePoints == null ? '—' : `${signed(comparison.delta.passRatePoints, 0)} pp`} raw={comparison.delta.passRatePoints} lowerIsBetter={false} icon={Gauge} />
            <MetricDeltaCard label={t('comparison.metric.duration')} value={comparison.delta.averageDurationMs == null ? '—' : `${signed(comparison.delta.averageDurationMs / 1000, 1)}s`} raw={comparison.delta.averageDurationMs} lowerIsBetter icon={Clock3} />
            <MetricDeltaCard label={t('comparison.metric.tokens')} value={signed(comparison.delta.inputTokens + comparison.delta.outputTokens)} raw={comparison.delta.inputTokens + comparison.delta.outputTokens} lowerIsBetter icon={Gauge} />
            <MetricDeltaCard label={t('comparison.metric.cost')} value={`$${signed(comparison.delta.cost, 4)}`} raw={comparison.delta.cost} lowerIsBetter icon={Gauge} />
            <MetricDeltaCard label={t('comparison.metric.toolFailures')} value={signed(comparison.delta.failedToolCalls)} raw={comparison.delta.failedToolCalls} lowerIsBetter icon={Wrench} />
          </div>
          <div className="mx-5 mb-4 flex flex-wrap gap-2 text-[9px] text-muted-foreground">
            <span>{t('comparison.versionPair', { baseline: baselineVersion?.number ?? '?', candidate: candidateVersion?.number ?? '?' })}</span>
            <span>·</span>
            <span>{t('comparison.pairedRuns', { count: comparison.pairedRuns })}</span>
            <span>·</span>
            <span>{t('comparison.counts', comparison.counts)}</span>
          </div>
          <div className="border-t border-border/60">
            <div className="hidden grid-cols-[minmax(10rem,1.4fr)_minmax(11rem,1fr)_minmax(7rem,.7fr)_minmax(7rem,.7fr)] gap-3 bg-muted/20 px-4 py-2 text-[9px] font-medium uppercase tracking-wide text-muted-foreground lg:grid">
              <span>{t('comparison.columns.task')}</span>
              <span>{t('comparison.columns.verdict')}</span>
              <span>{t('comparison.columns.model')}</span>
              <span>{t('comparison.columns.delta')}</span>
            </div>
            {comparison.scenarios.map((item) => <ScenarioComparisonRow key={item.key} item={item} />)}
          </div>
        </>
      ) : null}
      {exportOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[1px]">
          <div role="dialog" aria-modal="true" aria-label={t('report.title')} className="w-full max-w-lg rounded-2xl border border-border bg-background shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
              <div>
                <h2 className="text-[16px] font-semibold text-foreground">{t('report.title')}</h2>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{t('report.description')}</p>
              </div>
              <button type="button" onClick={() => setExportOpen(false)} className="rounded-md p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
            </div>
            <div className="space-y-4 p-5">
              <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">{t('report.safeSummary')}</div>
              <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-border px-4 py-3">
                <input type="checkbox" checked={includeContent} onChange={(event) => setIncludeContent(event.target.checked)} className="mt-0.5 h-4 w-4" />
                <span>
                  <span className="block text-[11px] font-medium text-foreground">{t('report.includeContent')}</span>
                  <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">{t('report.includeContentWarning')}</span>
                </span>
              </label>
              <div className="flex justify-end gap-2 pt-1">
                <button type="button" onClick={() => setExportOpen(false)} className="rounded-lg border border-border px-3 py-2 text-[11px] text-muted-foreground hover:bg-accent">{t('common:cancel')}</button>
                <button type="button" onClick={() => void exportReport()} disabled={exporting} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground disabled:opacity-50">
                  {exporting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  {t('report.download')}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  )
}
