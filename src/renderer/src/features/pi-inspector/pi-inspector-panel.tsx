import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Bot,
  Braces,
  CheckCircle2,
  ChevronDown,
  CircleDot,
  FileText,
  Gauge,
  KeyRound,
  Network,
  Layers3,
  Orbit,
  Package,
  RefreshCw,
  Route,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Wrench,
} from 'lucide-react'
import type {
  PiInspectorNamedResource,
  PiInspectorSnapshot,
  PiPromptDocumentResponse,
} from '@shared/pi-inspector'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

type ResourceKind = keyof PiInspectorSnapshot['resources']

const RESOURCE_KINDS: Array<{ kind: ResourceKind; icon: typeof Wrench }> = [
  { kind: 'tools', icon: Wrench },
  { kind: 'skills', icon: Sparkles },
  { kind: 'extensions', icon: Braces },
  { kind: 'prompts', icon: FileText },
  { kind: 'packages', icon: Package },
]

function ValueCell({ label, value, icon: Icon }: { label: string; value: string; icon: typeof Gauge }) {
  return (
    <div className="min-w-0 rounded-xl border border-border/45 bg-card/35 px-2.5 py-2.5">
      <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.09em] text-muted-foreground/70">
        <Icon className="h-3 w-3" />
        <span>{label}</span>
      </div>
      <div className="mt-1.5 truncate text-[12px] font-medium text-foreground" title={value}>
        {value}
      </div>
    </div>
  )
}

