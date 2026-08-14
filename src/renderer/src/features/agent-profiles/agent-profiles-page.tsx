import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Archive,
  Bot,
  Copy,
  GitBranch,
  Loader2,
  Pencil,
  PackageCheck,
  PackageOpen,
  Play,
  Plus,
  RefreshCw,
  ShieldCheck,
  FlaskConical,
  ExternalLink,
  FolderArchive,
  FileOutput,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  AgentPiResourceSelection,
  AgentProviderRequirements,
  AgentProfile,
  AgentProfileCreateRequest,
  AgentProfilePreviewResponse,
  AgentProfileUpdateRequest,
} from '@shared/agent-profile'
import type { AgentEvaluationSuiteBundle } from '@shared/agent-evaluation'
import type { AgentRunHistoryItem } from '@shared/agent-run-history'
import {
  agentAssetMatchesView,
  type AgentAssetCatalog,
  type AgentAssetSummary,
  type AgentAssetView,
} from '@shared/agent-asset'
import { DEFAULT_AGENT_PI_RESOURCE_SELECTION } from '@shared/agent-composer'
import { evaluateAgentProviderRequirements } from '@shared/agent-provider-requirements'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useAgentProfileStore } from '@renderer/stores/agent-profile-store'
import { useUIStore } from '@renderer/stores/ui-store'
import {
  AgentEffectiveConfigPreview,
  AgentPiResourcesEditor,
  AgentProviderRequirementsEditor,
} from './agent-composer-resources'
import { PiPackageStudioDialog } from './pi-package-studio-dialog'
import { PiPackageImportDialog } from './pi-package-import-dialog'
import { AgentVersionHistoryDialog } from './agent-version-history-dialog'
import { openAgentEvaluationSetup } from '@renderer/lib/agent-remediation-navigation'
import {
  buildAgentWorkspaceEvidence,
  type AgentWorkspaceEvidence,
} from '@shared/agent-workspace'
import {
  buildAgentRunPreflight,
  type AgentRunPreflight,
} from '@shared/agent-run-preflight'
import { buildAgentCapabilityManifest } from '@shared/agent-capability-manifest'
import { buildAgentRuntimeCapabilityDrift } from '@shared/agent-runtime-capability-drift'
import { buildAgentRunComparison } from '@shared/agent-run-comparison'
import { buildAgentRunDiagnosis, type AgentRunDiagnosisAction } from '@shared/agent-run-diagnosis'
import { openProviderAuthManager } from '@renderer/features/auth/provider-auth-manager-dialog'

const BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
const DEFAULT_AGENT_TOOLS = ['read', 'bash', 'edit', 'write']
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const
const EMPTY_ASSET_CATALOG: AgentAssetCatalog = {
  assets: [],
  counts: { all: 0, building: 0, validated: 0, delivered: 0 },
}
const AGENT_WORKSPACE_SESSION_KEY = 'vizruna:agent-workspace-profile'

type ModelRow = {
  id: string
  provider: string
  name?: string
  reasoning: boolean
  input: Array<'text' | 'image'>
  contextWindow: number
}
type DialogMode = 'create' | 'edit' | 'duplicate'
type AgentDraft = {
  name: string
  description: string
  systemPrompt: string
  promptMode: 'append' | 'replace'
  modelId: string
  thinkingLevel: string
  inheritTools: boolean
  tools: string[]
  inheritExtensionTools: boolean
  extensionTools: string[]
  resourceSelection: AgentPiResourceSelection
  providerRequirements: AgentProviderRequirements
}

const EMPTY_DRAFT: AgentDraft = {
  name: '',
  description: '',
  systemPrompt: '',
  promptMode: 'append',
  modelId: '',
  thinkingLevel: '',
  inheritTools: true,
  tools: [...DEFAULT_AGENT_TOOLS],
  inheritExtensionTools: true,
  extensionTools: [],
  resourceSelection: { ...DEFAULT_AGENT_PI_RESOURCE_SELECTION },
  providerRequirements: { reasoning: false, imageInput: false },
}

function draftFromProfile(profile: AgentProfile, duplicate: boolean): AgentDraft {
  return {
    name: duplicate ? `${profile.name} Copy` : profile.name,
    description: profile.description || '',
    systemPrompt: profile.systemPrompt,
    promptMode: profile.promptMode,
    modelId: profile.modelId || '',
    thinkingLevel: profile.thinkingLevel || '',
    inheritTools: profile.tools === undefined,
    tools: profile.tools ? [...profile.tools] : [...DEFAULT_AGENT_TOOLS],
    inheritExtensionTools: profile.extensionTools === undefined,
    extensionTools: profile.extensionTools ? [...profile.extensionTools] : [],
    resourceSelection: profile.resourceSelection
      ? {
          ...profile.resourceSelection,
          packageIds: [...profile.resourceSelection.packageIds],
          resourceIds: [...profile.resourceSelection.resourceIds],
        }
      : { ...DEFAULT_AGENT_PI_RESOURCE_SELECTION },
    providerRequirements: profile.providerRequirements
      ? { ...profile.providerRequirements }
      : { reasoning: false, imageInput: false },
  }
}

