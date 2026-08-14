import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  LoaderCircle,
  PackagePlus,
  RefreshCw,
  RotateCw,
  Trash2,
} from 'lucide-react'
import type {
  PiPackageMutationProgress,
  PiPackageMutationRequest,
  PiResourceCenterItem,
  PiResourceCenterKind,
  PiResourceCenterPackage,
  PiResourceCenterSnapshot,
} from '@shared/pi-resource-center'
import { Switch } from '@renderer/components/ui/switch'
import { ConfirmDialog } from '@renderer/features/settings/confirm-dialog'
import { ipcClient, onPiResourceOperationProgress } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'

type PendingConfirmation = {
  title: string
  message: string
  destructive?: boolean
  request: PiPackageMutationRequest
}

type BusyMutation = {
  action: PiPackageMutationRequest['action']
  source: string
}

function PackageResourceCounts({ pkg }: { pkg: PiResourceCenterPackage }) {
  const { t } = useTranslation('piResources')
  return (
    <span className="flex flex-wrap gap-1">
      {(Object.keys(pkg.resources) as PiResourceCenterKind[]).map((kind) =>
        pkg.resources[kind] > 0 ? (
          <span key={kind} className="rounded-md bg-muted/55 px-1.5 py-0.5 text-[9px] text-muted-foreground">
            {t(`section.${kind}`)} {pkg.resources[kind]}
          </span>
        ) : null,
      )}
    </span>
  )
}

function packageResources(
  snapshot: PiResourceCenterSnapshot,
  packageId: string,
): PiResourceCenterItem[] {
  const result: PiResourceCenterItem[] = []
  for (const kind of ['extensions', 'skills', 'prompts', 'themes'] as PiResourceCenterKind[]) {
    for (const resource of snapshot.resources[kind]) {
      if (resource.packageId === packageId) result.push(resource)
    }
  }
  return result
}

function PackageResources({
  rows,
  busyResourceId,
  onToggle,
}: {
  rows: PiResourceCenterItem[]
  busyResourceId: string | null
  onToggle: (resource: PiResourceCenterItem, enabled: boolean) => void
}) {
  const { t } = useTranslation('piResources')
  if (rows.length === 0) {
    return <p className="py-3 text-[10px] text-muted-foreground">{t('packages.noResolvedResources')}</p>
  }
  return (
    <div className="mt-3 overflow-hidden rounded-lg border border-border/45 bg-background/45">
      {rows.map((resource) => (
        <div
          key={resource.id}
          className="[content-visibility:auto] flex items-center gap-3 border-b border-border/35 px-3 py-2 last:border-0"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-[11px] font-medium">{resource.name}</span>
              <span className="rounded bg-muted px-1.5 py-0.5 text-[8px] text-muted-foreground">
                {t(`section.${resource.kind}`)}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/55" title={resource.relativePath || resource.path}>
              {resource.relativePath || resource.path}
            </div>
          </div>
          {busyResourceId === resource.id ? <LoaderCircle className="h-3.5 w-3.5 animate-spin text-primary" /> : null}
          <Switch
            checked={resource.enabled}
            disabled={!resource.configurable || busyResourceId !== null}
            aria-label={t('packages.resourceToggle', { name: resource.name })}
            onCheckedChange={(enabled) => onToggle(resource, enabled)}
          />
        </div>
      ))}
    </div>
  )
}

