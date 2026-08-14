import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertTriangle, CheckCircle2, Loader2, PackageOpen, X } from 'lucide-react'
import { toast } from 'sonner'
import type { AgentProfile } from '@shared/agent-profile'
import type { PiPackageImportApplyResponse, PiPackageImportPlan } from '@shared/pi-package-studio'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { openProviderAuthManager } from '@renderer/features/auth/provider-auth-manager-dialog'
import { openAgentEvaluationSetup } from '@renderer/lib/agent-remediation-navigation'

export function PiPackageImportDialog({ onClose, onImported, onEditImported }: {
  onClose: () => void
  onImported: () => void
  onEditImported?: (profile: AgentProfile) => void
}) {
  const { t } = useTranslation('agents')
  const workspace = useUIStore((state) => state.currentWorkspace)
  const [path, setPath] = useState('.vizruna/pi-packages/')
  const [plan, setPlan] = useState<PiPackageImportPlan | null>(null)
  const [busy, setBusy] = useState<'preview' | 'apply' | null>(null)
  const [error, setError] = useState('')
  const [installAgentPackage, setInstallAgentPackage] = useState(true)
  const [installDependencies, setInstallDependencies] = useState(true)
  const [importConfiguration, setImportConfiguration] = useState(true)
  const [applied, setApplied] = useState(false)
  const [applyResult, setApplyResult] = useState<PiPackageImportApplyResponse | null>(null)

  useEffect(() => {
    const recheck = () => {
      if (!plan?.packagePath || busy) return
      setBusy('preview')
      setError('')
      void ipcClient.invoke('pi.packageStudio.import.preview', {
        workspaceId: workspace || undefined,
        packagePath: plan.packagePath,
      }).then((response) => {
        setPlan(response.plan)
      }).catch((reason) => {
        setError(reason instanceof Error ? reason.message : String(reason))
      }).finally(() => setBusy(null))
    }
    window.addEventListener('vizruna:provider-auth-completed', recheck)
    return () => window.removeEventListener('vizruna:provider-auth-completed', recheck)
  }, [busy, plan?.packagePath, workspace])

  const preview = async () => {
    setBusy('preview')
    setError('')
    try {
      const response = await ipcClient.invoke('pi.packageStudio.import.preview', {
        workspaceId: workspace || undefined,
        packagePath: path,
      })
      setPlan(response.plan)
      setApplied(false)
    } catch (reason) {
      setPlan(null)
      setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setBusy(null)
    }
  }

  const apply = async () => {
    if (!plan?.canApply || busy) return
    setBusy('apply')
    setError('')
    try {
      const response = await ipcClient.invoke('pi.packageStudio.import.apply', {
        workspaceId: workspace || undefined,
        packagePath: plan.packagePath,
        installAgentPackage,
        installDependencies,
        importConfiguration,
        confirmed: true,
      })
      setPlan(response.plan)
      setApplied(true)
      setApplyResult(response)
      toast.success(t('packageImport.completed'))
      onImported()
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : String(reason)
      setError(message)
      toast.error(t('packageImport.failed'), { description: message })
    } finally {
      setBusy(null)
    }
  }

  const remediation = (code: string, value?: string) => {
    if (code === 'provider-auth') {
      openProviderAuthManager({ mode: 'login', providerId: value })
      return
    }
    if (code === 'pi-packages' || code === 'pi-resources' || code === 'model' || code === 'runtime') {
      window.dispatchEvent(new CustomEvent('vizruna:open-pi-resources'))
      return
    }
    if (code === 'validation' && applyResult?.profile && applyResult.version) {
      openAgentEvaluationSetup({
        profileId: applyResult.profile.id,
        versionId: applyResult.version.id,
        createSuite: true,
      })
      return
    }
    if ((code === 'project-context' || code === 'tool-policy') && applyResult?.profile) {
      onEditImported?.(applyResult.profile)
    }
  }

  const canRemediate = (code: string) => {
    if (code === 'validation' || code === 'project-context' || code === 'tool-policy') return !!applyResult?.profile
    return ['provider-auth', 'pi-packages', 'pi-resources', 'model', 'runtime'].includes(code)
  }

  return <div className="fixed inset-0 z-[126] flex items-center justify-center bg-black/45 p-5 backdrop-blur-[2px]">
    <div role="dialog" aria-modal="true" aria-label={t('packageImport.title')} className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl">
      <div className="flex items-start justify-between gap-4 border-b border-border/60 px-5 py-4">
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary"><PackageOpen className="h-4.5 w-4.5" /></div>
          <div><h2 className="text-[16px] font-semibold">{t('packageImport.title')}</h2><p className="mt-0.5 text-[11px] text-muted-foreground">{t('packageImport.subtitle')}</p></div>
        </div>
        <button type="button" onClick={onClose} disabled={busy !== null} className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
      </div>
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-5">
        <section className="rounded-xl border border-border/60 bg-card/30 p-3.5">
          <label className="text-[11px] font-medium">{t('packageImport.path')}</label>
          <p className="mt-0.5 text-[9px] text-muted-foreground">{t('packageImport.pathHint')}</p>
          <div className="mt-2 flex gap-2"><input value={path} onChange={(event) => { setPath(event.target.value); setPlan(null) }} className="min-w-0 flex-1 rounded-lg border border-border bg-background px-3 py-2 font-mono text-[11px] outline-none focus:border-primary/60" /><button type="button" onClick={() => void preview()} disabled={!path.trim() || busy !== null} className="rounded-lg bg-primary px-3.5 py-2 text-[11px] font-medium text-primary-foreground disabled:opacity-40">{busy === 'preview' ? <Loader2 className="h-4 w-4 animate-spin" /> : t('packageImport.inspect')}</button></div>
        </section>
        {plan ? <>
          <section className={cn('rounded-xl border p-3.5', plan.artifactValid && plan.identityStatus !== 'conflict' ? 'border-emerald-500/25 bg-emerald-500/[0.04]' : 'border-destructive/30 bg-destructive/[0.04]')}>
            <div className="flex items-start gap-2.5">{plan.artifactValid && plan.identityStatus !== 'conflict' ? <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" /> : <AlertTriangle className="mt-0.5 h-4 w-4 text-destructive" />}<div className="min-w-0"><div className="text-[12px] font-semibold">{plan.profile.name} · v{plan.version.number}</div><div className="mt-1 break-all font-mono text-[9px] text-muted-foreground">{plan.packageName}@{plan.packageVersion} · {plan.version.digest.slice(0, 12)}</div><div className="mt-2 text-[10px] text-muted-foreground">{t(`packageImport.identity.${plan.identityStatus}`)}</div>{plan.artifactErrors.length ? <div className="mt-1 text-[9px] text-destructive">{plan.artifactErrors.join(', ')}</div> : null}</div></div>
          </section>
          <section className="overflow-hidden rounded-xl border border-border/60">
            <div className="flex items-center justify-between border-b border-border/50 px-3.5 py-3"><div><div className="text-[11px] font-semibold">{t('packageImport.readiness')}</div><div className="mt-0.5 text-[9px] text-muted-foreground">{t('packageImport.readinessHint')}</div></div><span className={cn('rounded-full px-2.5 py-1 text-[9px]', plan.readiness.status === 'ready' ? 'bg-emerald-500/10 text-emerald-700' : plan.readiness.status === 'blocked' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-700')}>{t(`packageStudio.delivery.status.${plan.readiness.status}`)}</span></div>
            <div className="divide-y divide-border/40">{plan.readiness.checks.map((check) => <div key={check.code} className="grid gap-2 px-3.5 py-2.5 sm:grid-cols-[10rem_6rem_minmax(0,1fr)_auto]"><span className="text-[10px] font-medium">{t(`packageStudio.delivery.check.${check.code}`)}</span><span className="text-[9px] text-muted-foreground">{t(`packageStudio.delivery.checkStatus.${check.status}`)}</span><span className="text-[9px] text-muted-foreground">{check.status === 'ready' ? check.value || check.count || t('packageStudio.delivery.readyValue') : t(`packageStudio.delivery.action.${check.code}`, { value: check.value || '—', count: check.count ?? 0 })}</span>{check.status !== 'ready' && canRemediate(check.code) ? <button type="button" onClick={() => remediation(check.code, check.value)} className="self-center whitespace-nowrap rounded-md border border-border px-2 py-1 text-[9px] font-medium hover:bg-accent">{t(`packageImport.remediation.${check.code}`)}</button> : null}</div>)}</div>
          </section>
          <section className="rounded-xl border border-border/60 bg-card/30 p-3.5"><div className="text-[11px] font-semibold">{t('packageImport.actions')}</div><div className="mt-2 space-y-2 text-[10px]">{[
            ['importConfiguration', importConfiguration, setImportConfiguration],
            ['installAgentPackage', installAgentPackage, setInstallAgentPackage],
            ['installDependencies', installDependencies, setInstallDependencies],
          ].map(([key, checked, setter]) => <label key={String(key)} className="flex items-start gap-2"><input type="checkbox" checked={Boolean(checked)} onChange={(event) => (setter as (value: boolean) => void)(event.target.checked)} className="mt-0.5" /><span><span className="font-medium">{t(`packageImport.${key}`)}</span><span className="ml-1 text-muted-foreground">{t(`packageImport.${key}Hint`, { count: plan.missingPackageSources.length })}</span></span></label>)}</div><div className="mt-3 rounded-lg bg-amber-500/[0.06] px-3 py-2 text-[9px] leading-relaxed text-amber-800 dark:text-amber-200">{t('packageImport.evidenceBoundary')}</div><div className="mt-2 text-[9px] text-muted-foreground">{t('packageImport.credentialBoundary')}</div></section>
          {applied ? <div className="flex items-start gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/[0.05] px-3.5 py-3 text-[10px] text-emerald-800 dark:text-emerald-200"><CheckCircle2 className="h-4 w-4 shrink-0" /><span>{t('packageImport.postflight', { status: t(`packageStudio.delivery.status.${plan.readiness.status}`) })}</span></div> : null}
        </> : null}
        {error ? <div className="rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2.5 text-[10px] text-destructive">{error}</div> : null}
      </div>
      <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-4"><button type="button" onClick={onClose} className="rounded-lg border border-border px-3.5 py-2 text-[11px]">{t(applied ? 'packageImport.done' : 'form.cancel')}</button>{!applied ? <button type="button" onClick={() => void apply()} disabled={!plan?.canApply || busy !== null || (!installAgentPackage && !installDependencies && !importConfiguration)} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[11px] font-medium text-primary-foreground disabled:opacity-40">{busy === 'apply' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <PackageOpen className="h-3.5 w-3.5" />}{t('packageImport.apply')}</button> : null}</div>
    </div>
  </div>
}
