import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Bot,
  Copy,
  Loader2,
  Pencil,
  Play,
  Plus,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type {
  AgentProfile,
  AgentProfileCreateRequest,
  AgentProfileUpdateRequest,
} from '@shared/agent-profile'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useAgentProfileStore } from '@renderer/stores/agent-profile-store'

const BUILTIN_TOOLS = ['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'] as const
const DEFAULT_AGENT_TOOLS = ['read', 'bash', 'edit', 'write']
const THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'xhigh'] as const

type ModelRow = { id: string; provider: string; name?: string }
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
  const [draft, setDraft] = useState<AgentDraft>(() =>
    profile ? draftFromProfile(profile, mode === 'duplicate') : { ...EMPTY_DRAFT },
  )
  const [models, setModels] = useState<ModelRow[]>([])
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

  const save = async () => {
    const name = draft.name.trim()
    const systemPrompt = draft.systemPrompt.trim()
    if (!name || !systemPrompt || saving) return
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
      }
      const response =
        mode === 'edit' && profile
          ? await ipcClient.invoke('agentProfile.update', {
              id: profile.id,
              ...base,
              modelId: base.modelId ?? null,
              thinkingLevel: base.thinkingLevel ?? null,
              tools: base.tools ?? null,
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
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl">
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

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
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
              <div className="flex flex-wrap gap-2 rounded-xl border border-border/70 bg-muted/15 p-3">
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
            )}
          </fieldset>
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
            disabled={!draft.name.trim() || !draft.systemPrompt.trim() || saving}
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
}: {
  profile: AgentProfile
  onEdit: () => void
  onDuplicate: () => void
  onArchive: () => void
  onUse: () => void
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
          <h3 className="truncate text-[15px] font-semibold text-foreground">{profile.name}</h3>
          <p className="mt-1 line-clamp-2 text-[12px] leading-relaxed text-muted-foreground">
            {profile.description || t(`promptMode.${profile.promptMode}`)}
          </p>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
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
      </div>

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

export function AgentProfilesPage({ onUseAgent }: { onUseAgent: (profileId: string) => void }) {
  const { t } = useTranslation('agents')
  const profiles = useAgentProfileStore((state) => state.profiles)
  const loading = useAgentProfileStore((state) => state.loading)
  const loadProfiles = useAgentProfileStore((state) => state.loadProfiles)
  const [dialog, setDialog] = useState<{
    mode: DialogMode
    profile?: AgentProfile
  } | null>(null)

  useEffect(() => {
    void loadProfiles(true).catch((error) => {
      toast.error(t('messages.loadFailed'), { description: String(error) })
    })
  }, [loadProfiles, t])

  const archive = async (profile: AgentProfile) => {
    if (!window.confirm(t('messages.archiveConfirm', { name: profile.name }))) return
    try {
      await ipcClient.invoke('agentProfile.archive', { id: profile.id })
      if (useAgentProfileStore.getState().selectedProfileId === profile.id) {
        useAgentProfileStore.getState().selectProfile(null)
      }
      await loadProfiles(true)
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
          <button
            type="button"
            onClick={() => setDialog({ mode: 'create' })}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {t('new')}
          </button>
        </div>

        <div className="mt-7 border-b border-border/60 pb-3 text-[12px] text-muted-foreground">
          {t('count', { count: profiles.length })}
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
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {profiles.map((profile) => (
              <AgentProfileCard
                key={profile.id}
                profile={profile}
                onUse={() => onUseAgent(profile.id)}
                onEdit={() => setDialog({ mode: 'edit', profile })}
                onDuplicate={() => setDialog({ mode: 'duplicate', profile })}
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
          onSaved={() => void loadProfiles(true)}
        />
      )}
    </div>
  )
}