function AgentProfileDialog({
  mode,
  profile,
  onClose,
  onSaved,
}: {
  mode: DialogMode
  profile?: AgentProfile
  onClose: () => void
  onSaved: (profile: AgentProfile) => void
}) {
  const { t } = useTranslation('agents')
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const [draft, setDraft] = useState<AgentDraft>(() =>
    profile ? draftFromProfile(profile, mode === 'duplicate') : { ...EMPTY_DRAFT },
  )
  const [models, setModels] = useState<ModelRow[]>([])
  const [preview, setPreview] = useState<AgentProfilePreviewResponse>()
  const [previewLoading, setPreviewLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let cancelled = false
    void ipcClient
      .invoke('model.list', { scope: 'available' })
      .then((response) => {
        if (!cancelled) setModels((response?.models ?? []) as ModelRow[])
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    const timer = window.setTimeout(() => {
      setPreviewLoading(true)
      void ipcClient
        .invoke('agentProfile.preview', {
          workspaceId: currentWorkspace || undefined,
          resourceSelection: draft.resourceSelection,
        })
        .then((response) => {
          if (!cancelled) setPreview(response as AgentProfilePreviewResponse)
        })
        .catch(() => {
          if (!cancelled) setPreview(undefined)
        })
        .finally(() => {
          if (!cancelled) setPreviewLoading(false)
        })
    }, 160)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [currentWorkspace, draft.resourceSelection])

  const modelOptions = useMemo(
    () =>
      models
        .map((model) => ({
          value: `${model.provider}/${model.id}`,
          label: model.name
            ? `${model.provider}/${model.id} · ${model.name}`
            : `${model.provider}/${model.id}`,
        }))
        .sort((a, b) => a.value.localeCompare(b.value)),
    [models],
  )

  const providerIssues = useMemo(
    () =>
      evaluateAgentProviderRequirements(
        draft.modelId || undefined,
        models,
        draft.providerRequirements,
      ),
    [draft.modelId, draft.providerRequirements, models],
  )

  const selectedExtensionTools = useMemo(() => {
    if (draft.resourceSelection.mode !== 'selected') return []
    const packageIds = new Set(draft.resourceSelection.packageIds)
    const resourceIds = new Set(draft.resourceSelection.resourceIds)
    return [
      ...new Set(
        (preview?.catalog.resources.extensions ?? [])
          .filter(
            (extension) =>
              extension.enabled &&
              (resourceIds.has(extension.id) ||
                (!!extension.packageId && packageIds.has(extension.packageId))),
          )
          .flatMap((extension) => extension.tools ?? []),
      ),
    ].sort((a, b) => a.localeCompare(b))
  }, [draft.resourceSelection, preview?.catalog.resources.extensions])

  const save = async () => {
    const name = draft.name.trim()
    const systemPrompt = draft.systemPrompt.trim()
    if (!name || !systemPrompt || saving || providerIssues.length > 0) return
    setSaving(true)
    try {
      const base: AgentProfileCreateRequest = {
        name,
        description: draft.description.trim() || undefined,
        systemPrompt,
        promptMode: draft.promptMode,
        modelId: draft.modelId || undefined,
        thinkingLevel: draft.thinkingLevel || undefined,
        tools: draft.inheritTools ? undefined : draft.tools,
        extensionTools:
          draft.inheritTools ||
          draft.resourceSelection.mode !== 'selected' ||
          draft.inheritExtensionTools
            ? undefined
            : draft.extensionTools.filter((tool) => selectedExtensionTools.includes(tool)),
        resourceSelection: draft.resourceSelection,
        providerRequirements:
          draft.providerRequirements.reasoning ||
          draft.providerRequirements.imageInput ||
          draft.providerRequirements.minContextWindow
            ? draft.providerRequirements
            : undefined,
      }
      const response =
        mode === 'edit' && profile
          ? await ipcClient.invoke('agentProfile.update', {
              id: profile.id,
              ...base,
              modelId: base.modelId ?? null,
              thinkingLevel: base.thinkingLevel ?? null,
              tools: base.tools ?? null,
              extensionTools: base.extensionTools ?? null,
              resourceSelection: base.resourceSelection ?? null,
              providerRequirements: base.providerRequirements ?? null,
            } satisfies AgentProfileUpdateRequest)
          : await ipcClient.invoke('agentProfile.create', base)
      if (!response?.profile) throw new Error('Agent profile mutation returned no profile')
      onSaved(response.profile as AgentProfile)
      toast.success(t(mode === 'edit' ? 'messages.updated' : 'messages.created'))
      onClose()
    } catch (error) {
      toast.error(t('messages.saveFailed'), { description: String(error) })
    } finally {
      setSaving(false)
    }
  }

  const title =
    mode === 'edit'
      ? t('form.editTitle')
      : mode === 'duplicate'
        ? t('form.duplicateTitle')
        : t('form.createTitle')

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/40 p-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[92vh] w-full max-w-6xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <Bot className="h-5 w-5 text-primary" />
            <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5">
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_19rem]">
            <div className="min-w-0 space-y-5">
              <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-[12px] font-medium text-foreground">{t('form.name')}</span>
              <input
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
                placeholder={t('form.namePlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none transition-colors focus:border-primary/60"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[12px] font-medium text-foreground">
                {t('form.description')}
              </span>
              <input
                value={draft.description}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, description: event.target.value }))
                }
                placeholder={t('form.descriptionPlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none transition-colors focus:border-primary/60"
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-foreground">
              {t('form.systemPrompt')}
            </span>
            <textarea
              value={draft.systemPrompt}
              onChange={(event) =>
                setDraft((value) => ({ ...value, systemPrompt: event.target.value }))
              }
              placeholder={t('form.systemPromptPlaceholder')}
              rows={12}
              className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 font-mono text-[12px] leading-relaxed outline-none transition-colors focus:border-primary/60"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-[12px] font-medium text-foreground">
              {t('form.promptMode')}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['append', 'replace'] as const).map((promptMode) => (
                <button
                  key={promptMode}
                  type="button"
                  onClick={() => setDraft((value) => ({ ...value, promptMode }))}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-left transition-colors',
                    draft.promptMode === promptMode
                      ? 'border-primary/50 bg-primary/8'
                      : 'border-border hover:bg-accent/40',
                  )}
                >
                  <span className="block text-[12px] font-medium text-foreground">
                    {t(`promptMode.${promptMode}`)}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                    {t(`form.${promptMode}Hint`)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-[12px] font-medium text-foreground">{t('form.model')}</span>
              <select
                value={draft.modelId}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, modelId: event.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-primary/60"
              >
                <option value="">{t('inherits')}</option>
                {draft.modelId &&
                  !modelOptions.some((option) => option.value === draft.modelId) && (
                    <option value={draft.modelId}>{draft.modelId}</option>
                  )}
                {modelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1.5">
              <span className="text-[12px] font-medium text-foreground">
                {t('form.thinking')}
              </span>
              <select
                value={draft.thinkingLevel}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, thinkingLevel: event.target.value }))
                }
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[12px] outline-none focus:border-primary/60"
              >
                <option value="">{t('inherits')}</option>
                {THINKING_LEVELS.map((level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <AgentProviderRequirementsEditor
            requirements={draft.providerRequirements}
            onChange={(providerRequirements) =>
              setDraft((value) => ({ ...value, providerRequirements }))
            }
          />

          <fieldset className="space-y-2">
            <legend className="text-[12px] font-medium text-foreground">
              {t('form.toolsMode')}
            </legend>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => setDraft((value) => ({ ...value, inheritTools: true }))}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-[11px]',
                  draft.inheritTools
                    ? 'border-primary/50 bg-primary/8 text-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                {t('form.toolsInherit')}
              </button>
              <button
                type="button"
                onClick={() => setDraft((value) => ({ ...value, inheritTools: false }))}
                className={cn(
                  'rounded-lg border px-3 py-1.5 text-[11px]',
                  !draft.inheritTools
                    ? 'border-primary/50 bg-primary/8 text-primary'
                    : 'border-border text-muted-foreground',
                )}
              >
                {t('form.toolsCustom')}
              </button>
            </div>
            {!draft.inheritTools && (
              <div className="space-y-3 rounded-xl border border-border/70 bg-muted/15 p-3">
                <div>
                  <div className="mb-2 text-[10px] font-medium text-foreground">
                    {t('form.builtinTools')}
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {BUILTIN_TOOLS.map((tool) => {
                      const checked = draft.tools.includes(tool)
                      return (
                        <label
                          key={tool}
                          className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] hover:bg-accent/60"
                        >
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setDraft((value) => ({
                                ...value,
                                tools: checked
                                  ? value.tools.filter((item) => item !== tool)
                                  : [...value.tools, tool],
                              }))
                            }
                          />
                          <span className="font-mono">{tool}</span>
                        </label>
                      )
                    })}
                  </div>
                </div>

                {draft.resourceSelection.mode === 'selected' ? (
                  <div className="border-t border-border/60 pt-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="text-[10px] font-medium text-foreground">
                          {t('form.extensionTools')}
                        </div>
                        <div className="mt-0.5 text-[9px] text-muted-foreground">
                          {t('form.extensionToolsHint')}
                        </div>
                      </div>
                      <div className="flex gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((value) => ({ ...value, inheritExtensionTools: true }))
                          }
                          className={cn(
                            'rounded-md border px-2 py-1 text-[9px]',
                            draft.inheritExtensionTools
                              ? 'border-primary/45 bg-primary/8 text-primary'
                              : 'border-border text-muted-foreground',
                          )}
                        >
                          {t('form.extensionToolsAll')}
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            setDraft((value) => ({ ...value, inheritExtensionTools: false }))
                          }
                          className={cn(
                            'rounded-md border px-2 py-1 text-[9px]',
                            !draft.inheritExtensionTools
                              ? 'border-primary/45 bg-primary/8 text-primary'
                              : 'border-border text-muted-foreground',
                          )}
                        >
                          {t('form.extensionToolsCustom')}
                        </button>
                      </div>
                    </div>
                    {selectedExtensionTools.length === 0 ? (
                      <p className="mt-2 text-[9px] text-muted-foreground">
                        {t('form.extensionToolsEmpty')}
                      </p>
                    ) : !draft.inheritExtensionTools ? (
                      <div className="mt-2 flex flex-wrap gap-2">
                        {selectedExtensionTools.map((tool) => {
                          const checked = draft.extensionTools.includes(tool)
                          return (
                            <label
                              key={tool}
                              className="flex cursor-pointer items-center gap-1.5 rounded-md px-2 py-1 text-[11px] hover:bg-accent/60"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() =>
                                  setDraft((value) => ({
                                    ...value,
                                    extensionTools: checked
                                      ? value.extensionTools.filter((item) => item !== tool)
                                      : [...value.extensionTools, tool],
                                  }))
                                }
                              />
                              <span className="font-mono">{tool}</span>
                            </label>
                          )
                        })}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )}
              </fieldset>

              <AgentPiResourcesEditor
                selection={draft.resourceSelection}
                catalog={preview?.catalog}
                loading={previewLoading}
                onChange={(resourceSelection) =>
                  setDraft((value) => ({ ...value, resourceSelection }))
                }
              />
            </div>

            <div className="min-w-0 border-t border-border/60 pt-5 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0">
              <AgentEffectiveConfigPreview
                preview={preview}
                loading={previewLoading}
                model={draft.modelId}
                thinking={draft.thinkingLevel}
                promptMode={draft.promptMode}
                tools={draft.inheritTools ? undefined : draft.tools}
                extensionTools={
                  draft.inheritTools || draft.inheritExtensionTools
                    ? undefined
                    : draft.extensionTools.filter((tool) => selectedExtensionTools.includes(tool))
                }
                providerRequirements={draft.providerRequirements}
                providerIssues={providerIssues}
              />
            </div>
          </div>
        </div>

        <div className="flex justify-end gap-2 border-t border-border/60 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-border px-3.5 py-2 text-[12px] text-muted-foreground hover:bg-accent"
          >
            {t('form.cancel')}
          </button>
          <button
            type="button"
            disabled={
              !draft.name.trim() ||
              !draft.systemPrompt.trim() ||
              providerIssues.length > 0 ||
              saving
            }
            onClick={() => void save()}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-45"
          >
            {saving && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {saving ? t('form.saving') : t('form.save')}
          </button>
        </div>
      </div>
    </div>
  )
}
function AgentProfileCard({
  profile,
  onEdit,
  onDuplicate,
  onArchive,
  onUse,
  onPackage,
  onVersions,
  onOpen,
  asset,
}: {
  profile: AgentProfile
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
  onUse: () => void
  onPackage: () => void
  onVersions: () => void
  onOpen: () => void
  asset?: AgentAssetSummary
}) {
  const { t, i18n } = useTranslation('agents')
  const updated = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(profile.updatedAt)

  return (
    <article className="flex min-h-[220px] flex-col rounded-2xl border border-border/70 bg-card/40 p-5 shadow-sm transition-colors hover:border-primary/25">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary">
          <Bot className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <button type="button" onClick={onOpen} className="block max-w-full text-left"><h3 className="truncate text-[15px] font-semibold text-foreground hover:text-primary">{profile.name}</h3></button>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {profile.description || t(`promptMode.${profile.promptMode}`)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
        {profile.importProvenance ? <span className="rounded-md bg-primary/10 px-2 py-1 text-primary" title={profile.importProvenance.sourceVersionDigest}>{t('packageImport.sourceBadge', { number: profile.importProvenance.sourceVersionNumber })}</span> : null}
        {asset?.latestVersion ? (
          <span className={cn('rounded-md px-2 py-1', asset.latestVersion.status === 'candidate' ? 'bg-amber-500/10 text-amber-700 dark:text-amber-300' : 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300')}>
            v{asset.latestVersion.number} · {t(`versions.status.${asset.latestVersion.status}`)}
          </span>
        ) : null}
        <span className="rounded-md bg-muted/60 px-2 py-1">
          {t(`promptMode.${profile.promptMode}`)}
        </span>
        <span className="rounded-md bg-muted/60 px-2 py-1">
          {t('model')}: {profile.modelId || t('inherits')}
        </span>
        <span className="rounded-md bg-muted/60 px-2 py-1">
          {t('thinking')}: {profile.thinkingLevel || t('inherits')}
        </span>
        <span className="rounded-md bg-muted/60 px-2 py-1">
          {t('tools')}: {profile.tools === undefined ? t('inherits') : profile.tools.length}
        </span>
        {profile.tools !== undefined ? (
          <span className="rounded-md bg-muted/60 px-2 py-1">
            {t('composer.extensionTools')}:{' '}
            {profile.extensionTools === undefined
              ? t('composer.allSelectedExtensionTools')
              : profile.extensionTools.length}
          </span>
        ) : null}
        <span className="rounded-md bg-muted/60 px-2 py-1">
          {t('composer.piResources')}:{' '}
          {profile.resourceSelection?.mode === 'selected'
            ? profile.resourceSelection.packageIds.length +
              profile.resourceSelection.resourceIds.length
            : t('inherits')}
        </span>
      </div>

      {asset ? (
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <div className={cn('rounded-lg border px-2.5 py-2', asset.building ? 'border-amber-500/25 bg-amber-500/[0.05]' : 'border-border/50 bg-muted/20')}>
            <div className="text-[9px] font-medium text-muted-foreground">{t('assets.building')}</div>
            <div className="mt-0.5 text-[10px] font-semibold text-foreground">{asset.building ? t('assets.version', { number: asset.latestVersion?.number }) : t('assets.none')}</div>
          </div>
          <div className={cn('rounded-lg border px-2.5 py-2', asset.validated ? 'border-emerald-500/25 bg-emerald-500/[0.05]' : 'border-border/50 bg-muted/20')}>
            <div className="text-[9px] font-medium text-muted-foreground">{t('assets.validated')}</div>
            <div className="mt-0.5 text-[10px] font-semibold text-foreground">{asset.latestValidatedVersion ? t('assets.version', { number: asset.latestValidatedVersion.number }) : t('assets.none')}</div>
          </div>
          <div className={cn('rounded-lg border px-2.5 py-2', asset.package.status === 'available' ? 'border-primary/25 bg-primary/[0.04]' : 'border-border/50 bg-muted/20')}>
            <div className="text-[9px] font-medium text-muted-foreground">{t('assets.delivery')}</div>
            <div className="mt-0.5 truncate text-[10px] font-semibold text-foreground">{t(`assets.packageStatus.${asset.package.status}`, { number: asset.package.versionNumber })}</div>
          </div>
        </div>
      ) : null}

      <div className="mt-auto pt-5">
        <div className="mb-3 text-[10px] text-muted-foreground/70">
          {t('updatedAt', { time: updated })}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onUse}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground"
          >
            <Play className="h-3.5 w-3.5" />
            {t('use')}
          </button>
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Pencil className="h-3.5 w-3.5" />
            {t('edit')}
          </button>
          <button
            type="button"
            onClick={onDuplicate}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Copy className="h-3.5 w-3.5" />
            {t('duplicate')}
          </button>
          <button
            type="button"
            onClick={onVersions}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <GitBranch className="h-3.5 w-3.5" />
            {t('versions.open')}
          </button>
          <button
            type="button"
            onClick={onPackage}
            className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <PackageCheck className="h-3.5 w-3.5" />
            {t('packageStudio.open')}
          </button>
          <button
            type="button"
            onClick={onArchive}
            className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
          >
            <Archive className="h-3.5 w-3.5" />
            {t('archive')}
          </button>
        </div>
      </div>
    </article>
  )
}

function AgentRunsWorkspace({
  runs,
  loading,
  busyId,
  onRefresh,
  onOpenSource,
  onOpenArtifact,
  onSaveCase,
  onSaveScenario,
  onRunAgain,
  onEditAgent,
  onManageResources,
}: {
  runs: AgentRunHistoryItem[]
  loading: boolean
  busyId: string | null
  onRefresh: () => void
  onOpenSource: (run: AgentRunHistoryItem) => void
  onOpenArtifact: (run: AgentRunHistoryItem, path: string) => void
  onSaveCase: (run: AgentRunHistoryItem) => void
  onSaveScenario: (run: AgentRunHistoryItem) => void
  onRunAgain: () => void
  onEditAgent: () => void
  onManageResources: () => void
}) {
  const { t } = useTranslation('agents')
  const [selectedFile, setSelectedFile] = useState<string | null>(null)
  const [comparisonFile, setComparisonFile] = useState<string>('')
  const [expandedTurnId, setExpandedTurnId] = useState<string | null>(null)
  const selected = runs.find((run) => run.sessionFile === selectedFile) ?? runs[0]
  const comparison = runs.find((run) => run.sessionFile === comparisonFile)
  const runtimeDrift = useMemo(
    () => selected ? buildAgentRuntimeCapabilityDrift(selected) : null,
    [selected],
  )
  const runComparison = useMemo(
    () => selected && comparison ? buildAgentRunComparison(selected, comparison) : null,
    [selected, comparison],
  )
  const diagnosis = useMemo(() => selected ? buildAgentRunDiagnosis(selected) : null, [selected])
  const formatTokens = (value: number | null | undefined) => value == null ? '—' : new Intl.NumberFormat(undefined, { notation: value >= 10_000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value)
  const formatComparisonValue = (key: string, value: number | null) => value == null ? '—' : key === 'cost' ? `$${value.toFixed(4)}` : key === 'contextPercent' ? `${value.toFixed(1)}%` : formatTokens(value)
  const runDiagnosisAction = (action: AgentRunDiagnosisAction) => {
    if (!selected) return
    if (action === 'open-run') onOpenSource(selected)
    else if (action === 'rerun') onRunAgain()
    else if (action === 'manage-resources') onManageResources()
    else onEditAgent()
  }

  useEffect(() => {
    if (!runs.length) setSelectedFile(null)
    else if (!runs.some((run) => run.sessionFile === selectedFile)) setSelectedFile(runs[0].sessionFile)
  }, [runs, selectedFile])

  return <section className="mt-5 rounded-2xl border border-border/70 bg-card/30 p-5">
    <div className="flex items-center justify-between gap-3"><div><h2 className="text-[14px] font-semibold">{t('workspace.runs.title')}</h2><p className="mt-0.5 text-[10px] text-muted-foreground">{t('workspace.runs.hint')}</p></div><button type="button" onClick={onRefresh} disabled={loading} aria-label={t('workspace.runs.refresh')} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-40"><RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} /></button></div>
    {loading ? <div className="mt-4 text-[10px] text-muted-foreground">{t('workspace.runs.loading')}</div> : !selected ? <div className="mt-4 rounded-xl border border-dashed border-border px-4 py-5 text-center text-[10px] text-muted-foreground">{t('workspace.runs.empty')}</div> : <div className="mt-4 grid min-h-[19rem] overflow-hidden rounded-xl border border-border/60 lg:grid-cols-[minmax(13rem,0.72fr)_minmax(0,1.45fr)]">
      <div className="border-b border-border/60 bg-muted/10 p-2 lg:border-b-0 lg:border-r"><div className="px-2 pb-2 pt-1 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t('workspace.runs.list')}</div><div className="space-y-1">{runs.map((run) => <button key={run.sessionFile} type="button" onClick={() => setSelectedFile(run.sessionFile)} className={cn('w-full rounded-lg px-2.5 py-2.5 text-left transition-colors', selected.sessionFile === run.sessionFile ? 'bg-primary/10 text-foreground' : 'hover:bg-accent')}><div className="flex items-center gap-2"><span className={cn('h-2 w-2 shrink-0 rounded-full', run.status === 'running' ? 'animate-pulse bg-primary' : run.status === 'failed' ? 'bg-destructive' : 'bg-emerald-500')} /><span className="min-w-0 flex-1 truncate text-[10px] font-medium">{run.title}</span><span className="text-[8px] text-muted-foreground">{run.versionNumber ? `v${run.versionNumber}` : '—'}</span></div><div className="mt-1 pl-4 text-[8px] text-muted-foreground">{new Date(run.updatedAt).toLocaleString()}</div></button>)}</div></div>
      <div className="min-w-0 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0"><div className="text-[9px] font-medium text-primary">{t(`workspace.runs.status.${selected.status}`)}</div><h3 className="mt-1 truncate text-[15px] font-semibold">{selected.title}</h3><div className="mt-1 text-[9px] text-muted-foreground">{selected.versionNumber ? `Agent v${selected.versionNumber}` : t('workspace.runs.unversioned')} · {selected.modelId || t('inherits')} · {selected.thinkingLevel || t('inherits')}</div></div><div className="flex flex-wrap gap-1.5"><button type="button" onClick={() => onOpenSource(selected)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[9px] hover:bg-accent"><ExternalLink className="h-3 w-3" />{t('workspace.runs.open')}</button><button type="button" disabled={!!selected.caseId || busyId === selected.sessionId} onClick={() => onSaveCase(selected)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[9px] hover:bg-accent disabled:opacity-40"><FolderArchive className="h-3 w-3" />{selected.caseId ? t('workspace.runs.savedCase') : t('workspace.runs.saveCase')}</button><button type="button" disabled={busyId === selected.sessionId} onClick={() => onSaveScenario(selected)} className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[9px] hover:bg-accent disabled:opacity-40"><FlaskConical className="h-3 w-3" />{t('workspace.runs.saveScenario')}</button></div></div>
        <div className="mt-4 grid gap-2 sm:grid-cols-3">{[[t('workspace.runs.metric.messages'), selected.messageCount], [t('workspace.runs.metric.files'), selected.artifacts.filter((item) => item.kind === 'file').length], [t('workspace.runs.metric.case'), selected.caseId ? t('workspace.available') : t('workspace.unavailable')]].map(([label, value]) => <div key={String(label)} className="rounded-lg border border-border/50 bg-background/60 px-3 py-2"><div className="text-[8px] text-muted-foreground">{label}</div><div className="mt-0.5 text-[12px] font-semibold">{value}</div></div>)}</div>
        {selected.failureReason ? <div className="mt-3 rounded-lg border border-destructive/20 bg-destructive/[0.05] px-3 py-2"><div className="text-[8px] font-semibold text-destructive">{t('workspace.runs.failure')}</div><div className="mt-1 text-[9px] text-destructive">{selected.failureReason}</div></div> : null}
        {diagnosis ? <div className="mt-4 rounded-xl border border-border/50 bg-background/40 p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-[9px] font-semibold">{t('workspace.runs.diagnosis.title')}</div><div className="mt-0.5 text-[8px] text-muted-foreground">{t('workspace.runs.diagnosis.hint')}</div></div><span className={cn('rounded-full px-2 py-1 text-[8px] font-medium', diagnosis.status === 'blocked' ? 'bg-destructive/10 text-destructive' : diagnosis.status === 'attention' ? 'bg-amber-500/10 text-amber-700' : diagnosis.status === 'healthy' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-muted-foreground')}>{t(`workspace.runs.diagnosis.status.${diagnosis.status}`)}</span></div>{diagnosis.issues.length ? <div className="mt-2 space-y-1.5">{diagnosis.issues.map((issue) => <div key={issue.code} className="flex items-start gap-2 rounded-lg border border-border/40 px-2.5 py-2"><span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', issue.severity === 'critical' ? 'bg-destructive' : issue.severity === 'warning' ? 'bg-amber-500' : 'bg-muted-foreground')} /><div className="min-w-0 flex-1"><div className="text-[8px] font-semibold">{t(`workspace.runs.diagnosis.issue.${issue.code}.title`)}</div><div className="mt-0.5 text-[8px] text-muted-foreground">{t(`workspace.runs.diagnosis.issue.${issue.code}.body`, issue.facts)}</div></div></div>)}</div> : <div className="mt-2 text-[8px] text-muted-foreground">{t('workspace.runs.diagnosis.healthy')}</div>}{diagnosis.primaryAction ? <div className="mt-2 flex justify-end"><button type="button" onClick={() => runDiagnosisAction(diagnosis.primaryAction!)} className="rounded-md bg-primary px-2.5 py-1.5 text-[8px] font-medium text-primary-foreground">{t(`workspace.runs.diagnosis.action.${diagnosis.primaryAction}`)}</button></div> : null}</div> : null}
        {selected.observability ? <div className="mt-4 rounded-xl border border-border/50 bg-background/40 p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-[9px] font-semibold">{t('workspace.runs.observability.title')}</div><div className="mt-0.5 text-[8px] text-muted-foreground">{t('workspace.runs.observability.hint')}</div></div><span className={cn('rounded-full px-2 py-1 text-[8px] font-medium', selected.observability.health === 'critical' ? 'bg-destructive/10 text-destructive' : selected.observability.health === 'warning' ? 'bg-amber-500/10 text-amber-700' : selected.observability.health === 'healthy' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-muted-foreground')}>{t(`workspace.runs.observability.health.${selected.observability.health}`)}</span></div><div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{[[t('workspace.runs.observability.context'), selected.observability.context?.percent == null ? '—' : `${selected.observability.context.percent.toFixed(1)}%`], [t('workspace.runs.observability.contextDelta'), formatTokens(selected.observability.context?.deltaTokens)], [t('workspace.runs.observability.tokens'), `${formatTokens(selected.observability.usage.inputTokens)} / ${formatTokens(selected.observability.usage.outputTokens)}`], [t('workspace.runs.observability.tools'), `${selected.observability.tools.totalCalls} / ${selected.observability.tools.failedCalls}`]].map(([label, value]) => <div key={String(label)} className="rounded-lg bg-muted/30 px-2.5 py-2"><div className="text-[7px] text-muted-foreground">{label}</div><div className="mt-0.5 text-[10px] font-semibold">{value}</div></div>)}</div><div className="mt-2 text-[8px] text-muted-foreground">{t('workspace.runs.observability.invoked', { names: selected.observability.tools.invoked.length ? selected.observability.tools.invoked.map((item) => `${item.name}×${item.calls}`).join(', ') : t('workspace.runs.runtimeEvidence.none') })}</div>{selected.observability.tools.loadedNotInvoked.length ? <div className="mt-1 text-[8px] text-muted-foreground">{t('workspace.runs.observability.loadedNotInvoked', { names: selected.observability.tools.loadedNotInvoked.join(', ') })}</div> : null}{selected.observability.signals.length ? <div className="mt-2 flex flex-wrap gap-1">{selected.observability.signals.map((signal) => <span key={signal} className={cn('rounded px-1.5 py-0.5 text-[7px]', signal === 'context-critical' || signal === 'tool-failures' ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/10 text-amber-700')}>{t(`workspace.runs.observability.signal.${signal}`)}</span>)}</div> : null}{!selected.observability.completeTimeline ? <div className="mt-2 text-[7px] text-amber-700">{t('workspace.runs.observability.sampled', { count: selected.observability.analyzedItems })}</div> : null}</div> : null}
        {selected.turns?.length ? <div className="mt-4 border-t border-border/50 pt-3"><div className="flex items-center justify-between"><div><div className="text-[9px] font-semibold">{t('workspace.runs.turns.title')}</div><div className="mt-0.5 text-[8px] text-muted-foreground">{t('workspace.runs.turns.hint')}</div></div><span className="text-[8px] text-muted-foreground">{t('workspace.runs.turns.count', { count: selected.turns.length })}</span></div><div className="mt-2 space-y-1.5">{selected.turns.map((turn, index) => { const expanded = expandedTurnId === turn.runId; const failed = turn.status === 'failed' || turn.tools.some((tool) => tool.failed > 0); const delta = turn.contextBefore?.tokens != null && turn.contextAfter?.tokens != null ? turn.contextAfter.tokens - turn.contextBefore.tokens : null; return <div key={turn.runId} className="rounded-lg border border-border/40 bg-background/40"><button type="button" onClick={() => setExpandedTurnId(expanded ? null : turn.runId)} className="flex w-full items-center gap-2 px-2.5 py-2 text-left"><span className={cn('h-1.5 w-1.5 rounded-full', turn.status === 'running' ? 'animate-pulse bg-primary' : failed ? 'bg-destructive' : 'bg-emerald-500')} /><span className="text-[8px] font-semibold">{t('workspace.runs.turns.turn', { number: index + 1 })}</span><span className="text-[7px] text-muted-foreground">{new Date(turn.startedAt).toLocaleTimeString()}</span><span className="ml-auto text-[7px] text-muted-foreground">{formatTokens(turn.usage.input)} / {formatTokens(turn.usage.output)} Token · {turn.tools.reduce((sum, tool) => sum + tool.calls, 0)} {t('workspace.runs.turns.toolCalls')}</span><span className="text-[8px] text-muted-foreground">{expanded ? '−' : '+'}</span></button>{expanded ? <div className="border-t border-border/40 px-3 py-2.5"><div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">{[[t('workspace.runs.turns.duration'), turn.endedAt ? `${Math.max(0, turn.endedAt - turn.startedAt)} ms` : '—'], [t('workspace.runs.turns.contextDelta'), formatTokens(delta)], [t('workspace.runs.turns.cache'), `${formatTokens(turn.usage.cacheRead)} / ${formatTokens(turn.usage.cacheWrite)}`], [t('workspace.runs.turns.cost'), turn.usage.cost ? `$${turn.usage.cost.toFixed(4)}` : '—']].map(([label, value]) => <div key={String(label)}><div className="text-[7px] text-muted-foreground">{label}</div><div className="mt-0.5 text-[8px] font-medium">{value}</div></div>)}</div><div className="mt-2 text-[8px] text-muted-foreground">{t('workspace.runs.turns.tools', { names: turn.tools.length ? turn.tools.map((tool) => `${tool.name}×${tool.calls}${tool.failed ? ` (${tool.failed}!)` : ''}`).join(', ') : t('workspace.runs.runtimeEvidence.none') })}</div>{turn.compactions.count ? <div className="mt-1 text-[8px] text-amber-700">{t('workspace.runs.turns.compactions', { count: turn.compactions.count, tokens: formatTokens(turn.compactions.tokensSaved) })}</div> : null}{turn.files.length ? <div className="mt-1 text-[8px] text-muted-foreground">{t('workspace.runs.turns.files', { names: turn.files.join(', ') })}</div> : null}{turn.errors.length ? <div className="mt-1 space-y-1">{turn.errors.map((error) => <div key={error} className="text-[8px] text-destructive">{error}</div>)}</div> : null}</div> : null}</div> })}</div></div> : <div className="mt-4 border-t border-border/50 pt-3 text-[8px] text-muted-foreground">{t('workspace.runs.turns.legacy')}</div>}
        <div className="mt-4"><div className="text-[9px] font-semibold">{t('workspace.runs.artifacts')}</div>{selected.artifacts.length ? <div className="mt-2 flex flex-wrap gap-1.5">{selected.artifacts.map((artifact, index) => artifact.kind === 'file' && artifact.path ? <button type="button" key={`${artifact.path}-${index}`} onClick={() => onOpenArtifact(selected, artifact.path!)} className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[9px] hover:border-primary/30 hover:text-primary"><FileOutput className="h-3 w-3" />{artifact.name}</button> : <span key={`${artifact.id || index}`} className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-[9px] text-muted-foreground"><FolderArchive className="h-3 w-3" />{artifact.name}</span>)}</div> : <div className="mt-2 text-[9px] text-muted-foreground">{t('workspace.runs.noArtifacts')}</div>}</div>
        <div className="mt-4 border-t border-border/50 pt-3"><div className="flex items-center justify-between gap-3"><div><div className="text-[9px] font-semibold">{t('workspace.runs.runtimeEvidence.title')}</div><div className="mt-0.5 text-[8px] text-muted-foreground">{t('workspace.runs.runtimeEvidence.hint')}</div></div>{runtimeDrift ? <span className={cn('rounded-full px-2 py-1 text-[8px] font-medium', runtimeDrift.status === 'drift' ? 'bg-destructive/10 text-destructive' : runtimeDrift.status === 'exact' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700')}>{t(`workspace.runs.runtimeEvidence.status.${runtimeDrift.status}`)}</span> : null}</div>{runtimeDrift?.status === 'no-evidence' ? <div className="mt-2 text-[8px] text-muted-foreground">{t('workspace.runs.runtimeEvidence.legacy')}</div> : <div className="mt-2 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">{runtimeDrift?.groups.map((group) => <div key={group.group} className="rounded-lg border border-border/40 px-2.5 py-2"><div className="flex items-center justify-between gap-2"><span className="text-[8px] font-semibold">{t(`workspace.runs.runtimeEvidence.group.${group.group}`)}</span><span className="text-[7px] text-muted-foreground">{group.tracked ? t('workspace.runs.runtimeEvidence.tracked') : t('workspace.runs.runtimeEvidence.inherited')}</span></div><div className="mt-1 text-[7px] text-muted-foreground">{t('workspace.runs.runtimeEvidence.actual', { names: group.actual.length ? group.actual.join(', ') : t('workspace.runs.runtimeEvidence.none') })}</div>{group.tracked ? <div className="mt-1 space-y-0.5 text-[7px]"><div className="text-emerald-700">{t('workspace.runs.runtimeEvidence.matched', { count: group.matched.length })}</div>{group.missing.length ? <div className="text-destructive">{t('workspace.runs.runtimeEvidence.missing', { names: group.missing.join(', ') })}</div> : null}{group.unexpected.length ? <div className="text-amber-700">{t('workspace.runs.runtimeEvidence.unexpected', { names: group.unexpected.join(', ') })}</div> : null}</div> : <div className="mt-1 text-[7px] text-muted-foreground">{t('workspace.runs.runtimeEvidence.notCompared')}</div>}</div>)}</div>}</div>
        {runs.length > 1 ? <div className="mt-4 border-t border-border/50 pt-3"><div className="flex flex-wrap items-center gap-2"><span className="text-[9px] font-semibold">{t('workspace.runs.compare')}</span><select aria-label={t('workspace.runs.compare')} value={comparisonFile} onChange={(event) => setComparisonFile(event.target.value)} className="rounded-md border border-border bg-background px-2 py-1 text-[9px]"><option value="">{t('workspace.runs.compareChoose')}</option>{runs.filter((run) => run.sessionFile !== selected.sessionFile).map((run) => <option key={run.sessionFile} value={run.sessionFile}>{run.versionNumber ? `v${run.versionNumber} · ` : ''}{run.title}</option>)}</select></div>{comparison && runComparison ? <div className="mt-3 rounded-xl border border-border/50 bg-background/40 p-3"><div className="flex items-start justify-between gap-3"><div><div className="text-[9px] font-semibold">{t('workspace.runs.comparison.title')}</div><div className="mt-0.5 text-[8px] text-muted-foreground">{t('workspace.runs.comparison.hint')}</div></div><span className={cn('rounded-full px-2 py-1 text-[8px] font-medium', runComparison.status === 'attention' ? 'bg-amber-500/10 text-amber-700' : runComparison.status === 'changed' ? 'bg-primary/10 text-primary' : runComparison.status === 'stable' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-muted text-muted-foreground')}>{t(`workspace.runs.comparison.status.${runComparison.status}`)}</span></div><div className="mt-3 grid gap-1.5 sm:grid-cols-2 xl:grid-cols-5">{runComparison.metrics.map((metric) => <div key={metric.key} className="rounded-lg bg-muted/30 px-2.5 py-2"><div className="text-[7px] text-muted-foreground">{t(`workspace.runs.comparison.metric.${metric.key}`)}</div><div className="mt-0.5 flex items-baseline justify-between gap-2"><span className="text-[9px] font-semibold">{formatComparisonValue(metric.key, metric.current)}</span><span className={cn('text-[7px]', metric.delta == null || metric.delta === 0 ? 'text-muted-foreground' : metric.delta > 0 ? 'text-amber-700' : 'text-emerald-700')}>{metric.delta == null ? '—' : `${metric.delta > 0 ? '+' : ''}${formatComparisonValue(metric.key, metric.delta)}`}</span></div><div className="mt-0.5 text-[7px] text-muted-foreground">{t('workspace.runs.comparison.baseline', { value: formatComparisonValue(metric.key, metric.baseline) })}</div></div>)}</div><div className="mt-3 grid gap-2 sm:grid-cols-2"><div className="rounded-lg border border-border/40 px-2.5 py-2"><div className="text-[8px] font-semibold">{t('workspace.runs.comparison.configuration')}</div><div className="mt-1 text-[8px] text-muted-foreground">{(['versionChanged', 'modelChanged', 'thinkingChanged'] as const).map((key) => `${t(`workspace.runs.comparison.config.${key}`)}: ${runComparison.configuration[key] == null ? t('workspace.runs.comparison.unknown') : runComparison.configuration[key] ? t('workspace.runs.comparison.changed') : t('workspace.runs.comparison.same')}`).join(' · ')}</div></div><div className="rounded-lg border border-border/40 px-2.5 py-2"><div className="text-[8px] font-semibold">{t('workspace.runs.comparison.capabilities')}</div>{runComparison.capabilities.comparable ? <div className="mt-1 space-y-0.5 text-[8px] text-muted-foreground"><div>{t('workspace.runs.comparison.added', { names: runComparison.capabilities.added.length ? runComparison.capabilities.added.join(', ') : t('workspace.runs.runtimeEvidence.none') })}</div><div>{t('workspace.runs.comparison.removed', { names: runComparison.capabilities.removed.length ? runComparison.capabilities.removed.join(', ') : t('workspace.runs.runtimeEvidence.none') })}</div></div> : <div className="mt-1 text-[8px] text-muted-foreground">{t('workspace.runs.comparison.notComparable')}</div>}</div></div>{runComparison.signals.length ? <div className="mt-2 flex flex-wrap gap-1">{runComparison.signals.map((signal) => <span key={signal} className={cn('rounded px-1.5 py-0.5 text-[7px]', ['context-pressure-up', 'tool-failures-up', 'cost-up', 'tokens-up'].includes(signal) ? 'bg-amber-500/10 text-amber-700' : 'bg-muted text-muted-foreground')}>{t(`workspace.runs.comparison.signal.${signal}`)}</span>)}</div> : null}</div> : null}</div> : null}
      </div>
    </div>}
  </section>
}

function AgentWorkspace({
  profile,
  asset,
  onBack,
  onUse,
  onEdit,
  onVersions,
  onPackage,
  onOpenRunSource,
  onOpenRunArtifact,
}: {
  profile: AgentProfile
  asset?: AgentAssetSummary
  onBack: () => void
  onUse: () => void
  onEdit: () => void
  onVersions: () => void
  onPackage: () => void
  onOpenRunSource: (workspacePath: string, sessionId: string, sessionFile: string) => Promise<void>
  onOpenRunArtifact: (workspacePath: string, path: string) => Promise<void>
}) {
  const { t } = useTranslation('agents')
  const latest = asset?.latestVersion
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const [evidence, setEvidence] = useState<AgentWorkspaceEvidence | null>(null)
  const [evidenceLoading, setEvidenceLoading] = useState(true)
  const [evidenceError, setEvidenceError] = useState(false)
  const [preflight, setPreflight] = useState<AgentRunPreflight | null>(null)
  const [preflightLoading, setPreflightLoading] = useState(true)
  const [preflightError, setPreflightError] = useState(false)
  const [preflightRefresh, setPreflightRefresh] = useState(0)
  const [runs, setRuns] = useState<AgentRunHistoryItem[]>([])
  const [runsLoading, setRunsLoading] = useState(true)
  const [runBusy, setRunBusy] = useState<string | null>(null)
  const [capabilityPreview, setCapabilityPreview] = useState<AgentProfilePreviewResponse | null>(null)
  const selectedResources = profile.resourceSelection?.mode === 'selected'
    ? profile.resourceSelection.packageIds.length + profile.resourceSelection.resourceIds.length
    : null
  useEffect(() => {
    let active = true
    setEvidenceLoading(true)
    setEvidenceError(false)
    void Promise.all([
      ipcClient.invoke('agentCase.list', { workspacePath: currentWorkspace || undefined, includeArchived: false }),
      ipcClient.invoke('agentEvaluation.list', { workspacePath: currentWorkspace || undefined, includeArchived: false }),
    ]).then(async ([caseResponse, evaluationResponse]) => {
      const suites = evaluationResponse.suites ?? []
      const suite = suites.find((item: AgentEvaluationSuiteBundle) => item.suite.status === 'active' && item.suite.profileId === profile.id && item.suite.versionId === latest?.id)
      const gate = latest?.status === 'candidate' && suite
        ? (await ipcClient.invoke('agentVersion.readiness', { versionId: latest.id, suiteId: suite.suite.id })).gate
        : undefined
      if (!active) return
      setEvidence(buildAgentWorkspaceEvidence({
        profileId: profile.id,
        latestVersionId: latest?.id,
        latestVersionStatus: latest?.status,
        packageAvailable: asset?.package.status === 'available',
        cases: caseResponse.cases ?? [],
        suites,
        gate,
      }))
    }).catch(() => {
      if (active) setEvidenceError(true)
    }).finally(() => {
      if (active) setEvidenceLoading(false)
    })
    return () => { active = false }
  }, [asset?.package.status, currentWorkspace, latest?.id, latest?.status, profile.id])

  useEffect(() => {
    let active = true
    setPreflightLoading(true)
    setPreflightError(false)
    void Promise.all([
      ipcClient.invoke('agentProfile.preview', {
        workspaceId: currentWorkspace || undefined,
        resourceSelection: profile.resourceSelection,
      }),
      ipcClient.invoke('model.list', { scope: 'available' }),
    ]).then(([preview, modelResponse]) => {
      if (!active) return
      setCapabilityPreview(preview)
      setPreflight(buildAgentRunPreflight({
        profile,
        preview,
        availableModels: modelResponse.models.map((model: ModelRow) => ({
          id: model.id,
          provider: model.provider,
          reasoning: model.reasoning,
          input: model.input,
          contextWindow: model.contextWindow,
        })),
      }))
    }).catch(() => {
      if (active) {
        setCapabilityPreview(null)
        setPreflightError(true)
      }
    }).finally(() => {
      if (active) setPreflightLoading(false)
    })
    return () => { active = false }
  }, [currentWorkspace, preflightRefresh, profile])

  const refreshRuns = () => {
    if (!currentWorkspace) {
      setRuns([])
      setRunsLoading(false)
      return Promise.resolve()
    }
    setRunsLoading(true)
    return ipcClient.invoke('agentRun.list', { profileId: profile.id, workspacePath: currentWorkspace, limit: 8 })
      .then((response) => setRuns(response.runs ?? []))
      .catch(() => setRuns([]))
      .finally(() => setRunsLoading(false))
  }

  useEffect(() => {
    void refreshRuns()
  }, [currentWorkspace, profile.id])

  useEffect(() => {
    const refresh = () => setPreflightRefresh((value) => value + 1)
    window.addEventListener('vizruna:provider-auth-completed', refresh)
    return () => window.removeEventListener('vizruna:provider-auth-completed', refresh)
  }, [])

  const nextAction = evidence?.nextAction ?? (!latest ? 'edit-agent' : latest.status === 'candidate' ? 'create-evaluation' : asset?.package.status !== 'available' ? 'package' : 'run')
  const effectiveNextAction = nextAction === 'run' && preflight?.canRun === false ? 'repair-run' : nextAction
  const canRunNow = preflight?.canRun !== false
  const capabilityManifest = useMemo(
    () => capabilityPreview?.resourceSnapshot ? buildAgentCapabilityManifest(profile, capabilityPreview) : null,
    [capabilityPreview, profile],
  )

  const evaluate = () => {
    if (!latest) return
    openAgentEvaluationSetup({
      profileId: profile.id,
      versionId: latest.id,
      suiteId: evidence?.activeSuiteId,
      createSuite: !evidence?.activeSuiteId,
    })
  }

  const continueLifecycle = () => {
    if (effectiveNextAction === 'repair-run') {
      const blocked = preflight?.checks.find((check) => check.status === 'blocked')
      if (blocked?.code === 'model' || blocked?.code === 'provider') {
        return openProviderAuthManager({ mode: 'login', providerId: profile.modelId?.split('/')[0] })
      }
      window.dispatchEvent(new CustomEvent('vizruna:open-pi-resources'))
      return
    }
    if (effectiveNextAction === 'edit-agent') return onEdit()
    if (['create-evaluation', 'add-scenarios', 'run-evaluation', 'review-runs'].includes(effectiveNextAction)) return evaluate()
    if (effectiveNextAction === 'fix-validation' || effectiveNextAction === 'validate-version') return onVersions()
    if (effectiveNextAction === 'package') return onPackage()
    return onUse()
  }

  const repairPreflightCheck = (code: AgentRunPreflight['checks'][number]['code']) => {
    if (code === 'model' || code === 'provider') {
      openProviderAuthManager({ mode: 'login', providerId: profile.modelId?.split('/')[0] })
      return
    }
    window.dispatchEvent(new CustomEvent(code === 'runtime' ? 'vizruna:open-pi-settings' : 'vizruna:open-pi-resources'))
  }

  const saveRunAsCase = async (run: AgentRunHistoryItem) => {
    if (run.caseId) return
    setRunBusy(run.sessionId)
    try {
      await ipcClient.invoke('agentCase.create', {
        name: run.title,
        summary: t('workspace.runs.caseSummary', { agent: profile.name }),
        tags: ['agent-run'],
        workspacePath: run.workspacePath,
        sourceSessionId: run.sessionId,
        sourceSessionFile: run.sessionFile,
        modelId: run.modelId,
        thinkingLevel: run.thinkingLevel,
      })
      toast.success(t('workspace.runs.caseCreated'))
      await refreshRuns()
    } catch (error) {
      toast.error(t('workspace.runs.caseCreateFailed'), { description: String(error) })
    } finally {
      setRunBusy(null)
    }
  }

  const saveRunAsScenario = async (run: AgentRunHistoryItem) => {
    if (!evidence?.activeSuiteId) {
      evaluate()
      return
    }
    setRunBusy(run.sessionId)
    try {
      let caseId = run.caseId
      if (!caseId) {
        const created = await ipcClient.invoke('agentCase.create', {
          name: run.title,
          summary: t('workspace.runs.caseSummary', { agent: profile.name }),
          tags: ['agent-run'],
          workspacePath: run.workspacePath,
          sourceSessionId: run.sessionId,
          sourceSessionFile: run.sessionFile,
          modelId: run.modelId,
          thinkingLevel: run.thinkingLevel,
        })
        caseId = created.agentCase.id
      }
      const scenario = await ipcClient.invoke('agentEvaluation.scenario.create', {
        suiteId: evidence.activeSuiteId,
        name: run.title,
        prompt: run.prompt || run.title,
        tags: ['from-run'],
      })
      await ipcClient.invoke('agentEvaluation.attachCase', {
        suiteId: evidence.activeSuiteId,
        scenarioId: scenario.scenario.id,
        caseId,
      })
      toast.success(t('workspace.runs.scenarioCreated'))
      await refreshRuns()
    } catch (error) {
      toast.error(t('workspace.runs.scenarioCreateFailed'), { description: String(error) })
    } finally {
      setRunBusy(null)
    }
  }

  return <div className="h-full overflow-y-auto bg-background">
    <div className="mx-auto max-w-6xl px-6 py-6 lg:px-10">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"><ArrowLeft className="h-3.5 w-3.5" />{t('workspace.back')}</button>
      <header className="mt-4 flex flex-col gap-5 rounded-2xl border border-border/70 bg-card/40 p-5 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><Bot className="h-6 w-6" /></div>
          <div className="min-w-0"><div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-primary">{t('workspace.eyebrow')}</div><h1 className="mt-1 truncate text-[22px] font-semibold">{profile.name}</h1><p className="mt-1 max-w-2xl text-[12px] leading-relaxed text-muted-foreground">{profile.description || t(`promptMode.${profile.promptMode}`)}</p></div>
        </div>
        <div className="flex flex-wrap gap-2"><button type="button" onClick={onUse} disabled={!canRunNow || preflightLoading} title={!canRunNow ? t('workspace.preflightBlockedHint') : undefined} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground disabled:opacity-40"><Play className="h-3.5 w-3.5" />{t('workspace.run')}</button><button type="button" onClick={onEdit} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] hover:bg-accent"><Pencil className="h-3.5 w-3.5" />{t('edit')}</button></div>
      </header>

      <section className="mt-5 rounded-2xl border border-border/70 bg-card/30 p-5">
        <div className="flex items-center justify-between gap-3"><div><h2 className="text-[14px] font-semibold">{t('workspace.lifecycle')}</h2><p className="mt-0.5 text-[10px] text-muted-foreground">{t('workspace.lifecycleHint')}</p></div><span className="rounded-full bg-primary/10 px-2.5 py-1 text-[9px] font-medium text-primary">{evidenceLoading ? t('workspace.evidenceLoading') : t(`workspace.next.${nextAction}`)}</span></div>
        <div className="mt-4 grid gap-3 md:grid-cols-4">{[
          ['configured', true, latest ? `v${latest.number}` : t('workspace.saved')],
          ['versioned', !!latest, latest ? t(`versions.status.${latest.status}`) : t('workspace.pending')],
          ['validated', !!asset?.validated, asset?.latestValidatedVersion ? `v${asset.latestValidatedVersion.number}` : t('workspace.pending')],
          ['delivered', asset?.package.status === 'available', t(`assets.packageStatus.${asset?.package.status || 'not-exported'}`, { number: asset?.package.versionNumber })],
        ].map(([key, complete, detail]) => <div key={String(key)} className={cn('rounded-xl border px-3.5 py-3', complete ? 'border-emerald-500/25 bg-emerald-500/[0.05]' : 'border-border/60 bg-muted/15')}><div className="flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', complete ? 'bg-emerald-500' : 'bg-muted-foreground/35')} /><span className="text-[10px] font-semibold">{t(`workspace.stage.${key}`)}</span></div><div className="mt-2 text-[10px] text-muted-foreground">{detail}</div></div>)}</div>
      </section>

      <section className="mt-5 rounded-2xl border border-border/70 bg-card/30 p-5">
        <div><h2 className="text-[14px] font-semibold">{t('workspace.evidence')}</h2><p className="mt-0.5 text-[10px] text-muted-foreground">{t('workspace.evidenceHint')}</p></div>
        {evidenceError ? <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] px-3.5 py-3 text-[10px] text-amber-800 dark:text-amber-200">{t('workspace.evidenceFailed')}</div> : <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{[
          [t('workspace.metric.cases'), evidence?.cases ?? 0, t('workspace.metric.reproducible', { count: evidence?.reproducibleCases ?? 0 })],
          [t('workspace.metric.suites'), evidence?.suites ?? 0, t('workspace.metric.currentSuite', { value: evidence?.activeSuiteId ? t('workspace.available') : t('workspace.unavailable') })],
          [t('workspace.metric.scenarios'), evidence?.scenarios ?? 0, t('workspace.metric.completed', { completed: evidence?.completedScenarios ?? 0, total: evidence?.scenarios ?? 0 })],
          [t('workspace.metric.results'), evidence?.passedScenarios ?? 0, t('workspace.metric.verdicts', { failed: evidence?.failedScenarios ?? 0, pending: evidence?.pendingReviewScenarios ?? 0 })],
        ].map(([label, value, hint]) => <div key={String(label)} className="rounded-xl border border-border/50 bg-background/50 px-3.5 py-3"><div className="text-[9px] text-muted-foreground">{label}</div><div className="mt-1 text-[20px] font-semibold">{evidenceLoading ? '—' : value}</div><div className="mt-1 text-[9px] text-muted-foreground">{hint}</div></div>)}</div>}
        {evidence?.validationBlockers.length ? <div className="mt-4 rounded-xl border border-amber-500/25 bg-amber-500/[0.05] px-3.5 py-3"><div className="text-[10px] font-semibold text-amber-900 dark:text-amber-100">{t('workspace.validationBlockers')}</div><ul className="mt-2 space-y-1 text-[10px] text-amber-800 dark:text-amber-200">{evidence.validationBlockers.map((blocker) => <li key={blocker}>• {t(`versions.blockers.${blocker}`)}</li>)}</ul></div> : null}
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3"><div><div className="text-[10px] font-semibold">{t(`workspace.next.${effectiveNextAction}`)}</div><div className="mt-0.5 text-[9px] text-muted-foreground">{t(`workspace.nextHint.${effectiveNextAction}`)}</div></div><button type="button" onClick={continueLifecycle} disabled={evidenceLoading || preflightLoading} className="inline-flex shrink-0 items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[10px] font-medium text-primary-foreground disabled:opacity-40"><Play className="h-3.5 w-3.5" />{t(`workspace.nextAction.${effectiveNextAction}`)}</button></div>
      </section>

      <AgentRunsWorkspace runs={runs} loading={runsLoading} busyId={runBusy} onRefresh={() => void refreshRuns()} onOpenSource={(run) => void onOpenRunSource(run.workspacePath, run.sessionId, run.sessionFile)} onOpenArtifact={(run, path) => void onOpenRunArtifact(run.workspacePath, path)} onSaveCase={(run) => void saveRunAsCase(run)} onSaveScenario={(run) => void saveRunAsScenario(run)} onRunAgain={onUse} onEditAgent={onEdit} onManageResources={() => window.dispatchEvent(new CustomEvent('vizruna:open-pi-resources'))} />

      <section className="mt-5 rounded-2xl border border-border/70 bg-card/30 p-5">
        <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-[14px] font-semibold">{t('workspace.capabilities.title')}</h2><p className="mt-0.5 text-[10px] text-muted-foreground">{t('workspace.capabilities.hint')}</p></div><div className="flex items-center gap-2">{capabilityManifest ? <span className={cn('rounded-full px-2.5 py-1 text-[9px] font-medium', capabilityManifest.canRun ? 'bg-emerald-500/10 text-emerald-700' : 'bg-destructive/10 text-destructive')}>{capabilityManifest.canRun ? t('workspace.capabilities.ready') : t('workspace.capabilities.blocked', { count: capabilityManifest.totals.blocked })}</span> : null}<button type="button" onClick={() => window.dispatchEvent(new CustomEvent('vizruna:open-pi-resources'))} className="rounded-lg border border-border px-2.5 py-1.5 text-[9px] hover:bg-accent">{t('workspace.capabilities.manage')}</button></div></div>
        {!capabilityManifest ? <div className="mt-4 text-[10px] text-muted-foreground">{t('workspace.capabilities.loading')}</div> : <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-3">{(['tools', 'packages', 'extensions', 'skills', 'prompts', 'context'] as const).map((group) => <div key={group} className="rounded-xl border border-border/50 bg-background/50 p-3"><div className="flex items-center justify-between gap-2"><span className="text-[10px] font-semibold">{t(`workspace.capabilities.group.${group}`)}</span><span className="text-[8px] text-muted-foreground">{capabilityManifest.groups[group].length}</span></div>{capabilityManifest.groups[group].length ? <div className="mt-2 space-y-1.5">{capabilityManifest.groups[group].map((item) => <div key={item.id} className="rounded-lg border border-border/40 px-2.5 py-2"><div className="flex items-start gap-2"><span className={cn('mt-1 h-1.5 w-1.5 shrink-0 rounded-full', item.status === 'ready' ? 'bg-emerald-500' : item.status === 'blocked' ? 'bg-destructive' : 'bg-amber-500')} /><div className="min-w-0 flex-1"><div className="flex items-center justify-between gap-2"><span className="truncate text-[9px] font-medium">{item.name === 'inherit' ? t('workspace.capabilities.inherit') : item.name === 'none' ? t('workspace.capabilities.none') : item.name}</span><span className={cn('shrink-0 text-[8px]', item.status === 'blocked' ? 'text-destructive' : 'text-muted-foreground')}>{t(`workspace.capabilities.status.${item.status}`)}</span></div>{item.source ? <div className="mt-0.5 truncate text-[8px] text-muted-foreground">{item.scope ? `${t(`workspace.capabilities.scope.${item.scope}`)} · ` : ''}{item.source}</div> : null}{item.details?.length ? <div className="mt-1 flex flex-wrap gap-1">{item.details.map((detail) => <span key={detail} className="rounded bg-muted px-1 py-0.5 text-[7px] text-muted-foreground">{detail}</span>)}</div> : null}</div></div></div>)}</div> : <div className="mt-2 text-[8px] text-muted-foreground">{t('workspace.capabilities.empty')}</div>}</div>)}</div>}
      </section>

      <div className="mt-5 grid gap-5 lg:grid-cols-[minmax(0,1.45fr)_minmax(17rem,0.7fr)]">
        <div className="space-y-5"><section className="rounded-2xl border border-border/70 bg-card/30 p-5"><h2 className="text-[14px] font-semibold">{t('workspace.effectiveConfig')}</h2><p className="mt-0.5 text-[10px] text-muted-foreground">{t('workspace.effectiveConfigHint')}</p><div className="mt-4 grid gap-3 sm:grid-cols-2">{[
          [t('model'), profile.modelId || t('inherits')],
          [t('thinking'), profile.thinkingLevel || t('inherits')],
          [t('tools'), profile.tools === undefined ? t('inherits') : String(profile.tools.length)],
          [t('composer.extensionTools'), profile.extensionTools === undefined ? t('composer.allSelectedExtensionTools') : String(profile.extensionTools.length)],
          [t('composer.piResources'), selectedResources === null ? t('inherits') : String(selectedResources)],
          [t('form.promptMode'), t(`promptMode.${profile.promptMode}`)],
        ].map(([label, value]) => <div key={label} className="rounded-xl border border-border/50 bg-background/50 px-3.5 py-3"><div className="text-[9px] text-muted-foreground">{label}</div><div className="mt-1 truncate text-[11px] font-medium">{value}</div></div>)}</div></section>
        <section className="rounded-2xl border border-border/70 bg-card/30 p-5"><div className="flex items-center justify-between gap-3"><div><h2 className="text-[14px] font-semibold">{t('workspace.preflight')}</h2><p className="mt-0.5 text-[10px] text-muted-foreground">{t('workspace.preflightHint')}</p></div><div className="flex items-center gap-2"><button type="button" onClick={() => setPreflightRefresh((value) => value + 1)} disabled={preflightLoading} aria-label={t('workspace.preflightRetry')} className="rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-40"><RefreshCw className={cn('h-3.5 w-3.5', preflightLoading && 'animate-spin')} /></button><span className={cn('rounded-full px-2.5 py-1 text-[9px] font-medium', preflight?.status === 'blocked' ? 'bg-destructive/10 text-destructive' : preflight?.status === 'ready' ? 'bg-emerald-500/10 text-emerald-700' : 'bg-amber-500/10 text-amber-700')}>{preflightLoading ? t('workspace.preflightLoading') : preflightError ? t('workspace.preflightFailed') : t(`workspace.preflightStatus.${preflight?.status || 'needs-setup'}`)}</span></div></div><div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">{preflight?.checks.map((check) => <div key={check.code} className="flex items-center justify-between gap-2 rounded-lg border border-border/50 bg-background/50 px-3 py-2.5"><span className="text-[10px] font-medium">{t(`workspace.preflightCheck.${check.code}`)}</span><div className="flex items-center gap-1.5"><span className={cn('text-[9px]', check.status === 'blocked' ? 'text-destructive' : check.status === 'ready' ? 'text-emerald-700' : 'text-amber-700')}>{t(`workspace.preflightCheckStatus.${check.status}`)}</span>{check.status === 'blocked' ? <button type="button" onClick={() => repairPreflightCheck(check.code)} className="rounded-md border border-border px-1.5 py-0.5 text-[8px] font-medium hover:bg-accent">{t('workspace.preflightRepair')}</button> : null}</div></div>)}</div>{preflightError ? <button type="button" onClick={() => setPreflightRefresh((value) => value + 1)} className="mt-3 inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[9px] hover:bg-accent"><RefreshCw className="h-3 w-3" />{t('workspace.preflightRetry')}</button> : null}</section></div>
        <aside className="rounded-2xl border border-border/70 bg-card/30 p-5"><h2 className="text-[14px] font-semibold">{t('workspace.actions')}</h2><p className="mt-0.5 text-[10px] text-muted-foreground">{t('workspace.actionsHint')}</p><div className="mt-4 space-y-2"><button type="button" onClick={onVersions} className="flex w-full items-center gap-3 rounded-xl border border-border/60 px-3.5 py-3 text-left hover:bg-accent"><GitBranch className="h-4 w-4 text-amber-600" /><span><span className="block text-[11px] font-medium">{t('versions.open')}</span><span className="block text-[9px] text-muted-foreground">{t('workspace.actionHint.versions')}</span></span></button><button type="button" disabled={!latest} onClick={evaluate} className="flex w-full items-center gap-3 rounded-xl border border-border/60 px-3.5 py-3 text-left hover:bg-accent disabled:opacity-40"><FlaskConical className="h-4 w-4 text-emerald-600" /><span><span className="block text-[11px] font-medium">{t('workspace.evaluate')}</span><span className="block text-[9px] text-muted-foreground">{t('workspace.actionHint.evaluate')}</span></span></button><button type="button" onClick={onPackage} className="flex w-full items-center gap-3 rounded-xl border border-border/60 px-3.5 py-3 text-left hover:bg-accent"><PackageCheck className="h-4 w-4 text-primary" /><span><span className="block text-[11px] font-medium">{t('packageStudio.open')}</span><span className="block text-[9px] text-muted-foreground">{t('workspace.actionHint.package')}</span></span></button></div></aside>
      </div>
    </div>
  </div>
}

export function AgentProfilesPage({ onUseAgent, onOpenRunSource = async () => {}, onOpenRunArtifact = async () => {} }: { onUseAgent: (profileId: string, versionId?: string) => void; onOpenRunSource?: (workspacePath: string, sessionId: string, sessionFile: string) => Promise<void>; onOpenRunArtifact?: (workspacePath: string, path: string) => Promise<void> }) {
  const { t } = useTranslation('agents')
  const profiles = useAgentProfileStore((state) => state.profiles)
  const loading = useAgentProfileStore((state) => state.loading)
  const loadProfiles = useAgentProfileStore((state) => state.loadProfiles)
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const [dialog, setDialog] = useState<{
    mode: DialogMode
    profile?: AgentProfile
  } | null>(null)
  const [packageProfile, setPackageProfile] = useState<AgentProfile | null>(null)
  const [packageImportOpen, setPackageImportOpen] = useState(false)
  const [versionProfile, setVersionProfile] = useState<AgentProfile | null>(null)
  const [catalog, setCatalog] = useState<AgentAssetCatalog>(EMPTY_ASSET_CATALOG)
  const [assetView, setAssetView] = useState<AgentAssetView>('all')
  const [workspaceProfileId, setWorkspaceProfileId] = useState<string | null>(() => window.sessionStorage.getItem(AGENT_WORKSPACE_SESSION_KEY))

  const refreshAssets = async () => {
    const response = await ipcClient.invoke('agentAsset.list', {
      workspacePath: currentWorkspace || undefined,
    })
    setCatalog(response?.catalog ?? EMPTY_ASSET_CATALOG)
  }

  const refreshLibrary = async () => {
    await Promise.all([loadProfiles(true), refreshAssets()])
  }

  useEffect(() => {
    void refreshLibrary().catch((error) => {
      toast.error(t('messages.loadFailed'), { description: String(error) })
    })
  }, [currentWorkspace, loadProfiles, t])

  const assetByProfile = useMemo(() => {
    const map = new Map<string, AgentAssetSummary>()
    for (const asset of catalog.assets) map.set(asset.profileId, asset)
    return map
  }, [catalog.assets])

  const visibleProfiles = useMemo(
    () => profiles.filter((profile) => {
      const asset = assetByProfile.get(profile.id)
      return asset ? agentAssetMatchesView(asset, assetView) : assetView === 'all'
    }),
    [assetByProfile, assetView, profiles],
  )

  const workspaceProfile = profiles.find((profile) => profile.id === workspaceProfileId)
  if (workspaceProfile) {
    const workspaceAsset = assetByProfile.get(workspaceProfile.id)
    return <>
      <AgentWorkspace profile={workspaceProfile} asset={workspaceAsset} onBack={() => { window.sessionStorage.removeItem(AGENT_WORKSPACE_SESSION_KEY); setWorkspaceProfileId(null) }} onUse={() => onUseAgent(workspaceProfile.id, workspaceAsset?.latestVersion?.id)} onEdit={() => setDialog({ mode: 'edit', profile: workspaceProfile })} onVersions={() => setVersionProfile(workspaceProfile)} onPackage={() => setPackageProfile(workspaceProfile)} onOpenRunSource={onOpenRunSource} onOpenRunArtifact={onOpenRunArtifact} />
      {dialog ? <AgentProfileDialog mode={dialog.mode} profile={dialog.profile} onClose={() => setDialog(null)} onSaved={() => void refreshLibrary()} /> : null}
      {packageProfile ? <PiPackageStudioDialog profile={packageProfile} onChanged={() => void refreshAssets()} onClose={() => { setPackageProfile(null); void refreshAssets() }} /> : null}
      {versionProfile ? <AgentVersionHistoryDialog profile={versionProfile} onClose={() => setVersionProfile(null)} onUse={(versionId) => { onUseAgent(versionProfile.id, versionId); setVersionProfile(null) }} onChanged={() => void refreshAssets()} /> : null}
    </>
  }

  const archive = async (profile: AgentProfile) => {
    if (!window.confirm(t('messages.archiveConfirm', { name: profile.name }))) return
    try {
      await ipcClient.invoke('agentProfile.archive', { id: profile.id })
      if (useAgentProfileStore.getState().selectedProfileId === profile.id) {
        useAgentProfileStore.getState().selectProfile(null)
      }
      await loadProfiles(true)
      await refreshAssets()
      toast.success(t('messages.archived'))
    } catch (error) {
      toast.error(t('messages.archiveFailed'), { description: String(error) })
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl px-8 py-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-primary">
              <Bot className="h-5 w-5" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">
                {t('eyebrow')}
              </span>
            </div>
            <h1 className="text-[24px] font-semibold tracking-tight text-foreground">
              {t('title')}
            </h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              {t('description')}
            </p>
          </div>
          <div className="flex shrink-0 gap-2"><button type="button" onClick={() => setPackageImportOpen(true)} className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-[13px] font-medium text-foreground hover:bg-accent"><PackageOpen className="h-4 w-4" />{t('packageImport.open')}</button><button type="button" onClick={() => setDialog({ mode: 'create' })} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90"><Plus className="h-4 w-4" />{t('new')}</button></div>
        </div>

        <div className="mt-7 grid gap-3 sm:grid-cols-3">
          {(['building', 'validated', 'delivered'] as const).map((view) => (
            <button key={view} type="button" onClick={() => setAssetView(view)} className={cn('rounded-xl border px-4 py-3 text-left transition-colors', assetView === view ? 'border-primary/35 bg-primary/[0.06]' : 'border-border/60 bg-card/30 hover:border-primary/20')}>
              <div className="flex items-center justify-between gap-3"><span className="text-[11px] font-medium text-muted-foreground">{t(`assets.${view}`)}</span>{view === 'validated' ? <ShieldCheck className="h-4 w-4 text-emerald-600" /> : view === 'delivered' ? <PackageCheck className="h-4 w-4 text-primary" /> : <GitBranch className="h-4 w-4 text-amber-600" />}</div>
              <div className="mt-1 text-[20px] font-semibold text-foreground">{catalog.counts[view]}</div>
              <div className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">{t(`assets.${view}Hint`)}</div>
            </button>
          ))}
        </div>

        <div className="mt-4 flex items-center justify-between gap-3 border-b border-border/60 pb-3 text-[12px] text-muted-foreground">
          <span>{t('assets.showing', { visible: visibleProfiles.length, total: profiles.length })}</span>
          {assetView !== 'all' ? <button type="button" onClick={() => setAssetView('all')} className="rounded-lg px-2.5 py-1 text-[11px] font-medium text-primary hover:bg-primary/5">{t('assets.showAll')}</button> : null}
        </div>

        {loading && profiles.length === 0 ? (
          <div className="flex min-h-[22rem] items-center justify-center text-muted-foreground">
            <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            {t('loading')}
          </div>
        ) : profiles.length === 0 ? (
          <div className="mt-5 flex min-h-[22rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/15 px-6 text-center">
            <Bot className="h-9 w-9 text-muted-foreground/45" />
            <h2 className="mt-4 text-[14px] font-semibold text-foreground">
              {t('empty.title')}
            </h2>
            <p className="mt-1 max-w-md text-[12px] leading-relaxed text-muted-foreground">
              {t('empty.description')}
            </p>
          </div>
        ) : visibleProfiles.length === 0 ? (
          <div className="mt-5 flex min-h-[16rem] flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/15 px-6 text-center">
            <Bot className="h-8 w-8 text-muted-foreground/40" />
            <h2 className="mt-3 text-[14px] font-semibold text-foreground">{t('assets.emptyView')}</h2>
            <p className="mt-1 max-w-md text-[12px] text-muted-foreground">{t('assets.emptyViewHint')}</p>
            <button type="button" onClick={() => setAssetView('all')} className="mt-4 rounded-lg border border-border px-3 py-1.5 text-[11px] text-foreground hover:bg-accent">{t('assets.showAll')}</button>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {visibleProfiles.map((profile) => (
              <AgentProfileCard
                key={profile.id}
                profile={profile}
                asset={assetByProfile.get(profile.id)}
                onUse={() => {
                  const version = assetByProfile.get(profile.id)?.latestVersion
                  if (version) onUseAgent(profile.id, version.id)
                  else onUseAgent(profile.id)
                }}
                onEdit={() => setDialog({ mode: 'edit', profile })}
                onDuplicate={() => setDialog({ mode: 'duplicate', profile })}
                onPackage={() => setPackageProfile(profile)}
                onVersions={() => setVersionProfile(profile)}
                onOpen={() => { window.sessionStorage.setItem(AGENT_WORKSPACE_SESSION_KEY, profile.id); setWorkspaceProfileId(profile.id) }}
                onArchive={() => void archive(profile)}
              />
            ))}
          </div>
        )}
      </div>

      {dialog && (
        <AgentProfileDialog
          mode={dialog.mode}
          profile={dialog.profile}
          onClose={() => setDialog(null)}
          onSaved={() => void refreshLibrary()}
        />
      )}
      {packageProfile ? (
        <PiPackageStudioDialog
          profile={packageProfile}
          onChanged={() => void refreshAssets()}
          onClose={() => {
            setPackageProfile(null)
            void refreshAssets()
          }}
        />
      ) : null}
      {packageImportOpen ? <PiPackageImportDialog onClose={() => setPackageImportOpen(false)} onImported={() => void refreshLibrary()} onEditImported={(profile) => { setPackageImportOpen(false); setDialog({ mode: 'edit', profile }) }} /> : null}
      {versionProfile ? (
        <AgentVersionHistoryDialog
          profile={versionProfile}
          onClose={() => setVersionProfile(null)}
          onUse={(versionId) => {
            onUseAgent(versionProfile.id, versionId)
            setVersionProfile(null)
          }}
          onChanged={() => void refreshAssets()}
        />
      ) : null}
    </div>
  )
}
