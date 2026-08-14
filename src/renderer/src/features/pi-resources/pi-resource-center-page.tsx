import { lazy, Suspense, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  Boxes,
  Braces,
  FileText,
  FolderGit2,
  Layers3,
  Orbit,
  Package,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Wrench,
} from 'lucide-react'
import type {
  PiResourceCenterItem,
  PiResourceCenterKind,
  PiResourceCenterSnapshot,
} from '@shared/pi-resource-center'
import { SettingsPageHeader } from '@renderer/features/settings/settings-shell'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

const SkillsSettingsPanel = lazy(() =>
  import('@renderer/features/settings/skills-settings-panel').then((module) => ({
    default: module.SkillsSettingsPanel,
  })),
)
const ExtensionsSettings = lazy(() =>
  import('@renderer/features/settings/settings-extensions-panel').then((module) => ({
    default: module.ExtensionsSettings,
  })),
)
const PiPromptResourcesPanel = lazy(() =>
  import('@renderer/features/settings/prompts-settings-panel').then((module) => ({
    default: module.PiPromptResourcesPanel,
  })),
)
const PiPackagesPanel = lazy(() =>
  import('./pi-packages-panel').then((module) => ({
    default: module.PiPackagesPanel,
  })),
)

type Section = 'overview' | 'packages' | 'skills' | 'extensions' | 'prompts' | 'themes'

const SECTIONS: Array<{ id: Section; icon: typeof Orbit }> = [
  { id: 'overview', icon: Orbit },
  { id: 'packages', icon: Package },
  { id: 'skills', icon: Sparkles },
  { id: 'extensions', icon: Braces },
  { id: 'prompts', icon: FileText },
  { id: 'themes', icon: Layers3 },
]

function LoadingPanel() {
  const { t } = useTranslation('piResources')
  return <div className="py-12 text-center text-[12px] text-muted-foreground">{t('loading')}</div>
}

function MetricCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof Orbit
  label: string
  value: string | number
  detail?: string
}) {
  return (
    <div className="rounded-2xl border border-border/55 bg-card/35 p-3.5">
      <div className="flex items-center gap-2 text-[10px] font-medium uppercase tracking-[0.08em] text-muted-foreground/70">
        <Icon className="h-3.5 w-3.5 text-primary/75" />
        {label}
      </div>
      <div className="mt-2 text-[20px] font-semibold tracking-tight text-foreground">{value}</div>
      {detail ? <div className="mt-0.5 text-[10px] text-muted-foreground/65">{detail}</div> : null}
    </div>
  )
}

function Overview({ snapshot }: { snapshot: PiResourceCenterSnapshot }) {
  const { t } = useTranslation('piResources')
  const userResources =
    snapshot.summary.extensions +
    snapshot.summary.skills +
    snapshot.summary.prompts +
    snapshot.summary.themes -
    snapshot.summary.projectResources
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          icon={Package}
          label={t('metrics.packages')}
          value={snapshot.summary.packages}
          detail={t('metrics.installed', { count: snapshot.summary.installedPackages })}
        />
        <MetricCard
          icon={Wrench}
          label={t('metrics.resources')}
          value={snapshot.summary.enabledResources}
          detail={t('metrics.enabled')}
        />
        <MetricCard
          icon={FolderGit2}
          label={t('metrics.project')}
          value={snapshot.summary.projectResources}
          detail={snapshot.runtime.projectTrusted ? t('trusted') : t('untrusted')}
        />
        <MetricCard
          icon={Boxes}
          label={t('metrics.user')}
          value={Math.max(0, userResources)}
          detail={t('metrics.userDetail')}
        />
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1.2fr)_minmax(260px,0.8fr)]">
        <section className="rounded-2xl border border-border/55 bg-card/25 p-4">
          <div className="flex items-center gap-2">
            <Orbit className="h-4 w-4 text-primary" />
            <h3 className="text-[13px] font-semibold">{t('composition.title')}</h3>
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-muted-foreground/70">
            {t('composition.description')}
          </p>
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {(['extensions', 'skills', 'prompts', 'themes'] as PiResourceCenterKind[]).map((kind) => (
              <div key={kind} className="rounded-xl bg-muted/35 px-3 py-2.5">
                <div className="text-[10px] text-muted-foreground">{t(`section.${kind}`)}</div>
                <div className="mt-1 text-[16px] font-semibold">{snapshot.summary[kind]}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-2xl border border-border/55 bg-card/25 p-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-primary" />
            <h3 className="text-[13px] font-semibold">{t('runtime.title')}</h3>
          </div>
          <dl className="mt-3 space-y-2 text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t('runtime.sdk')}</dt>
              <dd className="font-mono font-medium">{snapshot.runtime.sdkVersion || '—'}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t('runtime.worker')}</dt>
              <dd>{snapshot.runtime.workerLoaded ? t('runtime.loaded') : t('runtime.notLoaded')}</dd>
            </div>
            <div className="flex items-center justify-between gap-3">
              <dt className="text-muted-foreground">{t('runtime.scope')}</dt>
              <dd className="max-w-[70%] truncate font-mono" title={snapshot.workspacePath}>
                {snapshot.workspacePath}
              </dd>
            </div>
          </dl>
          <p className="mt-3 border-t border-border/40 pt-3 text-[10px] leading-relaxed text-muted-foreground/65">
            {t('runtime.inspectorHint')}
          </p>
        </section>
      </div>
    </div>
  )
}

