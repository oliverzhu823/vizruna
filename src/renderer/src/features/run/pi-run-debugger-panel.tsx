import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Boxes,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Database,
  ShieldCheck,
  Wrench,
  XCircle,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { PiRunDebuggerEntry, PiRunDebuggerSnapshot } from './pi-run-debugger'
import { cn } from '@renderer/lib/utils'
import { formatTokens } from '@renderer/lib/format-tokens'

function duration(value?: number): string | null {
  if (value == null) return null
  if (value < 1_000) return `${value} ms`
  return `${(value / 1_000).toFixed(value < 10_000 ? 1 : 0)} s`
}

function signedTokens(value?: number): string | null {
  if (value == null) return null
  return `${value >= 0 ? '+' : '−'}${formatTokens(Math.abs(value))}`
}

function TraceEntry({ entry }: { entry: PiRunDebuggerEntry }) {
  const { t } = useTranslation('run')
  const statusIcon =
    entry.status === 'failed' ? XCircle : entry.status === 'running' ? CircleDot : CheckCircle2
  const StatusIcon = statusIcon
  return (
    <details className="group border-b border-border/25 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-center gap-2 py-2 text-[10px] marker:hidden">
        <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
        <StatusIcon
          className={cn(
            'h-3.5 w-3.5 shrink-0',
            entry.status === 'failed'
              ? 'text-destructive'
              : entry.status === 'running'
                ? 'animate-pulse text-sky-500'
                : 'text-emerald-600 dark:text-emerald-400',
          )}
        />
        <span className="min-w-0 flex-1 truncate font-mono text-foreground">
          {entry.kind === 'compaction' ? t('debugger.compaction') : entry.label}
        </span>
        {entry.origin ? (
          <span className="rounded bg-muted/60 px-1.5 py-0.5 text-[8px] text-muted-foreground">
            {t(`debugger.origin.${entry.origin}`)}
          </span>
        ) : null}
        {duration(entry.durationMs) ? (
          <span className="tabular-nums text-muted-foreground">{duration(entry.durationMs)}</span>
        ) : null}
      </summary>
      <div className="mb-2 ml-5 rounded-md bg-muted/30 px-2.5 py-2 text-[9px] leading-relaxed text-muted-foreground">
        <div className="flex flex-wrap gap-x-3 gap-y-1">
          <span>{new Date(entry.timestamp).toLocaleTimeString()}</span>
          <span>{t(`debugger.entryStatus.${entry.status}`)}</span>
          {entry.failureLayer ? (
            <span className="text-destructive">
              {t('debugger.failureLayerLabel')}: {t(`debugger.failureLayer.${entry.failureLayer}`)}
            </span>
          ) : null}
        </div>
        {entry.summary ? (
          <p className="mt-1 break-words font-mono text-[9px] text-foreground/75">{entry.summary}</p>
        ) : (
          <p className="mt-1">{t('debugger.noDetail')}</p>
        )}
      </div>
    </details>
  )
}

