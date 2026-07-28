import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Circle, KeyRound, Loader2, LogIn, LogOut, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type { ProviderAuthStatus, ProviderAuthType } from '@shared/provider-auth'
import { ipcClient } from '@renderer/lib/ipc-client'

export type ProviderAuthViewMode = 'manage' | 'login' | 'logout'

export function ProviderAuthSettings({
  onChanged,
  mode = 'manage',
  initialQuery = '',
  autoStartExact = false,
  showHeader = true,
}: {
  onChanged?: () => void
  mode?: ProviderAuthViewMode
  initialQuery?: string
  autoStartExact?: boolean
  showHeader?: boolean
}) {
  const { t } = useTranslation()
  const [providers, setProviders] = useState<ProviderAuthStatus[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const [query, setQuery] = useState(initialQuery)
  const autoStarted = useRef(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const response = await ipcClient.invoke('providerAuth.list')
      setProviders(response?.providers || [])
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const login = useCallback(
    async (providerId: string, authType: ProviderAuthType) => {
      setBusy(providerId)
      try {
        await ipcClient.invoke('providerAuth.login', { providerId, authType })
        await load()
        onChanged?.()
      } catch {
        // The flow host presents Pi's detailed failure.
      } finally {
        setBusy(null)
      }
    },
    [load, onChanged],
  )

  const logout = useCallback(
    async (providerId: string) => {
      setBusy(providerId)
      try {
        await ipcClient.invoke('providerAuth.logout', { providerId })
        toast.success(t('settings:providerAuth.logoutSuccess'))
        await load()
        onChanged?.()
      } catch (error) {
        toast.error(error instanceof Error ? error.message : String(error))
      } finally {
        setBusy(null)
      }
    },
    [load, onChanged, t],
  )

  useEffect(() => {
    if (!autoStartExact || autoStarted.current || loading || !initialQuery.trim()) return
    const needle = initialQuery.trim().toLowerCase()
    const exact = providers.filter(
      (provider) =>
        provider.providerId.toLowerCase() === needle || provider.name.toLowerCase() === needle,
    )
    if (exact.length !== 1 || exact[0].methods.length !== 1) return
    autoStarted.current = true
    void login(exact[0].providerId, exact[0].methods[0])
  }, [autoStartExact, initialQuery, loading, login, providers])

  const routeLabel = (provider: ProviderAuthStatus): string => {
    if (provider.routeMode === 'direct') return t('settings:providerAuth.routeDirect')
    if (provider.routeMode === 'system') return t('settings:providerAuth.routeSystem')
    return t('settings:providerAuth.routeProfile', {
      name: provider.routeLabel.slice('profile:'.length),
    })
  }

  const statusLabel = (provider: ProviderAuthStatus): string => {
    if (!provider.configured) return t('settings:providerAuth.statusDisconnected')
    if (provider.storedCredential) {
      return provider.configuredType === 'oauth'
        ? t('settings:providerAuth.statusStoredOAuth')
        : t('settings:providerAuth.statusStoredApiKey')
    }
    if (provider.source === 'environment') {
      return t('settings:providerAuth.statusEnvironment', {
        source: provider.sourceLabel || t('settings:providerAuth.environmentVariable'),
      })
    }
    if (provider.source === 'models_json_key' || provider.source === 'models_json_command') {
      return t('settings:providerAuth.statusModelsJson')
    }
    if (provider.source === 'runtime') return t('settings:providerAuth.statusRuntime')
    return t('settings:providerAuth.statusExternal')
  }

  const visibleProviders = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return providers.filter((provider) => {
      if (mode === 'login' && provider.methods.length === 0) return false
      if (mode === 'logout' && !provider.storedCredential) return false
      return (
        !needle ||
        provider.providerId.toLowerCase().includes(needle) ||
        provider.name.toLowerCase().includes(needle)
      )
    })
  }, [mode, providers, query])

  if (loading && providers.length === 0) {
    return (
      <div className="flex items-center gap-2 py-4 text-[12px] text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        {t('settings:providerAuth.loading')}
      </div>
    )
  }

  return (
    <div className="min-w-0">
      {showHeader ? (
        <div className="flex items-start justify-between gap-3 py-3">
          <div>
            <div className="text-[13px] font-medium">{t('settings:providerAuth.title')}</div>
            <div className="mt-0.5 text-[11px] text-muted-foreground">
              {t('settings:providerAuth.description')}
            </div>
          </div>
          <button
            type="button"
            onClick={() => void load()}
            className="shrink-0 rounded-md border border-border p-1.5 text-muted-foreground hover:bg-accent"
            aria-label={t('settings:providerAuth.refresh')}
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      <div className="mb-2 rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">
        {t('settings:providerAuth.statusExplanation')}
      </div>

      <label className="relative mb-2 block">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('settings:providerAuth.searchPlaceholder')}
          className="w-full rounded-md border border-border bg-background py-1.5 pl-8 pr-3 text-[12px] outline-none focus:border-primary/60"
        />
      </label>

      <div className="divide-y divide-border/40">
        {visibleProviders.map((provider) => {
          const isBusy = busy === provider.providerId
          const connected = provider.configured
          return (
            <div
              key={provider.providerId}
              className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2 text-[13px] font-medium">
                  {provider.name}
                  <span
                    className={
                      connected
                        ? 'inline-flex items-center gap-1 rounded-full bg-green-500/10 px-2 py-0.5 text-[10px] text-green-600 dark:text-green-400'
                        : 'inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground'
                    }
                  >
                    {connected ? <Check className="h-3 w-3" /> : <Circle className="h-3 w-3" />}
                    {statusLabel(provider)}
                  </span>
                </div>
                <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                  {provider.providerId}
                </div>
                <div className="mt-0.5 text-[10px] text-muted-foreground">
                  {t('settings:providerAuth.currentRoute', {
                    route: routeLabel(provider),
                  })}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap gap-2">
                {mode !== 'logout' && provider.methods.includes('oauth') ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void login(provider.providerId, 'oauth')}
                    className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1.5 text-[11px] text-primary-foreground disabled:opacity-40"
                  >
                    {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogIn className="h-3.5 w-3.5" />}
                    {provider.storedCredential && provider.configuredType === 'oauth'
                      ? t('settings:providerAuth.accountRelogin')
                      : t('settings:providerAuth.accountLogin')}
                  </button>
                ) : null}
                {mode !== 'logout' && provider.methods.includes('api_key') ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void login(provider.providerId, 'api_key')}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] disabled:opacity-40"
                  >
                    <KeyRound className="h-3.5 w-3.5" />
                    {t('settings:providerAuth.apiKey')}
                  </button>
                ) : null}
                {mode !== 'login' && provider.storedCredential ? (
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => void logout(provider.providerId)}
                    className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-[11px] text-muted-foreground disabled:opacity-40"
                  >
                    {isBusy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <LogOut className="h-3.5 w-3.5" />}
                    {t('settings:providerAuth.logout')}
                  </button>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {visibleProviders.length === 0 ? (
        <div className="py-5 text-center text-[12px] text-muted-foreground">
          {mode === 'logout'
            ? t('settings:providerAuth.noStoredCredentials')
            : t('settings:providerAuth.noProviders')}
        </div>
      ) : null}

      {mode !== 'login' ? (
        <div className="pt-2 text-[10px] leading-relaxed text-muted-foreground/80">
          {t('settings:providerAuth.logoutHint')}
        </div>
      ) : null}
    </div>
  )
}
