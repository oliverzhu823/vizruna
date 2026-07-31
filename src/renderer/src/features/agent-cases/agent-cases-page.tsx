import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import {
  Archive,
  BriefcaseBusiness,
  CheckCircle2,
  CircleDashed,
  ExternalLink,
  Folder,
  Loader2,
  Plus,
  RotateCcw,
  Tags,
} from 'lucide-react'
import type { AgentCase, AgentCaseCreateRequest } from '@shared/agent-case'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

type SourceConversation = {
  workspacePath: string
  sessionId: string
  sessionFile: string
  title: string
  modelId?: string
  thinkingLevel?: string
}

function projectName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

function parseTags(value: string): string[] {
  return [...new Set(value.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean))].slice(0, 20)
}

function AgentCaseCreateDialog({
  source,
  onCancel,
  onCreate,
}: {
  source: SourceConversation
  onCancel: () => void
  onCreate: (request: AgentCaseCreateRequest) => Promise<void>
}) {
  const { t } = useTranslation('cases')
  const titleId = useId()
  const [name, setName] = useState(source.title)
  const [summary, setSummary] = useState('')
  const [tags, setTags] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    const normalizedName = name.trim()
    if (!normalizedName || submitting) return
    setSubmitting(true)
    try {
      await onCreate({
        name: normalizedName,
        summary: summary.trim() || undefined,
        tags: parseTags(tags),
        workspacePath: source.workspacePath,
        sourceSessionId: source.sessionId,
        sourceSessionFile: source.sessionFile,
        modelId: source.modelId,
        thinkingLevel: source.thinkingLevel,
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div
      className="electron-no-drag fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !submitting) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-2xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <div className="mb-5">
          <h2 id={titleId} className="text-[16px] font-semibold text-foreground">
            {t('create.title')}
          </h2>
          <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
            {t('create.description')}
          </p>
        </div>

        <div className="space-y-4">
          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-foreground-secondary">
              {t('create.name')}
            </span>
            <input
              autoFocus
              value={name}
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-primary"
              placeholder={t('create.namePlaceholder')}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-foreground-secondary">
              {t('create.summary')}
            </span>
            <textarea
              value={summary}
              maxLength={2000}
              rows={3}
              onChange={(event) => setSummary(event.target.value)}
              className="w-full resize-none rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-primary"
              placeholder={t('create.summaryPlaceholder')}
            />
          </label>

          <label className="block">
            <span className="mb-1.5 block text-[12px] font-medium text-foreground-secondary">
              {t('create.tags')}
            </span>
            <input
              value={tags}
              maxLength={400}
              onChange={(event) => setTags(event.target.value)}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none transition-colors focus:border-primary"
              placeholder={t('create.tagsPlaceholder')}
            />
          </label>

          <div className="rounded-lg border border-border/60 bg-muted/35 px-3 py-2.5 text-[12px] text-muted-foreground">
            <div className="font-medium text-foreground-secondary">{source.title}</div>
            <div className="mt-1 truncate">{source.workspacePath}</div>
          </div>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            disabled={submitting}
            className="rounded-lg px-3 py-2 text-[13px] text-foreground-secondary hover:bg-accent disabled:opacity-50"
            onClick={onCancel}
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            disabled={!name.trim() || submitting}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            onClick={() => void submit()}
          >
            {submitting && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {t('create.submit')}
          </button>
        </div>
      </div>
    </div>
  )
}

function AgentCaseCard({
  agentCase,
  busy,
  onOpen,
  onSetStatus,
  onArchive,
}: {
  agentCase: AgentCase
  busy: boolean
  onOpen: () => void
  onSetStatus: (status: 'draft' | 'validated') => void
  onArchive: () => void
}) {
  const { t, i18n } = useTranslation('cases')
  const archived = agentCase.status === 'archived'
  const validated = agentCase.status === 'validated'
  const formattedDate = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, {
        dateStyle: 'medium',
        timeStyle: 'short',
      }).format(agentCase.updatedAt),
    [agentCase.updatedAt, i18n.language],
  )

  return (
    <article className="rounded-xl border border-border/70 bg-card p-4 shadow-sm transition-shadow hover:shadow-md">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="truncate text-[14px] font-semibold text-foreground">{agentCase.name}</h3>
            <span
              className={cn(
                'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-medium',
                archived
                  ? 'bg-muted text-muted-foreground'
                  : validated
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/12 text-amber-700 dark:text-amber-300',
              )}
            >
              {validated ? <CheckCircle2 className="h-3 w-3" /> : <CircleDashed className="h-3 w-3" />}
              {t(`status.${agentCase.status}`)}
            </span>
          </div>
          {agentCase.summary && (
            <p className="mt-2 line-clamp-2 text-[12px] leading-relaxed text-foreground-secondary">
              {agentCase.summary}
            </p>
          )}
        </div>
        <button
          type="button"
          disabled={busy}
          onClick={onOpen}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 py-1.5 text-[12px] font-medium text-foreground-secondary hover:bg-accent hover:text-foreground disabled:opacity-50"
        >
          <ExternalLink className="h-3.5 w-3.5" />
          {t('actions.openSource')}
        </button>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-[11px] text-muted-foreground">
        <span className="inline-flex min-w-0 items-center gap-1.5">
          <Folder className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{projectName(agentCase.workspacePath)}</span>
        </span>
        {agentCase.modelId && <span>{agentCase.modelId}</span>}
        <span>{formattedDate}</span>
      </div>

      {agentCase.tags.length > 0 && (
        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <Tags className="mr-0.5 h-3.5 w-3.5 text-muted-foreground" />
          {agentCase.tags.map((tag) => (
            <span key={tag} className="rounded-md bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {tag}
            </span>
          ))}
        </div>
      )}

      <div className="mt-4 flex items-center gap-2 border-t border-border/50 pt-3">
        {archived ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => onSetStatus('draft')}
            className="inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-foreground-secondary hover:bg-accent disabled:opacity-50"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('actions.restore')}
          </button>
        ) : (
          <>
            <button
              type="button"
              disabled={busy}
              onClick={() => onSetStatus(validated ? 'draft' : 'validated')}
              className="rounded-md px-2 py-1 text-[11px] text-foreground-secondary hover:bg-accent disabled:opacity-50"
            >
              {validated ? t('actions.markDraft') : t('actions.markValidated')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onArchive}
              className="ml-auto inline-flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
            >
              <Archive className="h-3.5 w-3.5" />
              {t('actions.archive')}
            </button>
          </>
        )}
      </div>
    </article>
  )
}

