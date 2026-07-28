import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  CheckCircle2,
  Edit3,
  Network,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react'
import type {
  ProviderConnectivityResult,
  ProviderRouteMode,
  ProviderRoutingConfig,
  ProxyProtocol,
  ProxyProfile,
  ProxyProfileSaveRequest,
} from '@shared/provider-routing'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { SettingsPageHeader } from './settings-shell'

type ProfileDraft = Omit<ProxyProfileSaveRequest, 'port'> & { port: string }

const emptyProfile = (): ProfileDraft => ({
  name: '',
  protocol: 'http',
  host: '127.0.0.1',
  port: '10809',
  username: '',
  noProxy: '',
  password: '',
})

function Button({
  children,
  onClick,
  disabled,
  danger,
}: {
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  danger?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        'electron-no-drag inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50',
        danger
          ? 'border-destructive/30 text-destructive hover:bg-destructive/10'
          : 'border-border bg-background hover:bg-accent',
      )}
    >
      {children}
    </button>
  )
}

function Field({
  label,
  children,
}: {
  label: string
  children: React.ReactNode
}) {
  return (
    <label className="block min-w-0">
      <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  )
}

const fieldClass =
  'w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] outline-none focus:border-primary/60'

export function ProviderRoutingSettingsPanel() {
  const { t } = useTranslation()
  const [config, setConfig] = useState<ProviderRoutingConfig | null>(null)
  const [draft, setDraft] = useState<ProfileDraft>(emptyProfile)
  const [editing, setEditing] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const [diagnostics, setDiagnostics] = useState<
    Record<string, ProviderConnectivityResult>
  >({})

  const load = useCallback(async () => {
    setBusy('load')
    try {
      const response = await ipcClient.invoke('providerRouting.get', {})
      setConfig(response.config)
    } catch (error) {
      toast.error(t('settings:providerRouting.actionFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  const routes = useMemo(
    () => new Map((config?.routes ?? []).map((route) => [route.provider, route])),
    [config],
  )

  const startEdit = (profile?: ProxyProfile) => {
    setDeleting(null)
    setEditing(true)
    setDraft(
      profile
        ? {
            id: profile.id,
            name: profile.name,
            protocol: profile.protocol,
            host: profile.host,
            port: String(profile.port),
            username: profile.username ?? '',
            noProxy: profile.noProxy ?? '',
            password: '',
            preservePassword: profile.passwordConfigured,
          }
        : emptyProfile(),
    )
  }

  const saveProfile = async () => {
    const port = Number(draft.port)
    if (!draft.name.trim() || !draft.host.trim() || !Number.isInteger(port)) return
    setBusy('save-profile')
    try {
      await ipcClient.invoke('proxyProfile.save', {
        ...draft,
        name: draft.name.trim(),
        host: draft.host.trim(),
        port,
        username: draft.username?.trim() || undefined,
        noProxy: draft.noProxy?.trim() || undefined,
        password: draft.password || undefined,
      })
      toast.success(t('settings:providerRouting.profileSaved'))
      setEditing(false)
      setDraft(emptyProfile())
      await load()
    } catch (error) {
      toast.error(t('settings:providerRouting.actionFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }

  const deleteProfile = async (id: string) => {
    setBusy(`delete:${id}`)
    try {
      await ipcClient.invoke('proxyProfile.delete', { id, confirmed: true })
      setDeleting(null)
      toast.success(t('settings:providerRouting.profileDeleted'))
      await load()
    } catch (error) {
      toast.error(t('settings:providerRouting.actionFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }

  const setRoute = async (provider: string, value: string) => {
    const [mode, profileId] = value.split(':', 2) as [
      ProviderRouteMode,
      string | undefined,
    ]
    setBusy(`route:${provider}`)
    try {
      await ipcClient.invoke('providerRouting.set', {
        provider,
        mode,
        ...(mode === 'profile' ? { profileId } : {}),
      })
      toast.success(t('settings:providerRouting.routeSaved'))
      await load()
    } catch (error) {
      toast.error(t('settings:providerRouting.actionFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }

  const diagnose = async (provider: string) => {
    setBusy(`diagnose:${provider}`)
    try {
      const response = await ipcClient.invoke('providerRouting.diagnose', {
        provider,
      })
      setDiagnostics((current) => ({
        ...current,
        [provider]: response.result,
      }))
      if (response.result.ok) {
        toast.success(t('settings:providerRouting.diagnosticPassed'))
      } else {
        toast.error(t('settings:providerRouting.diagnosticFailed'))
      }
    } catch (error) {
      toast.error(t('settings:providerRouting.actionFailed'), {
        description: error instanceof Error ? error.message : String(error),
      })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="space-y-4">
      <SettingsPageHeader
        title={t('settings:providerRouting.title')}
        description={t('settings:providerRouting.description')}
        action={
          <Button onClick={() => void load()} disabled={busy != null}>
            <RefreshCw
              className={cn('h-3.5 w-3.5', busy === 'load' && 'animate-spin')}
            />
            {t('settings:providerRouting.refresh')}
          </Button>
        }
      />

      <div className="flex gap-3 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-4">
        <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        <div>
          <div className="text-[12px] font-semibold">
            {t('settings:providerRouting.isolationTitle')}
          </div>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {t('settings:providerRouting.isolationDescription')}
          </p>
        </div>
      </div>

      <section className="rounded-xl border border-border/60 bg-card/40 p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-[13px] font-semibold">
              {t('settings:providerRouting.profiles')}
            </h3>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {t('settings:providerRouting.profilesDescription')}
            </p>
          </div>
          <Button onClick={() => startEdit()} disabled={busy != null}>
            <Plus className="h-3.5 w-3.5" />
            {t('settings:providerRouting.addProfile')}
          </Button>
        </div>

        <div className="mt-3 grid gap-2 lg:grid-cols-2">
          {(config?.profiles ?? []).map((profile) => (
            <div
              key={profile.id}
              className="rounded-lg border border-border/50 bg-background/40 p-3"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[12px] font-medium">
                    {profile.name}
                  </div>
                  <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">
                    {profile.protocol}://{profile.host}:{profile.port}
                  </div>
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    {profile.passwordConfigured
                      ? t('settings:providerRouting.passwordStored')
                      : t('settings:providerRouting.noPassword')}
                    {profile.noProxy
                      ? ` · ${t('settings:providerRouting.noProxyConfigured')}`
                      : ''}
                  </div>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    aria-label={t('settings:providerRouting.editProfile')}
                    onClick={() => startEdit(profile)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    aria-label={t('settings:providerRouting.deleteProfile')}
                    onClick={() => setDeleting(profile.id)}
                    className="rounded-md p-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
              {deleting === profile.id ? (
                <div className="mt-3 rounded-md border border-destructive/25 bg-destructive/5 p-2">
                  <p className="text-[10px] text-muted-foreground">
                    {t('settings:providerRouting.deleteWarning')}
                  </p>
                  <div className="mt-2 flex gap-2">
                    <Button
                      danger
                      disabled={busy != null}
                      onClick={() => void deleteProfile(profile.id)}
                    >
                      {t('settings:providerRouting.confirmDelete')}
                    </Button>
                    <Button onClick={() => setDeleting(null)}>
                      {t('settings:providerRouting.cancel')}
                    </Button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
          {config && config.profiles.length === 0 ? (
            <p className="text-[11px] text-muted-foreground">
              {t('settings:providerRouting.noProfiles')}
            </p>
          ) : null}
        </div>

        {editing ? (
          <div className="mt-4 rounded-xl border border-primary/25 bg-primary/5 p-4">
            <h4 className="text-[12px] font-semibold">
              {draft.id
                ? t('settings:providerRouting.editProfile')
                : t('settings:providerRouting.addProfile')}
            </h4>
            <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <Field label={t('settings:providerRouting.profileName')}>
                <input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, name: event.target.value }))
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label={t('settings:providerRouting.protocol')}>
                <select
                  value={draft.protocol}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      protocol: event.target.value as ProxyProtocol,
                    }))
                  }
                  className={fieldClass}
                >
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                  <option value="socks5h">SOCKS5H</option>
                </select>
              </Field>
              <Field label={t('settings:providerRouting.host')}>
                <input
                  value={draft.host}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, host: event.target.value }))
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label={t('settings:providerRouting.port')}>
                <input
                  inputMode="numeric"
                  value={draft.port}
                  onChange={(event) =>
                    setDraft((current) => ({ ...current, port: event.target.value }))
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label={t('settings:providerRouting.username')}>
                <input
                  autoComplete="off"
                  value={draft.username}
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      username: event.target.value,
                    }))
                  }
                  className={fieldClass}
                />
              </Field>
              <Field label={t('settings:providerRouting.password')}>
                <input
                  type="password"
                  autoComplete="new-password"
                  value={draft.password}
                  placeholder={
                    draft.preservePassword
                      ? t('settings:providerRouting.passwordPreserved')
                      : ''
                  }
                  onChange={(event) =>
                    setDraft((current) => ({
                      ...current,
                      password: event.target.value,
                    }))
                  }
                  className={fieldClass}
                />
              </Field>
              <div className="sm:col-span-2">
                <Field label={t('settings:providerRouting.noProxy')}>
                  <input
                    autoComplete="off"
                    value={draft.noProxy}
                    placeholder={t('settings:providerRouting.noProxyPlaceholder')}
                    onChange={(event) =>
                      setDraft((current) => ({
                        ...current,
                        noProxy: event.target.value,
                      }))
                    }
                    className={fieldClass}
                  />
                </Field>
              </div>
            </div>
            <p className="mt-3 text-[10px] text-muted-foreground">
              {t('settings:providerRouting.v2rayHint')}
            </p>
            <div className="mt-3 flex gap-2">
              <Button
                disabled={
                  busy != null ||
                  !draft.name.trim() ||
                  !draft.host.trim() ||
                  !Number.isInteger(Number(draft.port))
                }
                onClick={() => void saveProfile()}
              >
                <Save className="h-3.5 w-3.5" />
                {t('settings:providerRouting.saveProfile')}
              </Button>
              <Button onClick={() => setEditing(false)}>
                {t('settings:providerRouting.cancel')}
              </Button>
            </div>
          </div>
        ) : null}
      </section>

      <section className="rounded-xl border border-border/60 bg-card/40 p-4">
        <div>
          <h3 className="text-[13px] font-semibold">
            {t('settings:providerRouting.providerRoutes')}
          </h3>
          <p className="mt-1 text-[11px] text-muted-foreground">
            {t('settings:providerRouting.providerRoutesDescription', {
              source:
                config?.systemProxySource === 'environment'
                  ? t('settings:providerRouting.sourceEnvironment')
                  : config?.systemProxySource === 'macos'
                    ? t('settings:providerRouting.sourceMacos')
                    : t('settings:providerRouting.sourceNone'),
            })}
          </p>
        </div>
        <div className="mt-3 overflow-hidden rounded-lg border border-border/50">
          {(config?.providers ?? []).map((provider) => {
            const route = routes.get(provider.id)
            const routeValue =
              route?.mode === 'profile'
                ? `profile:${route.profileId}`
                : (route?.mode ?? 'system')
            const diagnostic = diagnostics[provider.id]
            return (
              <div
                key={provider.id}
                className="border-b border-border/40 p-3 last:border-b-0"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <div className="min-w-48 flex-1">
                    <div className="flex items-center gap-2">
                      <Network className="h-3.5 w-3.5 text-muted-foreground" />
                      <span className="text-[12px] font-medium">
                        {provider.displayName}
                      </span>
                      <code className="text-[9px] text-muted-foreground">
                        {provider.id}
                      </code>
                    </div>
                    {provider.targetOrigin ? (
                      <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground">
                        {provider.targetOrigin}
                      </div>
                    ) : null}
                  </div>
                  <select
                    aria-label={t('settings:providerRouting.routeFor', {
                      provider: provider.displayName,
                    })}
                    value={routeValue}
                    disabled={busy != null}
                    onChange={(event) =>
                      void setRoute(provider.id, event.target.value)
                    }
                    className="min-w-44 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px]"
                  >
                    <option value="direct">
                      {t('settings:providerRouting.direct')}
                    </option>
                    <option value="system">
                      {t('settings:providerRouting.system')}
                    </option>
                    {(config?.profiles ?? []).map((profile) => (
                      <option key={profile.id} value={`profile:${profile.id}`}>
                        {t('settings:providerRouting.profileRoute', {
                          name: profile.name,
                        })}
                      </option>
                    ))}
                  </select>
                  <Button
                    disabled={busy != null}
                    onClick={() => void diagnose(provider.id)}
                  >
                    <RefreshCw
                      className={cn(
                        'h-3.5 w-3.5',
                        busy === `diagnose:${provider.id}` && 'animate-spin',
                      )}
                    />
                    {t('settings:providerRouting.test')}
                  </Button>
                </div>
                {diagnostic ? (
                  <div
                    className={cn(
                      'mt-3 rounded-md border p-2.5 text-[10px]',
                      diagnostic.ok
                        ? 'border-emerald-500/25 bg-emerald-500/5'
                        : 'border-destructive/25 bg-destructive/5',
                    )}
                  >
                    <div className="flex items-center gap-1.5 font-medium">
                      {diagnostic.ok ? (
                        <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />
                      ) : (
                        <XCircle className="h-3.5 w-3.5 text-destructive" />
                      )}
                      {diagnostic.ok
                        ? t('settings:providerRouting.diagnosticPassed')
                        : t('settings:providerRouting.diagnosticFailed')}
                      {diagnostic.targetOrigin
                        ? ` · ${diagnostic.targetOrigin}`
                        : ''}
                    </div>
                    <div className="mt-2 grid gap-1 text-muted-foreground sm:grid-cols-3">
                      {diagnostic.stages.map((stage) => (
                        <span key={stage.stage}>
                          {stage.stage}: {stage.status} ({stage.durationMs} ms)
                        </span>
                      ))}
                    </div>
                    <p className="mt-2 text-muted-foreground">
                      {t('settings:providerRouting.probeSafety')}
                    </p>
                  </div>
                ) : null}
              </div>
            )
          })}
          {config && config.providers.length === 0 ? (
            <p className="p-4 text-[11px] text-muted-foreground">
              {t('settings:providerRouting.noProviders')}
            </p>
          ) : null}
        </div>
      </section>
    </div>
  )
}