export function PiRunDebuggerPanel({
  snapshot,
  running,
  model,
  contextTokens,
  contextWindow,
}: {
  snapshot: PiRunDebuggerSnapshot
  running: boolean
  model?: string
  contextTokens?: number | null
  contextWindow?: number | null
}) {
  const { t } = useTranslation('run')
  const contextBefore = snapshot.context.before?.tokens
  const contextAfter = snapshot.context.after?.tokens
  const contextEnd = contextAfter ?? (running ? contextTokens : null)
  const resourceGroups = snapshot.resources
    ? [
        { key: 'activeTools', items: snapshot.resources.activeTools },
        { key: 'skills', items: snapshot.resources.skills },
        { key: 'promptTemplates', items: snapshot.resources.promptTemplates },
        { key: 'extensions', items: snapshot.resources.extensions },
        { key: 'contextFiles', items: snapshot.resources.contextFiles },
        { key: 'systemPromptSources', items: snapshot.resources.systemPromptSources },
      ].filter((group) => group.items.length > 0)
    : []
  const resourceCount = resourceGroups.reduce((total, group) => total + group.items.length, 0)
  const stats: Array<{ key: 'tools' | 'failures' | 'compactions'; value: number; icon: LucideIcon }> = [
    { key: 'tools', value: snapshot.toolCount, icon: Wrench },
    { key: 'failures', value: snapshot.failureCount, icon: AlertTriangle },
    { key: 'compactions', value: snapshot.compactionCount, icon: Database },
  ]
  return (
    <section className="overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent">
      <div className="border-b border-border/35 p-3">
        <div className="flex items-start gap-2.5">
          <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
            <ShieldCheck className="h-3.5 w-3.5" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h3 className="text-[11px] font-semibold text-foreground">
                {t('debugger.title')}
              </h3>
              <span
                className={cn(
                  'rounded-full px-1.5 py-0.5 text-[8px] font-medium',
                  running
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {t(running ? 'debugger.live' : 'debugger.lastRun')}
              </span>
            </div>
            <p className="mt-0.5 text-[9px] leading-relaxed text-muted-foreground">
              {t('debugger.hint')}
            </p>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-2 gap-2 text-[9px]">
          <div className="rounded-md bg-background/60 p-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Boxes className="h-3 w-3" />
              {t('debugger.fixedConfig')}
            </div>
            <div className="mt-1 truncate font-medium text-foreground" title={snapshot.config.name}>
              {snapshot.config.kind === 'general' ? t('debugger.generalPi') : snapshot.config.name}
            </div>
          </div>
          <div className="rounded-md bg-background/60 p-2">
            <div className="flex items-center gap-1 text-muted-foreground">
              <Database className="h-3 w-3" />
              {t('debugger.runContext')}
            </div>
            <div className="mt-1 truncate font-mono text-foreground">
              {contextBefore != null
                ? `${formatTokens(contextBefore)} → ${contextEnd != null ? formatTokens(contextEnd) : '…'}`
                : contextTokens != null
                  ? `${formatTokens(contextTokens)}${contextWindow ? ` / ${formatTokens(contextWindow)}` : ''}`
                : '—'}
            </div>
            {snapshot.context.deltaTokens != null ? (
              <div className="mt-0.5 font-mono text-[8px] text-muted-foreground">
                {t('debugger.contextDelta')}: {signedTokens(snapshot.context.deltaTokens)}
              </div>
            ) : null}
          </div>
        </div>
        {model ? (
          <div className="mt-2 truncate font-mono text-[9px] text-muted-foreground" title={model}>
            {t('debugger.effectiveModel')}: {model}
          </div>
        ) : null}
        {snapshot.resources ? (
          <details className="group mt-2 rounded-md bg-background/60 text-[9px]">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2 py-2 marker:hidden">
              <ChevronRight className="h-3 w-3 text-muted-foreground transition-transform group-open:rotate-90" />
              <ShieldCheck className="h-3 w-3 text-primary" />
              <span className="min-w-0 flex-1 font-medium text-foreground">
                {t('debugger.loadedResources')}
              </span>
              <span className="tabular-nums text-muted-foreground">{resourceCount}</span>
            </summary>
            <div className="space-y-2 border-t border-border/30 px-2 py-2">
              {resourceGroups.length > 0 ? (
                resourceGroups.map((group) => (
                  <div key={group.key}>
                    <div className="text-[8px] text-muted-foreground">
                      {t(`debugger.resources.${group.key}`)} · {group.items.length}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {group.items.map((resource) => (
                        <span
                          key={`${resource.name}:${resource.path || ''}`}
                          className="max-w-full truncate rounded bg-muted/60 px-1.5 py-0.5 font-mono text-[8px] text-foreground/80"
                          title={[resource.path, resource.source].filter(Boolean).join('\n')}
                        >
                          {resource.name}
                        </span>
                      ))}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-muted-foreground">{t('debugger.noLoadedResources')}</p>
              )}
            </div>
          </details>
        ) : null}
      </div>

      <div className="grid grid-cols-3 border-b border-border/35 bg-background/25 text-center">
        {stats.map(({ key, value, icon: Icon }) => (
          <div key={key} className="border-r border-border/30 px-2 py-2 last:border-r-0">
            <Icon className="mx-auto h-3 w-3 text-muted-foreground" />
            <div className="mt-0.5 text-[13px] font-semibold tabular-nums text-foreground">
              {value}
            </div>
            <div className="text-[8px] text-muted-foreground">{t(`debugger.${key}`)}</div>
          </div>
        ))}
      </div>

      {snapshot.primaryFailure ? (
        <div className="border-b border-destructive/20 bg-destructive/5 px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
            <div className="min-w-0">
              <div className="text-[9px] font-medium text-destructive">
                {t('debugger.failureAt', {
                  layer: t(`debugger.failureLayer.${snapshot.primaryFailure.failureLayer || 'runtime'}`),
                })}
              </div>
              {snapshot.primaryFailure.summary ? (
                <div className="mt-0.5 truncate font-mono text-[9px] text-destructive/80">
                  {snapshot.primaryFailure.summary}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      <div className="px-3 py-1">
        {snapshot.entries.length > 0 ? (
          snapshot.entries.map((entry) => <TraceEntry key={entry.id} entry={entry} />)
        ) : (
          <p className="py-3 text-[9px] leading-relaxed text-muted-foreground">
            {t('debugger.empty')}
          </p>
        )}
      </div>
    </section>
  )
}