function ResourceRow({ resource }: { resource: PiInspectorNamedResource }) {
  const { t } = useTranslation('piInspector')
  const state = !resource.enabled ? 'disabled' : resource.loaded ? 'loaded' : 'configured'
  return (
    <div className="[content-visibility:auto] border-b border-border/35 px-3 py-2.5 last:border-b-0">
      <div className="flex items-start gap-2">
        <span
          className={cn(
            'mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full',
            state === 'loaded'
              ? 'bg-emerald-500'
              : state === 'configured'
                ? 'bg-amber-500'
                : 'bg-muted-foreground/35',
          )}
        />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[12px] font-medium text-foreground" title={resource.name}>
              {resource.name}
            </span>
            <span className="shrink-0 text-[9px] uppercase tracking-wide text-muted-foreground/60">
              {t(`resourceState.${state}`)}
            </span>
          </div>
          <div className="mt-0.5 flex flex-wrap gap-1 text-[9px] text-muted-foreground/70">
            <span>{t(`scope.${resource.source}`)}</span>
            {resource.version ? <span>· v{resource.version}</span> : null}
            {resource.tools?.length ? <span>· {t('toolCount', { count: resource.tools.length })}</span> : null}
            {resource.commands?.length ? <span>· {t('commandCount', { count: resource.commands.length })}</span> : null}
          </div>
          {resource.error ? (
            <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-amber-700 dark:text-amber-300">
              {resource.error}
            </p>
          ) : resource.description ? (
            <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/75">
              {resource.description}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

export function PiInspectorPanel() {
  const { t } = useTranslation('piInspector')
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const currentSessionId = useUIStore((state) => state.currentSessionId)
  const sessions = useUIStore((state) => state.sessions)
  const historySessionFile = useUIStore((state) => state.historySessionFile)
  const runStatus = useUIStore((state) => state.runState.status)
  const [snapshot, setSnapshot] = useState<PiInspectorSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [resourceKind, setResourceKind] = useState<ResourceKind>('tools')
  const [promptDocument, setPromptDocument] = useState<PiPromptDocumentResponse | null>(null)
  const [promptLoading, setPromptLoading] = useState(false)

  const currentSessionFile = useMemo(
    () =>
      historySessionFile ||
      sessions.find((session) => session.sessionId === currentSessionId)?.sessionFile,
    [currentSessionId, historySessionFile, sessions],
  )

  const refresh = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await ipcClient.invoke('pi.inspector.get', {
        workspaceId: currentWorkspace || undefined,
        sessionId: currentSessionId || undefined,
        sessionFile: currentSessionFile,
      })
      setSnapshot(response.snapshot)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [currentSessionFile, currentSessionId, currentWorkspace])

  const loadPromptDocument = useCallback(async () => {
    if (promptDocument || promptLoading) return
    setPromptLoading(true)
    try {
      const response = await ipcClient.invoke('pi.inspector.prompt', {
        workspaceId: currentWorkspace || undefined,
        sessionId: currentSessionId || undefined,
        sessionFile: currentSessionFile,
      })
      setPromptDocument(response)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setPromptLoading(false)
    }
  }, [currentSessionFile, currentSessionId, currentWorkspace, promptDocument, promptLoading])

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void ipcClient
      .invoke('pi.inspector.get', {
        workspaceId: currentWorkspace || undefined,
        sessionId: currentSessionId || undefined,
        sessionFile: currentSessionFile,
      })
      .then((response) => {
        if (!cancelled) setSnapshot(response.snapshot)
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [currentSessionFile, currentSessionId, currentWorkspace, runStatus])

  useEffect(() => {
    setPromptDocument(null)
  }, [currentSessionFile, currentSessionId, currentWorkspace, runStatus])

  const resources = snapshot?.resources[resourceKind] || []
  const loadedCount = resources.filter((resource) => resource.loaded).length
  const thinkingDisplay = snapshot?.runtime.thinkingLevel
    ? t(`thinkingLevel.${snapshot.runtime.thinkingLevel}`, {
        defaultValue: snapshot.runtime.thinkingLevel,
      })
    : '—'
  const routeDisplay = snapshot?.runtime.route
    ? snapshot.runtime.route.mode === 'profile'
      ? snapshot.runtime.route.label
      : t(`routeMode.${snapshot.runtime.route.mode}`)
    : t('notAvailable')

  return (
    <div className="scrollbar-overlay flex h-full flex-col overflow-y-auto bg-background">
      <header className="sticky top-0 z-10 border-b border-border/45 bg-background/95 px-3 py-3 backdrop-blur">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Orbit className="h-4 w-4" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[13px] font-semibold text-foreground">{t('title')}</h2>
              <p className="truncate text-[10px] text-muted-foreground">{t('subtitle')}</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => window.dispatchEvent(new CustomEvent('vizruna:open-pi-resources'))}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-[10px] text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
              title={t('manage')}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              {t('manage')}
            </button>
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={loading}
              className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
              title={t('refresh')}
            >
              <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            </button>
          </div>
        </div>
      </header>

      {error ? (
        <div className="m-3 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive">
          {t('loadFailed')}: {error}
        </div>
      ) : null}

      {!snapshot && loading ? (
        <div className="flex flex-1 items-center justify-center text-[11px] text-muted-foreground">
          {t('loading')}
        </div>
      ) : snapshot ? (
        <div className="space-y-3 p-3">
          <section className="overflow-hidden rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] to-transparent p-3.5">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 text-[10px] font-medium uppercase tracking-[0.12em] text-primary">
                  <Bot className="h-3 w-3" />
                  {t(`configurationKind.${snapshot.configuration.kind}`)}
                </div>
                <h3 className="mt-1.5 truncate text-[15px] font-semibold text-foreground" title={snapshot.configuration.name}>
                  {snapshot.configuration.kind === 'general'
                    ? t('configurationKind.general')
                    : snapshot.configuration.name}
                </h3>
                {snapshot.configuration.description ? (
                  <p className="mt-1 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground">
                    {snapshot.configuration.description}
                  </p>
                ) : null}
                {snapshot.configuration.kind === 'agent' ? (
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-muted-foreground">
                    <span className="rounded-md bg-background/65 px-1.5 py-1">
                      {t(`resourceMode.${snapshot.configuration.resourceMode}`)}
                      {snapshot.configuration.resolvedResourceCount !== undefined
                        ? ` · ${snapshot.configuration.resolvedResourceCount}`
                        : ''}
                    </span>
                    <span className="rounded-md bg-background/65 px-1.5 py-1">
                      {t(`projectContextMode.${snapshot.configuration.projectContextMode}`)}
                    </span>
                    {snapshot.configuration.toolsMode === 'custom' ? (
                      <span className="rounded-md bg-background/65 px-1.5 py-1">
                        {t(`extensionToolsMode.${snapshot.configuration.extensionToolsMode}`, {
                          count: snapshot.configuration.extensionToolCount ?? 0,
                        })}
                      </span>
                    ) : null}
                    {snapshot.configuration.providerRequirements?.reasoning ? (
                      <span className="rounded-md bg-background/65 px-1.5 py-1">
                        {t('providerRequirements.reasoning')}
                      </span>
                    ) : null}
                    {snapshot.configuration.providerRequirements?.imageInput ? (
                      <span className="rounded-md bg-background/65 px-1.5 py-1">
                        {t('providerRequirements.imageInput')}
                      </span>
                    ) : null}
                    {snapshot.configuration.providerRequirements?.minContextWindow ? (
                      <span className="rounded-md bg-background/65 px-1.5 py-1 font-mono">
                        ≥ {snapshot.configuration.providerRequirements.minContextWindow.toLocaleString()} tokens
                      </span>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <span
                className={cn(
                  'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[9px] font-medium',
                  snapshot.session.loaded
                    ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                <CircleDot className={cn('h-2.5 w-2.5', snapshot.session.running && 'animate-pulse')} />
                {snapshot.session.running
                  ? t('status.running')
                  : snapshot.session.loaded
                    ? t('status.ready')
                    : t('status.offline')}
              </span>
            </div>
          </section>

          <section className="grid grid-cols-2 gap-2">
            <ValueCell label={t('model')} value={snapshot.runtime.model || t('notSelected')} icon={Gauge} />
            <ValueCell label={t('thinking')} value={thinkingDisplay} icon={Sparkles} />
            <ValueCell label={t('sdk')} value={snapshot.runtime.sdkVersion || '—'} icon={Orbit} />
            <ValueCell
              label={t('route')}
              value={routeDisplay}
              icon={Route}
            />
          </section>

          <section className="grid grid-cols-2 gap-2">
            <ValueCell
              label={t('authentication')}
              value={
                snapshot.runtime.auth
                  ? snapshot.runtime.auth.configured
                    ? t(`authType.${snapshot.runtime.auth.type || 'configured'}`)
                    : t('notConfigured')
                  : t('notAvailable')
              }
              icon={KeyRound}
            />
            <ValueCell
              label={t('projectTrust')}
              value={snapshot.runtime.projectTrusted ? t('trusted') : t('untrusted')}
              icon={ShieldCheck}
            />
          </section>

          {snapshot.warnings.length > 0 ? (
            <section className="overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/[0.06]">
              {snapshot.warnings.map((warning) => (
                <div key={`${warning.code}-${warning.resourceId || ''}`} className="flex gap-2 border-b border-amber-500/15 px-3 py-2.5 last:border-b-0">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-300" />
                  <div>
                    <div className="text-[11px] font-medium text-amber-900 dark:text-amber-100">
                      {t(`warning.${warning.code}`)}
                    </div>
                    {warning.resourceId ? (
                      <p className="mt-0.5 text-[10px] leading-relaxed text-amber-800/75 dark:text-amber-200/75">
                        {warning.message}
                      </p>
                    ) : null}
                  </div>
                </div>
              ))}
            </section>
          ) : (
            <section className="flex items-center gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/[0.05] px-3 py-2.5 text-[10px] text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="h-3.5 w-3.5" />
              {t('noWarnings')}
            </section>
          )}

          <details open className="group overflow-hidden rounded-xl border border-border/50 bg-card/20">
            <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
                <Network className="h-3.5 w-3.5 text-primary" />
                {t('context.title')}
              </div>
              <div className="flex items-center gap-1.5 text-[9px] text-muted-foreground">
                {t('context.sourceCount', { count: snapshot.context.sources.length })}
                <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" />
              </div>
            </summary>
            <div className="border-t border-border/40">
              {snapshot.context.sources.length ? (
                snapshot.context.sources.map((source, index) => (
                  <div key={`${source.kind}-${source.path || source.label}-${index}`} className="flex items-start gap-2 border-b border-border/30 px-3 py-2 last:border-b-0">
                    <FileText className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[11px] font-medium text-foreground" title={source.path || source.label}>
                        {source.label}
                      </div>
                      <div className="text-[9px] text-muted-foreground">
                        {t(`context.kind.${source.kind}`)}
                        {source.mode ? ` · ${t(`promptMode.${source.mode}`)}` : ''}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="px-3 py-3 text-[10px] text-muted-foreground">{t('context.empty')}</p>
              )}
              {snapshot.context.sections.length ? (
                <div className="border-t border-border/40 px-3 py-2.5">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5 text-[10px] font-semibold text-foreground">
                      <Layers3 className="h-3.5 w-3.5 text-primary" />
                      {t('context.manifest')}
                    </div>
                    <span className="text-[9px] tabular-nums text-muted-foreground">
                      {t('context.budget', {
                        chars: snapshot.context.systemPromptChars.toLocaleString(),
                        tokens: snapshot.context.estimatedTokens.toLocaleString(),
                      })}
                    </span>
                  </div>
                  {snapshot.context.promptContract ? (
                    <div className="mb-2 flex items-center justify-between gap-2 rounded-lg bg-primary/[0.06] px-2.5 py-1.5 text-[9px] text-primary">
                      <span>{t('context.contractVersion', { version: snapshot.context.promptContract.version })}</span>
                      <span className="font-mono" title={snapshot.context.promptContract.requestDigest}>
                        {snapshot.context.promptContract.requestDigest.slice(7, 19)}
                      </span>
                    </div>
                  ) : null}
                  <div className="space-y-1.5">
                    {snapshot.context.sections.map((section) => (
                      <div key={section.id} className="rounded-lg border border-border/35 bg-background/40 px-2.5 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-1.5">
                            <span className={cn(
                              'h-1.5 w-1.5 shrink-0 rounded-full',
                              section.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/25',
                            )} />
                            <span className="truncate text-[10px] font-medium text-foreground">
                              {t(`context.section.${section.id}`, { defaultValue: section.label })}
                            </span>
                          </div>
                          <div className="flex shrink-0 items-center gap-1.5 text-[9px] tabular-nums text-muted-foreground">
                            <span>{t(`context.manifestState.${section.enabled ? 'active' : 'inactive'}`)}</span>
                            <span>·</span>
                            <span>{section.charCount.toLocaleString()} · ~{section.estimatedTokens.toLocaleString()}t</span>
                          </div>
                        </div>
                        <div className="mt-0.5 flex items-center gap-1.5 text-[9px] text-muted-foreground/75">
                          <span>{t(`context.owner.${section.owner}`)}</span>
                          <span>·</span>
                          {section.stability ? (
                            <>
                              <span>{t(`context.stability.${section.stability}`)}</span>
                              <span>·</span>
                            </>
                          ) : null}
                          <span className="truncate" title={t(`context.activation.${section.id}`, { defaultValue: section.activation })}>
                            {t(`context.activation.${section.id}`, { defaultValue: section.activation })}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                  {snapshot.context.skillDiscovery ? (
                    <p className="mt-2 rounded-lg bg-primary/[0.06] px-2.5 py-2 text-[9px] leading-relaxed text-primary">
                      {snapshot.context.skillDiscovery.mode === 'on-demand'
                        ? t('context.skillOnDemand', {
                            count: snapshot.context.skillDiscovery.searchableCount,
                            searched: snapshot.context.skillDiscovery.searchCount || 0,
                            loaded: snapshot.context.skillDiscovery.loadCount || 0,
                          })
                        : t('context.skillFixed', {
                            count: snapshot.context.skillDiscovery.promptSkillCount,
                          })}
                    </p>
                  ) : null}
                </div>
              ) : null}
              {snapshot.context.systemPromptChars > 0 ? (
                <details
                  className="border-t border-border/40"
                  onToggle={(event) => {
                    if (event.currentTarget.open) void loadPromptDocument()
                  }}
                >
                  <summary className="cursor-pointer px-3 py-2 text-[10px] font-medium text-primary">
                    {t('context.preview', { count: snapshot.context.systemPromptChars })}
                  </summary>
                  {promptLoading ? (
                    <p className="border-t border-border/30 px-3 py-3 text-[9px] text-muted-foreground">{t('loading')}</p>
                  ) : promptDocument ? (
                    <pre className="max-h-80 overflow-auto whitespace-pre-wrap border-t border-border/30 bg-muted/20 px-3 py-2.5 font-mono text-[9px] leading-relaxed text-muted-foreground">
                      {promptDocument.text}
                    </pre>
                  ) : null}
                </details>
              ) : null}
            </div>
          </details>

          <section className="overflow-hidden rounded-xl border border-border/50 bg-card/20">
            <div className="border-b border-border/40 px-3 py-2.5">
              <div className="flex items-center gap-2 text-[11px] font-semibold text-foreground">
                <TerminalSquare className="h-3.5 w-3.5 text-primary" />
                {t('resources.title')}
              </div>
              <p className="mt-0.5 text-[9px] text-muted-foreground">{t('resources.description')}</p>
            </div>
            <div className="scrollbar-overlay flex overflow-x-auto border-b border-border/40 p-1.5">
              {RESOURCE_KINDS.map(({ kind, icon: Icon }) => {
                const count = snapshot.resources[kind].length
                return (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => setResourceKind(kind)}
                    className={cn(
                      'flex shrink-0 items-center gap-1 rounded-lg px-2 py-1.5 text-[9px] font-medium transition-colors',
                      resourceKind === kind
                        ? 'bg-primary/10 text-primary'
                        : 'text-muted-foreground hover:bg-accent hover:text-foreground',
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {t(`resources.${kind}`)}
                    <span className="tabular-nums opacity-70">{count}</span>
                  </button>
                )
              })}
            </div>
            <div className="flex items-center justify-between bg-muted/10 px-3 py-1.5 text-[9px] text-muted-foreground">
              <span>{t(`resources.${resourceKind}`)}</span>
              <span>{t('loadedSummary', { loaded: loadedCount, count: resources.length })}</span>
            </div>
            {resources.length ? (
              resources.map((resource) => <ResourceRow key={resource.id} resource={resource} />)
            ) : (
              <p className="px-3 py-4 text-center text-[10px] text-muted-foreground">
                {t('resources.empty')}
              </p>
            )}
          </section>
        </div>
      ) : null}
    </div>
  )
}