export function AgentCasesPage({
  onOpenSource,
}: {
  onOpenSource: (agentCase: AgentCase) => Promise<void>
}) {
  const { t } = useTranslation('cases')
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const currentSessionId = useUIStore((state) => state.currentSessionId)
  const historySessionFile = useUIStore((state) => state.historySessionFile)
  const sessions = useUIStore((state) => state.sessions)
  const runModel = useUIStore((state) => state.runState.model)
  const runThinking = useUIStore((state) => state.runState.thinkingLevel)
  const lastThinking = useUIStore((state) => state.lastThinking)
  const [cases, setCases] = useState<AgentCase[]>([])
  const [loading, setLoading] = useState(true)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [createOpen, setCreateOpen] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)

  const source = useMemo<SourceConversation | null>(() => {
    if (!currentWorkspace || !currentSessionId) return null
    const session = sessions.find((item) => item.sessionId === currentSessionId)
    const sessionFile = historySessionFile || session?.sessionFile
    if (!sessionFile) return null
    return {
      workspacePath: currentWorkspace,
      sessionId: currentSessionId,
      sessionFile,
      title: session?.title || t('create.defaultName'),
      modelId: session?.modelId || runModel || undefined,
      thinkingLevel: runThinking || lastThinking || undefined,
    }
  }, [currentSessionId, currentWorkspace, historySessionFile, lastThinking, runModel, runThinking, sessions, t])

  const loadCases = useCallback(async (showArchived: boolean) => {
    setLoading(true)
    try {
      const response = await ipcClient.invoke('agentCase.list', { includeArchived: showArchived })
      setCases(response?.cases ?? [])
    } catch (error) {
      toast.error(t('messages.loadFailed'), { description: String(error) })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void loadCases(false)
  }, [loadCases])

  const toggleArchived = () => {
    const next = !includeArchived
    setIncludeArchived(next)
    void loadCases(next)
  }

  const createCase = async (request: AgentCaseCreateRequest) => {
    try {
      const response = await ipcClient.invoke('agentCase.create', request)
      setCases((previous) => [response.agentCase, ...previous])
      setCreateOpen(false)
      toast.success(t('messages.created'))
    } catch (error) {
      toast.error(t('messages.createFailed'), { description: String(error) })
      throw error
    }
  }

  const updateStatus = async (agentCase: AgentCase, status: 'draft' | 'validated') => {
    setBusyId(agentCase.id)
    try {
      const response = await ipcClient.invoke('agentCase.update', { id: agentCase.id, status })
      setCases((previous) => previous.map((item) => (item.id === agentCase.id ? response.agentCase : item)))
      toast.success(t('messages.updated'))
    } catch (error) {
      toast.error(t('messages.updateFailed'), { description: String(error) })
    } finally {
      setBusyId(null)
    }
  }

  const archiveCase = async (agentCase: AgentCase) => {
    setBusyId(agentCase.id)
    try {
      const response = await ipcClient.invoke('agentCase.archive', { id: agentCase.id })
      setCases((previous) =>
        includeArchived
          ? previous.map((item) => (item.id === agentCase.id ? response.agentCase : item))
          : previous.filter((item) => item.id !== agentCase.id),
      )
      toast.success(t('messages.archived'))
    } catch (error) {
      toast.error(t('messages.updateFailed'), { description: String(error) })
    } finally {
      setBusyId(null)
    }
  }

  const openSource = async (agentCase: AgentCase) => {
    setBusyId(agentCase.id)
    try {
      await onOpenSource(agentCase)
    } catch (error) {
      toast.error(t('messages.openFailed'), { description: String(error) })
      setBusyId(null)
    }
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto bg-background">
      <div className="mx-auto w-full max-w-6xl px-8 py-8">
        <div className="flex items-start justify-between gap-6">
          <div>
            <div className="mb-2 flex items-center gap-2 text-primary">
              <BriefcaseBusiness className="h-5 w-5" />
              <span className="text-[11px] font-semibold uppercase tracking-[0.16em]">{t('eyebrow')}</span>
            </div>
            <h1 className="text-[24px] font-semibold tracking-tight text-foreground">{t('title')}</h1>
            <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              {t('description')}
            </p>
          </div>
          <button
            type="button"
            disabled={!source}
            onClick={() => setCreateOpen(true)}
            title={!source ? t('create.disabledHint') : undefined}
            className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[13px] font-medium text-primary-foreground shadow-sm hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-45"
          >
            <Plus className="h-4 w-4" />
            {t('create.button')}
          </button>
        </div>

        <div className="mt-7 flex items-center justify-between border-b border-border/60 pb-3">
          <div className="text-[12px] text-muted-foreground">
            {t('count', { count: cases.length })}
          </div>
          <button
            type="button"
            disabled={loading}
            onClick={toggleArchived}
            className={cn(
              'rounded-md px-2.5 py-1.5 text-[11px] transition-colors',
              includeArchived
                ? 'bg-primary/10 text-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-foreground',
              loading && 'cursor-not-allowed opacity-50',
            )}
          >
            {includeArchived ? t('filters.hideArchived') : t('filters.showArchived')}
          </button>
        </div>

        {loading ? (
          <div className="flex min-h-[18rem] items-center justify-center text-muted-foreground">
            <Loader2 className="h-5 w-5 animate-spin" />
          </div>
        ) : cases.length === 0 ? (
          <div className="flex min-h-[22rem] flex-col items-center justify-center rounded-xl border border-dashed border-border/80 bg-muted/15 px-6 text-center">
            <BriefcaseBusiness className="h-9 w-9 text-muted-foreground/50" />
            <h2 className="mt-4 text-[14px] font-semibold text-foreground">{t('empty.title')}</h2>
            <p className="mt-1 max-w-md text-[12px] leading-relaxed text-muted-foreground">
              {source ? t('empty.withSource') : t('empty.withoutSource')}
            </p>
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-1 gap-4 xl:grid-cols-2">
            {cases.map((agentCase) => (
              <AgentCaseCard
                key={agentCase.id}
                agentCase={agentCase}
                busy={busyId === agentCase.id}
                onOpen={() => void openSource(agentCase)}
                onSetStatus={(status) => void updateStatus(agentCase, status)}
                onArchive={() => void archiveCase(agentCase)}
              />
            ))}
          </div>
        )}
      </div>

      {createOpen && source && (
        <AgentCaseCreateDialog
          source={source}
          onCancel={() => setCreateOpen(false)}
          onCreate={createCase}
        />
      )}
    </div>
  )
}
