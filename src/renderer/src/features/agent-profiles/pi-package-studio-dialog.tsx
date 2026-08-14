import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  AlertTriangle,
  CheckCircle2,
  FileCode2,
  Loader2,
  PackageCheck,
  PackagePlus,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { AgentProfile } from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'
import type {
  PiPackageStudioExportResponse,
  PiPackageStudioPlan,
} from '@shared/pi-package-studio'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

export function PiPackageStudioDialog({
  profile,
  onClose,
  onChanged,
}: {
  profile: AgentProfile
  onClose: () => void
  onChanged?: () => void
}) {
  const { t } = useTranslation('agents')
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const [plan, setPlan] = useState<PiPackageStudioPlan | null>(null)
  const [versions, setVersions] = useState<AgentVersion[]>([])
  const [selectedVersionId, setSelectedVersionId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<'export' | 'install' | null>(null)
  const [result, setResult] = useState<PiPackageStudioExportResponse | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)
    void ipcClient
      .invoke('agentVersion.list', { profileId: profile.id })
      .then((response) => {
        if (cancelled) return
        const next = (response?.versions ?? []) as AgentVersion[]
        setVersions(next)
        const preferred = next.find(
          (version) => version.status === 'validated' || version.status === 'released',
        ) ?? next[0]
        setSelectedVersionId(preferred?.id || '')
      })
      .catch((reason) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
      })
    return () => {
      cancelled = true
    }
  }, [profile.id])

  useEffect(() => {
    if (!selectedVersionId) {
      setLoading(false)
      return
    }
    let cancelled = false
    setLoading(true)
    setError(null)
    setResult(null)
    void ipcClient
      .invoke('pi.packageStudio.preview', {
        profileId: profile.id,
        versionId: selectedVersionId,
        workspaceId: currentWorkspace || undefined,
      })
      .then((response) => {
        if (!cancelled) setPlan(response.plan)
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
  }, [currentWorkspace, profile.id, selectedVersionId])

  const runExport = async (install: boolean) => {
    if (!plan?.installable || busy) return
    setBusy(install ? 'install' : 'export')
    setError(null)
    try {
      const response = await ipcClient.invoke('pi.packageStudio.export', {
        profileId: profile.id,
        versionId: selectedVersionId,
        workspaceId: currentWorkspace || undefined,
        install,
        confirmed: true,
      })
      setResult(response)
      setPlan(response.plan)
      setVersions((current) => current.map((version) => (
        version.id === response.plan.version.id ? response.plan.version : version
      )))
      onChanged?.()
      toast.success(t(install ? 'packageStudio.installed' : 'packageStudio.exported'))
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      toast.error(t('packageStudio.failed'), { description: message })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[125] flex items-center justify-center bg-black/45 p-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('packageStudio.title')}
        className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <PackageCheck className="h-4.5 w-4.5" />
            </div>
            <div className="min-w-0">
              <h2 className="text-[16px] font-semibold text-foreground">
                {t('packageStudio.title')}
              </h2>
              <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {profile.name} · {t('packageStudio.subtitle')}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          {loading ? (
            <div className="flex min-h-[18rem] items-center justify-center text-[12px] text-muted-foreground">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              {t('packageStudio.validating')}
            </div>
          ) : plan ? (
            <div className="space-y-4">
              <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-card/30 p-3.5">
                <div>
                  <div className="text-[11px] font-medium text-foreground">{t('versions.packageVersion')}</div>
                  <div className="mt-0.5 text-[9px] text-muted-foreground">{t('versions.packageVersionHint')}</div>
                </div>
                <select
                  value={selectedVersionId}
                  onChange={(event) => setSelectedVersionId(event.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-2 text-[11px] outline-none focus:border-primary/60"
                >
                  {versions.map((version) => (
                    <option key={version.id} value={version.id}>
                      v{version.number} · {t(`versions.status.${version.status}`)} · {version.digest.slice(0, 8)}
                    </option>
                  ))}
                </select>
              </section>
              <section className="rounded-2xl border border-primary/20 bg-primary/[0.04] p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-[10px] uppercase tracking-[0.1em] text-muted-foreground">
                      {t('packageStudio.packageIdentity')}
                    </div>
                    <div className="mt-1 truncate font-mono text-[13px] font-medium text-foreground">
                      {plan.packageName}@{plan.packageVersion}
                    </div>
                    <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground" title={plan.workspacePath}>
                      {plan.workspacePath}/.vizruna/pi-packages/{plan.directoryName}
                    </div>
                  </div>
                  <div className="flex flex-wrap gap-1.5 text-[9px]">
                    <span className="rounded-full bg-emerald-500/10 px-2 py-1 text-emerald-700 dark:text-emerald-300">
                      {t('packageStudio.piCompatible')}
                    </span>
                    <span className={cn(
                      'rounded-full px-2 py-1',
                      plan.portable
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                    )}>
                      {t(plan.portable ? 'packageStudio.portable' : 'packageStudio.externalDeps')}
                    </span>
                  </div>
                </div>
              </section>

              <section className="overflow-hidden rounded-xl border border-border/60">
                <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border/50 px-3.5 py-3">
                  <div>
                    <div className="text-[11px] font-semibold text-foreground">{t('packageStudio.delivery.title')}</div>
                    <div className="mt-0.5 text-[9px] text-muted-foreground">{t('packageStudio.delivery.description')}</div>
                  </div>
                  <span className={cn(
                    'rounded-full px-2.5 py-1 text-[9px] font-medium',
                    plan.delivery.status === 'ready'
                      ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      : plan.delivery.status === 'blocked'
                        ? 'bg-destructive/10 text-destructive'
                        : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                  )}>{t(`packageStudio.delivery.status.${plan.delivery.status}`)}</span>
                </div>
                <div className="divide-y divide-border/40">
                  {plan.delivery.checks.map((check) => (
                    <div key={check.code} className="grid gap-2 px-3.5 py-2.5 sm:grid-cols-[10rem_6rem_minmax(0,1fr)] sm:items-start">
                      <div className="text-[10px] font-medium text-foreground">{t(`packageStudio.delivery.check.${check.code}`)}</div>
                      <span className={cn(
                        'w-fit rounded-full px-2 py-0.5 text-[8px] font-medium',
                        check.status === 'ready'
                          ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : check.status === 'blocked'
                            ? 'bg-destructive/10 text-destructive'
                            : 'bg-amber-500/10 text-amber-700 dark:text-amber-300',
                      )}>{t(`packageStudio.delivery.checkStatus.${check.status}`)}</span>
                      <div className="min-w-0 text-[9px] leading-relaxed text-muted-foreground">
                        {check.status === 'ready'
                          ? (check.value || (check.count != null ? String(check.count) : t('packageStudio.delivery.readyValue')))
                          : t(`packageStudio.delivery.action.${check.code}`, { value: check.value || '—', count: check.count ?? 0 })}
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t border-border/50 bg-muted/15 px-3.5 py-2.5 text-[9px] leading-relaxed text-muted-foreground">
                  {t('packageStudio.delivery.credentialBoundary')}
                </div>
              </section>

              {plan.issues.length > 0 ? (
                <section className="overflow-hidden rounded-xl border border-border/60">
                  {plan.issues.map((issue) => (
                    <div
                      key={`${issue.code}:${issue.ids?.join(',') || ''}`}
                      className={cn(
                        'flex items-start gap-2.5 border-b border-border/40 px-3 py-2.5 last:border-0',
                        issue.severity === 'error' ? 'bg-destructive/[0.04]' : 'bg-amber-500/[0.04]',
                      )}
                    >
                      <AlertTriangle className={cn(
                        'mt-0.5 h-3.5 w-3.5 shrink-0',
                        issue.severity === 'error' ? 'text-destructive' : 'text-amber-600',
                      )} />
                      <div className="min-w-0">
                        <div className="text-[10px] leading-relaxed text-foreground">
                          {t(`packageStudio.issue.${issue.code}`, { count: issue.count ?? 0 })}
                        </div>
                        {issue.ids?.length ? (
                          <div className="mt-0.5 truncate font-mono text-[8px] text-muted-foreground" title={issue.ids.join('\n')}>
                            {issue.ids.join(', ')}
                          </div>
                        ) : null}
                      </div>
                    </div>
                  ))}
                </section>
              ) : (
                <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] px-3 py-2.5 text-[10px] text-emerald-800 dark:text-emerald-200">
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  {t('packageStudio.validationPassed')}
                </div>
              )}

              <div className="grid gap-3 md:grid-cols-2">
                <section className="rounded-xl border border-border/60 bg-card/30 p-3.5">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-foreground">
                    <FileCode2 className="h-3.5 w-3.5 text-primary" />
                    {t('packageStudio.generatedFiles')}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {plan.files.map((file) => (
                      <div key={file} className="truncate font-mono text-[9px] text-muted-foreground">
                        {file}
                      </div>
                    ))}
                  </div>
                </section>
                <section className="rounded-xl border border-border/60 bg-card/30 p-3.5">
                  <div className="flex items-center gap-2 text-[11px] font-medium text-foreground">
                    <PackagePlus className="h-3.5 w-3.5 text-primary" />
                    {t('packageStudio.dependencies')}
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {plan.dependencies.packages.length > 0 ? plan.dependencies.packages.map((pkg) => (
                      <div key={pkg.id} className="truncate font-mono text-[9px] text-muted-foreground" title={pkg.source}>
                        {pkg.source}{pkg.version ? ` · ${pkg.version}` : ''}
                      </div>
                    )) : (
                      <div className="text-[9px] text-muted-foreground">{t('packageStudio.noPackageDependencies')}</div>
                    )}
                  </div>
                </section>
              </div>

              {result ? (
                <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] px-3 py-2.5">
                  <div className="flex items-center gap-2 text-[10px] font-medium text-emerald-800 dark:text-emerald-200">
                    <CheckCircle2 className="h-3.5 w-3.5" />
                    {t(result.installed ? 'packageStudio.installed' : 'packageStudio.exported')}
                  </div>
                  <div className="mt-1 break-all font-mono text-[9px] text-muted-foreground">
                    {result.packagePath}
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {error ? (
            <div className="mt-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[10px] text-destructive">
              {error}
            </div>
          ) : null}
        </div>

        <div className="flex flex-wrap justify-end gap-2 border-t border-border/60 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy !== null}
            className="rounded-lg border border-border px-3.5 py-2 text-[11px] text-muted-foreground hover:bg-accent disabled:opacity-40"
          >
            {t('form.cancel')}
          </button>
          <button
            type="button"
            onClick={() => void runExport(false)}
            disabled={!plan?.installable || busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 px-3.5 py-2 text-[11px] font-medium text-primary hover:bg-primary/5 disabled:opacity-40"
          >
            {busy === 'export' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FileCode2 className="h-3.5 w-3.5" />}
            {t('packageStudio.exportOnly')}
          </button>
          <button
            type="button"
            onClick={() => void runExport(true)}
            disabled={!plan?.installable || busy !== null}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-40"
          >
            {busy === 'install' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackagePlus className="h-3.5 w-3.5" />}
            {t('packageStudio.exportInstall')}
          </button>
        </div>
      </div>
    </div>
  )
}