function ThemesPanel({ rows }: { rows: PiResourceCenterItem[] }) {
  const { t } = useTranslation('piResources')
  if (rows.length === 0) {
    return <div className="rounded-xl border border-dashed border-border/70 py-12 text-center text-[12px] text-muted-foreground">{t('themes.empty')}</div>
  }
  return (
    <div className="overflow-hidden rounded-xl border border-border/55 bg-card/25">
      {rows.map((row) => (
        <div key={row.id} className="[content-visibility:auto] flex items-center gap-3 border-b border-border/40 px-4 py-3 last:border-0">
          <Layers3 className="h-4 w-4 shrink-0 text-primary/70" />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium">{row.name}</div>
            <div className="truncate font-mono text-[9px] text-muted-foreground/55" title={row.path}>{row.path}</div>
          </div>
          <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[9px] text-muted-foreground">{t(`scope.${row.scope}`)}</span>
          <span className={cn('h-2 w-2 shrink-0 rounded-full', row.enabled ? 'bg-emerald-500' : 'bg-muted-foreground/30')} />
        </div>
      ))}
    </div>
  )
}

export function PiResourceCenterPage() {
  const { t } = useTranslation('piResources')
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const [section, setSection] = useState<Section>('overview')
  const [snapshot, setSnapshot] = useState<PiResourceCenterSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await ipcClient.invoke('pi.resources.center.get', {
        workspaceId: currentWorkspace || undefined,
      })
      setSnapshot(response.snapshot)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setLoading(false)
    }
  }, [currentWorkspace])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <div className="w-full space-y-5">
      <SettingsPageHeader
        title={t('title')}
        description={t('description')}
        action={(
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[11px] hover:bg-accent disabled:opacity-50"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
            {t('refresh')}
          </button>
        )}
      />

      <div className="flex flex-wrap gap-1 rounded-xl border border-border/55 bg-muted/20 p-1">
        {SECTIONS.map(({ id, icon: Icon }) => {
          const count = snapshot
            ? id === 'packages'
              ? snapshot.summary.packages
              : id === 'skills' || id === 'extensions' || id === 'themes'
                ? snapshot.summary[id]
                : undefined
            : undefined
          return (
            <button
              key={id}
              type="button"
              onClick={() => setSection(id)}
              className={cn(
                'inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] transition-colors',
                section === id
                  ? 'bg-background font-medium text-foreground shadow-sm'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {t(`tab.${id}`)}
              {count !== undefined ? <span className="text-[9px] opacity-60">{count}</span> : null}
            </button>
          )
        })}
      </div>

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive">
          {t('loadFailed')}: {error}
        </div>
      ) : null}

      {snapshot?.warnings.length ? (
        <div className="overflow-hidden rounded-xl border border-amber-500/25 bg-amber-500/[0.05]">
          {snapshot.warnings.map((warning, index) => (
            <div key={`${warning.code}-${warning.packageId || index}`} className="flex gap-2 border-b border-amber-500/15 px-3 py-2.5 last:border-0">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600" />
              <div className="min-w-0 text-[10px] text-amber-900 dark:text-amber-100">
                <div className="font-medium">{t(`warning.${warning.code}`)}</div>
                {warning.packageId ? <div className="mt-0.5 truncate font-mono opacity-70">{warning.packageId.replace(/^(user|project):/, '')}</div> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}

      {!snapshot && loading ? <LoadingPanel /> : snapshot ? (
        <Suspense fallback={<LoadingPanel />}>
          {section === 'overview' ? <Overview snapshot={snapshot} /> : null}
          {section === 'packages' ? (
            <PiPackagesPanel snapshot={snapshot} onSnapshotChange={setSnapshot} />
          ) : null}
          {section === 'skills' ? <SkillsSettingsPanel /> : null}
          {section === 'extensions' ? <ExtensionsSettings /> : null}
          {section === 'prompts' ? <PiPromptResourcesPanel /> : null}
          {section === 'themes' ? <ThemesPanel rows={snapshot.resources.themes} /> : null}
        </Suspense>
      ) : null}
    </div>
  )
}
