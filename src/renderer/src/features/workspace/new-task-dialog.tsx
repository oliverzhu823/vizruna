import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FolderGit2, Loader2, Play, X } from 'lucide-react'
import { toast } from 'sonner'
import { selectSessionModel } from '@renderer/lib/model-selection'
import type { ProviderRoutingConfig } from '@shared/provider-routing'
import type { WorktreeCapability } from '@shared/managed-worktree'
import { ipcClient } from '@renderer/lib/ipc-client'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'

type ModelRow = {
  id: string
  provider: string
  name?: string
  available?: boolean
}

type ExecutionEnvironment = 'local' | 'worktree'

const fieldClass =
  'w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] outline-none focus:border-primary/60 disabled:cursor-not-allowed disabled:opacity-50'

function taskName(firstTask: string): string {
  const normalized = firstTask
    .trim()
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s+/g, ' ')
  return normalized.slice(0, 48) || 'agent-task'
}

export function NewTaskDialog({
  projectPath,
  onClose,
}: {
  projectPath: string | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  const [models, setModels] = useState<ModelRow[]>([])
  const [routing, setRouting] = useState<ProviderRoutingConfig | null>(null)
  const [capability, setCapability] = useState<WorktreeCapability | null>(null)
  const [environment, setEnvironment] = useState<ExecutionEnvironment>('local')
  const [provider, setProvider] = useState('')
  const [modelKey, setModelKey] = useState('')
  const [thinking, setThinking] = useState(
    () => useUIStore.getState().runState.thinkingLevel || 'high',
  )
  const [routeValue, setRouteValue] = useState('system')
  const [maxWorkers, setMaxWorkers] = useState(4)
  const [firstTask, setFirstTask] = useState('')
  const [worktreeName, setWorktreeName] = useState('')
  const [branchName, setBranchName] = useState('')
  const [advanced, setAdvanced] = useState(false)
  const [loading, setLoading] = useState(false)
  const [starting, setStarting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const selectedModel = useMemo(
    () => models.find((model) => `${model.provider}/${model.id}` === modelKey),
    [modelKey, models],
  )
  const providers = useMemo(
    () => [...new Set(models.map((model) => model.provider))],
    [models],
  )
  const providerModels = useMemo(
    () => models.filter((model) => model.provider === provider),
    [models, provider],
  )
  const selectedProvider = selectedModel?.provider || provider
  const providerRoute = useMemo(
    () => routing?.routes.find((route) => route.provider === selectedProvider),
    [routing, selectedProvider],
  )

  useEffect(() => {
    if (!projectPath) return
    let cancelled = false
    const currentRunState = useUIStore.getState().runState
    setModels([])
    setRouting(null)
    setCapability(null)
    setEnvironment('local')
    setProvider('')
    setModelKey('')
    setThinking(currentRunState.thinkingLevel || 'high')
    setRouteValue('system')
    setFirstTask('')
    setWorktreeName('')
    setBranchName('')
    setAdvanced(false)
    setLoading(true)
    setError(null)
    Promise.all([
      ipcClient.invoke('model.list', { scope: 'available' }),
      ipcClient.invoke('providerRouting.get', {}),
      ipcClient.invoke('worktree.capability', { rootWorkspacePath: projectPath }),
      ipcClient.invoke('settings.get', { key: 'maxSessionWorkers' }),
    ])
      .then(([modelResponse, routingResponse, capabilityResponse, settingsResponse]) => {
        if (cancelled) return
        const rows = (modelResponse?.models || []) as ModelRow[]
        setModels(rows)
        const preferred =
          rows.find(
            (model) =>
              `${model.provider}/${model.id}` === currentRunState.model,
          ) ||
          rows.find((model) => model.available !== false) ||
          rows[0]
        setProvider(preferred?.provider || '')
        setModelKey(preferred ? `${preferred.provider}/${preferred.id}` : '')
        setRouting(routingResponse?.config || null)
        setCapability(capabilityResponse?.capability || null)
        setEnvironment('local')
        const configuredMax = Number(
          settingsResponse?.settings?.maxSessionWorkers,
        )
        setMaxWorkers(
          Number.isInteger(configuredMax)
            ? Math.max(1, Math.min(16, configuredMax))
            : 4,
        )
      })
      .catch((loadError) => {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : String(loadError),
          )
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [projectPath])

  useEffect(() => {
    if (!selectedProvider) return
    if (providerRoute?.mode === 'profile') {
      setRouteValue(`profile:${providerRoute.profileId}`)
    } else {
      setRouteValue(providerRoute?.mode || 'system')
    }
  }, [providerRoute, selectedProvider])

  useEffect(() => {
    if (!projectPath) return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !starting) onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose, projectPath, starting])

  if (!projectPath) return null

  const startTask = async () => {
    if (!selectedModel || !firstTask.trim() || starting) return
    setStarting(true)
    setError(null)
    try {
      const [routeMode, profileId] = routeValue.split(':', 2)
      await ipcClient.invoke('providerRouting.set', {
        provider: selectedModel.provider,
        mode: routeMode as 'direct' | 'system' | 'profile',
        ...(routeMode === 'profile' ? { profileId } : {}),
      })
      await ipcClient.invoke('settings.set', {
        key: 'maxSessionWorkers',
        value: maxWorkers,
      })

      let targetWorkspace = projectPath
      if (environment === 'worktree') {
        const created = await ipcClient.invoke('worktree.create', {
          rootWorkspacePath: projectPath,
          name: worktreeName.trim() || taskName(firstTask),
          ...(branchName.trim() ? { branchName: branchName.trim() } : {}),
        })
        if (!created?.ok || !created.worktree?.worktreePath) {
          throw new Error(
            created?.error || t('common:newTaskDialog.worktreeCreateFailed'),
          )
        }
        targetWorkspace = created.worktree.worktreePath
      }

      await activateWorkspace(targetWorkspace, { preferHome: true })
      const { enterNewSessionPlaceholder } = await import(
        '@renderer/lib/new-session'
      )
      enterNewSessionPlaceholder()
      const actualModel = await selectSessionModel(selectedModel.provider, selectedModel.id, {
        workspaceId: targetWorkspace,
        deferUntilSession: false,
      })
      await ipcClient.invoke('thinkingLevel.set', {
        sessionId: '',
        level: thinking,
      })
      useUIStore.getState().setRunState({
        model: actualModel,
        thinkingLevel: thinking,
      })
      useUIStore.getState().setComposerPrefill(firstTask.trim())
      onClose()
      toast.success(t('common:newTaskDialog.ready'))
    } catch (startError) {
      const message =
        startError instanceof Error ? startError.message : String(startError)
      setError(message)
      toast.error(t('common:newTaskDialog.startFailed'), {
        description: message,
      })
    } finally {
      setStarting(false)
    }
  }

  const worktreeAvailable = capability?.isGitRepository === true

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-[150] flex items-center justify-center bg-black/45 p-4 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !starting) onClose()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-task-title"
        className="max-h-[min(860px,calc(100vh-2rem))] w-full max-w-2xl overflow-y-auto rounded-xl border border-border bg-background shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-border/60 px-5 py-4">
          <div>
            <h2 id="new-task-title" className="text-[15px] font-semibold">
              {t('common:newTaskDialog.title')}
            </h2>
            <p className="mt-1 max-w-xl text-[11px] text-muted-foreground">
              {t('common:newTaskDialog.description')}
            </p>
          </div>
          <button
            type="button"
            aria-label={t('common:close')}
            disabled={starting}
            onClick={onClose}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="space-y-4 p-5">
          <div>
            <div className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('common:newTaskDialog.project')}
            </div>
            <div className="mt-1 truncate rounded-md border border-border/60 bg-muted/25 px-3 py-2 font-mono text-[11px]">
              {projectPath}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label>
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('common:newTaskDialog.provider')}
              </span>
              <select
                aria-label={t('common:newTaskDialog.provider')}
                value={provider}
                disabled={loading || starting}
                onChange={(event) => {
                  const nextProvider = event.target.value
                  const nextModel =
                    models.find(
                      (model) =>
                        model.provider === nextProvider &&
                        model.available !== false,
                    ) ||
                    models.find((model) => model.provider === nextProvider)
                  setProvider(nextProvider)
                  setModelKey(
                    nextModel ? `${nextModel.provider}/${nextModel.id}` : '',
                  )
                }}
                className={fieldClass}
              >
                {providers.length === 0 ? (
                  <option value="">{t('common:newTaskDialog.noModels')}</option>
                ) : null}
                {providers.map((providerName) => (
                  <option key={providerName} value={providerName}>
                    {providerName}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('common:newTaskDialog.model')}
              </span>
              <select
                aria-label={t('common:newTaskDialog.model')}
                value={modelKey}
                disabled={loading || starting}
                onChange={(event) => setModelKey(event.target.value)}
                className={fieldClass}
              >
                {models.length === 0 ? (
                  <option value="">{t('common:newTaskDialog.noModels')}</option>
                ) : null}
                {providerModels.map((model) => (
                  <option
                    key={`${model.provider}/${model.id}`}
                    value={`${model.provider}/${model.id}`}
                  >
                    {model.name || model.id} · {model.provider}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {t('common:newTaskDialog.thinking')}
              </span>
              <select
                aria-label={t('common:newTaskDialog.thinking')}
                value={thinking}
                disabled={loading || starting}
                onChange={(event) => setThinking(event.target.value)}
                className={fieldClass}
              >
                {['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map(
                  (level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ),
                )}
              </select>
            </label>
          </div>

          <label>
            <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
              {t('common:newTaskDialog.firstTask')}
            </span>
            <textarea
              aria-label={t('common:newTaskDialog.firstTask')}
              autoFocus
              rows={5}
              maxLength={12_000}
              value={firstTask}
              disabled={starting}
              placeholder={t('common:newTaskDialog.firstTaskPlaceholder')}
              onChange={(event) => setFirstTask(event.target.value)}
              className={fieldClass}
            />
          </label>

          <button
            type="button"
            aria-expanded={advanced}
            onClick={() => setAdvanced((value) => !value)}
            className="text-[11px] font-medium text-primary hover:underline"
          >
            {advanced
              ? t('common:newTaskDialog.hideAdvanced')
              : t('common:newTaskDialog.showAdvanced')}
          </button>

          {advanced ? (
            <div className="grid gap-3 rounded-lg border border-border/60 bg-muted/15 p-3 sm:grid-cols-2">
              <fieldset className="sm:col-span-2">
                <legend className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('common:newTaskDialog.environment')}
                </legend>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {(['local', 'worktree'] as const).map((value) => {
                    const disabled =
                      value === 'worktree' && !worktreeAvailable
                    return (
                      <label
                        key={value}
                        className={cn(
                          'flex cursor-pointer gap-3 rounded-lg border p-3',
                          environment === value
                            ? 'border-primary/50 bg-primary/5'
                            : 'border-border/60',
                          disabled && 'cursor-not-allowed opacity-50',
                        )}
                      >
                        <input
                          type="radio"
                          name="task-environment"
                          checked={environment === value}
                          disabled={disabled || starting}
                          onChange={() => setEnvironment(value)}
                        />
                        <span>
                          <span className="flex items-center gap-1.5 text-[12px] font-medium">
                            {value === 'worktree' ? (
                              <FolderGit2 className="h-3.5 w-3.5" />
                            ) : null}
                            {t(`common:newTaskDialog.${value}`)}
                          </span>
                          <span className="mt-1 block text-[10px] leading-relaxed text-muted-foreground">
                            {t(`common:newTaskDialog.${value}Description`)}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
                {!loading && !worktreeAvailable ? (
                  <p className="mt-2 text-[10px] text-amber-600 dark:text-amber-300">
                    {capability?.message ||
                      t('common:newTaskDialog.worktreeUnavailable')}
                  </p>
                ) : null}
              </fieldset>
              {environment === 'worktree' ? (
                <div className="grid gap-3 sm:col-span-2 sm:grid-cols-2">
                  <label>
                    <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('common:newTaskDialog.worktreeName')}
                    </span>
                    <input
                      aria-label={t('common:newTaskDialog.worktreeName')}
                      value={worktreeName}
                      maxLength={80}
                      disabled={starting}
                      placeholder={t(
                        'common:newTaskDialog.worktreeNamePlaceholder',
                      )}
                      onChange={(event) => setWorktreeName(event.target.value)}
                      className={fieldClass}
                    />
                  </label>
                  <label>
                    <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      {t('common:newTaskDialog.branchName')}
                    </span>
                    <input
                      aria-label={t('common:newTaskDialog.branchName')}
                      value={branchName}
                      maxLength={200}
                      disabled={starting}
                      placeholder={t(
                        'common:newTaskDialog.branchNamePlaceholder',
                      )}
                      onChange={(event) => setBranchName(event.target.value)}
                      className={`${fieldClass} font-mono`}
                    />
                  </label>
                  <p className="text-[10px] leading-relaxed text-muted-foreground sm:col-span-2">
                    {t('common:newTaskDialog.worktreeNamingDescription')}
                  </p>
                </div>
              ) : null}
              <label>
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('common:newTaskDialog.providerRoute')}
                </span>
                <select
                  aria-label={t('common:newTaskDialog.providerRoute')}
                  value={routeValue}
                  disabled={!selectedProvider || starting}
                  onChange={(event) => setRouteValue(event.target.value)}
                  className={fieldClass}
                >
                  <option value="direct">
                    {t('settings:providerRouting.direct')}
                  </option>
                  <option value="system">
                    {t('settings:providerRouting.system')}
                  </option>
                  {(routing?.profiles || []).map((profile) => (
                    <option key={profile.id} value={`profile:${profile.id}`}>
                      {t('settings:providerRouting.profileRoute', {
                        name: profile.name,
                      })}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                  {t('common:newTaskDialog.concurrency')}
                </span>
                <input
                  aria-label={t('common:newTaskDialog.concurrency')}
                  type="number"
                  min={1}
                  max={16}
                  value={maxWorkers}
                  disabled={starting}
                  onChange={(event) =>
                    setMaxWorkers(
                      Math.max(1, Math.min(16, Number(event.target.value) || 1)),
                    )
                  }
                  className={fieldClass}
                />
              </label>
              <p className="text-[10px] leading-relaxed text-muted-foreground sm:col-span-2">
                {t('common:newTaskDialog.advancedDescription')}
              </p>
            </div>
          ) : null}

          {error ? (
            <div
              role="alert"
              className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-[11px] text-destructive"
            >
              <div className="font-medium">
                {t('common:newTaskDialog.startFailed')}
              </div>
              <div className="mt-1">{error}</div>
              <div className="mt-1 text-muted-foreground">
                {t('common:newTaskDialog.failureRecovery')}
              </div>
            </div>
          ) : null}
        </div>

        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-4">
          <button
            type="button"
            disabled={starting}
            onClick={onClose}
            className="rounded-md border border-border px-3 py-2 text-[12px] hover:bg-accent disabled:opacity-40"
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            disabled={loading || starting || !selectedModel || !firstTask.trim()}
            onClick={() => void startTask()}
            className="inline-flex items-center gap-1.5 rounded-md bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
            {starting
              ? t('common:newTaskDialog.starting')
              : t('common:newTaskDialog.prepare')}
          </button>
        </div>
      </div>
    </div>
  )
}