export function PiPackagesPanel({
  snapshot,
  onSnapshotChange,
}: {
  snapshot: PiResourceCenterSnapshot
  onSnapshotChange: (snapshot: PiResourceCenterSnapshot) => void
}) {
  const { t } = useTranslation('piResources')
  const [source, setSource] = useState('')
  const [scope, setScope] = useState<'user' | 'project'>('user')
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const [confirmation, setConfirmation] = useState<PendingConfirmation | null>(null)
  const [busy, setBusy] = useState<BusyMutation | null>(null)
  const busyRef = useRef<BusyMutation | null>(null)
  const activeOperationId = useRef<string | null>(null)
  const [progress, setProgress] = useState<PiPackageMutationProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busyResourceId, setBusyResourceId] = useState<string | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updates, setUpdates] = useState<Set<string> | null>(null)
  const [reloadDeferred, setReloadDeferred] = useState(false)

  useEffect(() => onPiResourceOperationProgress((event) => {
    if (!busyRef.current) return
    if (!activeOperationId.current) activeOperationId.current = event.operationId
    if (activeOperationId.current === event.operationId) setProgress(event)
  }), [])

  const resourcesByPackage = useMemo(() => new Map(
    snapshot.packages.map((pkg) => [pkg.id, packageResources(snapshot, pkg.id)]),
  ), [snapshot])

  const runMutation = useCallback(async (request: PiPackageMutationRequest) => {
    const mutationSource = request.action === 'install'
      ? request.source
      : snapshot.packages.find((pkg) => pkg.id === request.packageId)?.source || request.packageId
    const nextBusy = { action: request.action, source: mutationSource } as BusyMutation
    busyRef.current = nextBusy
    activeOperationId.current = null
    setBusy(nextBusy)
    setProgress(null)
    setError(null)
    try {
      const response = await ipcClient.invoke('pi.resources.package.mutate', request)
      onSnapshotChange(response.snapshot)
      setReloadDeferred(response.workerReload === 'deferred')
      if (request.action === 'install') setSource('')
      setUpdates(null)
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      busyRef.current = null
      activeOperationId.current = null
      setBusy(null)
    }
  }, [onSnapshotChange, snapshot.packages])

  const confirmMutation = useCallback(() => {
    const pending = confirmation
    setConfirmation(null)
    if (pending) void runMutation(pending.request)
  }, [confirmation, runMutation])

  const requestInstall = useCallback(() => {
    const trimmed = source.trim()
    if (!trimmed) return
    setConfirmation({
      title: t('packages.confirmInstallTitle'),
      message: t('packages.confirmInstall', { source: trimmed, scope: t(`scope.${scope}`) }),
      request: {
        workspaceId: snapshot.workspacePath,
        action: 'install',
        source: trimmed,
        scope,
        confirmed: true,
      },
    })
  }, [scope, snapshot.workspacePath, source, t])

  const requestPackageAction = useCallback((pkg: PiResourceCenterPackage, action: 'update' | 'remove') => {
    setConfirmation({
      title: t(`packages.confirm${action === 'update' ? 'Update' : 'Remove'}Title`),
      message: t(`packages.confirm${action === 'update' ? 'Update' : 'Remove'}`, { source: pkg.source }),
      destructive: action === 'remove',
      request: {
        workspaceId: snapshot.workspacePath,
        action,
        packageId: pkg.id,
        confirmed: true,
      },
    })
  }, [snapshot.workspacePath, t])

  const checkUpdates = useCallback(async () => {
    setCheckingUpdates(true)
    setError(null)
    try {
      const response = await ipcClient.invoke('pi.resources.package.checkUpdates', {
        workspaceId: snapshot.workspacePath,
      })
      setUpdates(new Set(response.packageIds))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setCheckingUpdates(false)
    }
  }, [snapshot.workspacePath])

  const toggleResource = useCallback(async (resource: PiResourceCenterItem, enabled: boolean) => {
    setBusyResourceId(resource.id)
    setError(null)
    try {
      const response = await ipcClient.invoke('pi.resources.filter.set', {
        workspaceId: snapshot.workspacePath,
        resourceId: resource.id,
        enabled,
      })
      onSnapshotChange(response.snapshot)
      setReloadDeferred(response.workerReload === 'deferred')
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusyResourceId(null)
    }
  }, [onSnapshotChange, snapshot.workspacePath])

  return (
    <div className="space-y-3">
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] px-3 py-2.5 text-[10px] leading-relaxed text-amber-900 dark:text-amber-100">
        {t('packages.security')}
      </div>

      <section className="rounded-xl border border-border/55 bg-card/30 p-3.5">
        <div className="flex items-center gap-2">
          <PackagePlus className="h-4 w-4 text-primary" />
          <h3 className="text-[13px] font-semibold">{t('packages.installTitle')}</h3>
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground/70">{t('packages.installDescription')}</p>
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && source.trim() && !busy) requestInstall()
            }}
            placeholder={t('packages.sourcePlaceholder')}
            aria-label={t('packages.sourceLabel')}
            className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] outline-none focus:border-primary/60 focus:ring-2 focus:ring-primary/15"
          />
          <select
            value={scope}
            onChange={(event) => setScope(event.target.value as 'user' | 'project')}
            aria-label={t('packages.scopeLabel')}
            className="rounded-lg border border-border bg-background px-3 py-2 text-[11px] outline-none focus:border-primary/60"
          >
            <option value="user">{t('scope.user')}</option>
            <option value="project">{t('scope.project')}</option>
          </select>
          <button
            type="button"
            onClick={requestInstall}
            disabled={!source.trim() || busy !== null}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
          >
            {busy?.action === 'install' ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
            {t('packages.install')}
          </button>
        </div>
      </section>

      {progress ? (
        <div className={cn(
          'flex items-start gap-2 rounded-xl border px-3 py-2.5 text-[10px]',
          progress.phase === 'failed'
            ? 'border-destructive/30 bg-destructive/5 text-destructive'
            : 'border-primary/20 bg-primary/[0.04] text-foreground',
        )}>
          {progress.phase === 'completed' ? <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 text-emerald-600" /> : <LoaderCircle className="mt-0.5 h-3.5 w-3.5 animate-spin text-primary" />}
          <div className="min-w-0">
            <div className="font-medium">{t(`packages.progress.${progress.phase}`, { action: t(`packages.action.${progress.action}`) })}</div>
            <div className="mt-0.5 truncate font-mono opacity-65" title={progress.message || progress.source}>{progress.message || progress.source}</div>
          </div>
        </div>
      ) : null}

      {error ? (
        <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[10px] text-destructive">
          {t('packages.operationFailed')}: {error}
        </div>
      ) : null}

      {reloadDeferred ? (
        <div className="rounded-xl border border-sky-500/25 bg-sky-500/[0.05] px-3 py-2.5 text-[10px] text-sky-900 dark:text-sky-100">
          {t('packages.reloadDeferred')}
        </div>
      ) : null}

      <div className="flex items-center justify-between gap-3">
        <p className="text-[10px] text-muted-foreground">
          {updates === null
            ? t('packages.updateUnchecked')
            : updates.size > 0
              ? t('packages.updatesFound', { count: updates.size })
              : t('packages.noUpdates')}
        </p>
        <button
          type="button"
          onClick={() => void checkUpdates()}
          disabled={checkingUpdates || busy !== null || snapshot.packages.length === 0}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background px-2.5 py-1.5 text-[10px] hover:bg-accent disabled:opacity-45"
        >
          <RefreshCw className={cn('h-3 w-3', checkingUpdates && 'animate-spin')} />
          {t('packages.checkUpdates')}
        </button>
      </div>

      {snapshot.packages.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/70 py-12 text-center text-[12px] text-muted-foreground">
          {t('packages.empty')}
        </div>
      ) : (
        <div className="grid gap-2 xl:grid-cols-2">
          {snapshot.packages.map((pkg) => {
            const isExpanded = expanded.has(pkg.id)
            const rows = resourcesByPackage.get(pkg.id) || []
            return (
              <article
                key={pkg.id}
                className="[content-visibility:auto] rounded-xl border border-border/55 bg-card/30 p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <h3 className="truncate text-[13px] font-semibold" title={pkg.name}>{pkg.name}</h3>
                      {pkg.version ? <span className="text-[9px] text-muted-foreground">v{pkg.version}</span> : null}
                      {updates?.has(pkg.id) ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[8px] text-primary">{t('packages.updateAvailable')}</span> : null}
                    </div>
                    <div className="mt-1 flex flex-wrap gap-1 text-[9px]">
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-primary">{t(`scope.${pkg.scope}`)}</span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{t(`packageType.${pkg.type}`)}</span>
                      {pkg.pinned ? <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{t('packages.pinned')}</span> : null}
                      {pkg.filtered ? <span className="rounded bg-muted px-1.5 py-0.5 text-muted-foreground">{t('packages.filtered')}</span> : null}
                    </div>
                  </div>
                  <span className={cn(
                    'inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[9px]',
                    pkg.installed
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                  )}>
                    {pkg.installed ? <CheckCircle2 className="h-2.5 w-2.5" /> : <AlertTriangle className="h-2.5 w-2.5" />}
                    {pkg.installed ? t('packages.installed') : t('packages.missing')}
                  </span>
                </div>
                {pkg.description ? <p className="mt-2 line-clamp-2 text-[10px] leading-relaxed text-muted-foreground/75">{pkg.description}</p> : null}
                <p className="mt-2 truncate font-mono text-[9px] text-muted-foreground/65" title={pkg.source}>{pkg.source}</p>
                {pkg.installedPath ? <p className="mt-0.5 truncate font-mono text-[9px] text-muted-foreground/45" title={pkg.installedPath}>{pkg.installedPath}</p> : null}

                <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border/40 pt-2.5">
                  <button
                    type="button"
                    onClick={() => setExpanded((current) => {
                      const next = new Set(current)
                      if (next.has(pkg.id)) next.delete(pkg.id)
                      else next.add(pkg.id)
                      return next
                    })}
                    className="inline-flex items-center gap-1 text-[10px] text-muted-foreground hover:text-foreground"
                  >
                    {isExpanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                    <PackageResourceCounts pkg={pkg} />
                  </button>
                  <div className="flex items-center gap-1">
                    {pkg.type !== 'local' ? (
                      <button
                        type="button"
                        onClick={() => requestPackageAction(pkg, 'update')}
                        disabled={busy !== null || !pkg.installed}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
                      >
                        {busy?.action === 'update' && busy.source === pkg.source ? <LoaderCircle className="h-3 w-3 animate-spin" /> : <RotateCw className="h-3 w-3" />}
                        {t('packages.update')}
                      </button>
                    ) : null}
                    {!pkg.installed ? (
                      <button
                        type="button"
                        onClick={() => setConfirmation({
                          title: t('packages.confirmInstallTitle'),
                          message: t('packages.confirmInstall', { source: pkg.source, scope: t(`scope.${pkg.scope}`) }),
                          request: {
                            workspaceId: snapshot.workspacePath,
                            action: 'install',
                            source: pkg.source,
                            scope: pkg.scope,
                            confirmed: true,
                          },
                        })}
                        disabled={busy !== null}
                        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] text-primary hover:bg-primary/10 disabled:opacity-40"
                      >
                        <Download className="h-3 w-3" />
                        {t('packages.repair')}
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => requestPackageAction(pkg, 'remove')}
                      disabled={busy !== null}
                      className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[9px] text-destructive hover:bg-destructive/10 disabled:opacity-40"
                    >
                      <Trash2 className="h-3 w-3" />
                      {t('packages.remove')}
                    </button>
                  </div>
                </div>
                {isExpanded ? (
                  <PackageResources rows={rows} busyResourceId={busyResourceId} onToggle={(resource, enabled) => void toggleResource(resource, enabled)} />
                ) : null}
              </article>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirmation !== null}
        title={confirmation?.title || ''}
        message={confirmation?.message || ''}
        destructive={confirmation?.destructive}
        onConfirm={confirmMutation}
        onCancel={() => setConfirmation(null)}
      />
    </div>
  )
}
