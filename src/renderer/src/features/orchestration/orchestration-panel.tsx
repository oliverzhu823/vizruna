import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  ChevronRight,
  Circle,
  Clock3,
  ExternalLink,
  GitFork,
  Loader2,
  MessageSquarePlus,
  Network,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  Square,
  XCircle,
} from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type {
  AgentRelationship,
  OrchestrationEvidence,
  OrchestrationStatus,
} from '@shared/orchestration'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

const ACTIVE_STATUSES = new Set<OrchestrationStatus>([
  'queued',
  'starting',
  'running',
  'waiting',
  'timed_out',
])

const STATUS_STYLE: Record<OrchestrationStatus, string> = {
  queued: 'bg-muted text-muted-foreground',
  starting: 'bg-blue-500/15 text-blue-700 dark:text-blue-300',
  running: 'bg-green-500/15 text-green-700 dark:text-green-300',
  waiting: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  complete: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
  failed: 'bg-destructive/10 text-destructive',
  cancelled: 'bg-muted text-muted-foreground',
  interrupted: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  timed_out: 'bg-orange-500/15 text-orange-700 dark:text-orange-300',
}

function formatElapsed(startedAt: number | undefined, completedAt: number | undefined, now: number) {
  if (!startedAt) return '—'
  const seconds = Math.max(0, Math.floor(((completedAt || now) - startedAt) / 1_000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`
}

function statusIcon(status: OrchestrationStatus) {
  if (status === 'running' || status === 'starting') return Loader2
  if (status === 'complete') return CheckCircle2
  if (status === 'failed') return XCircle
  if (status === 'waiting' || status === 'timed_out' || status === 'interrupted') {
    return AlertTriangle
  }
  return Circle
}

type TaskNode = AgentRelationship & { children: TaskNode[] }

function buildTree(relationships: AgentRelationship[]): TaskNode[] {
  const childSessions = new Map(
    relationships
      .filter((relationship) => relationship.childSessionFile)
      .map((relationship) => [relationship.childSessionFile!, relationship.id]),
  )
  const byParent = new Map<string, AgentRelationship[]>()
  for (const relationship of relationships) {
    const list = byParent.get(relationship.parentSessionFile) || []
    list.push(relationship)
    byParent.set(relationship.parentSessionFile, list)
  }
  const makeNode = (relationship: AgentRelationship): TaskNode => ({
    ...relationship,
    children: (relationship.childSessionFile
      ? byParent.get(relationship.childSessionFile) || []
      : []
    ).map(makeNode),
  })
  return relationships
    .filter(
      (relationship) => !childSessions.has(relationship.parentSessionFile),
    )
    .map(makeNode)
}

function EvidenceList({ evidence }: { evidence: OrchestrationEvidence[] }) {
  const { t } = useTranslation('orchestration')
  if (evidence.length === 0) {
    return (
      <div className="text-[10px] text-muted-foreground/60">
        {t('evidence.empty')}
      </div>
    )
  }
  return (
    <div className="space-y-1">
      {evidence.slice(-12).map((item) => (
        <div
          key={item.id}
          className="rounded-md border border-border/40 bg-muted/20 px-2 py-1.5"
        >
          <div className="flex items-center justify-between gap-2 text-[10px]">
            <span className="truncate font-medium">{item.title}</span>
            <span
              className={cn(
                'shrink-0',
                item.status === 'passed' && 'text-green-600 dark:text-green-300',
                item.status === 'failed' && 'text-destructive',
              )}
            >
              {t(`evidence.status.${item.status}`)}
            </span>
          </div>
          {item.command && (
            <code className="mt-1 block break-all text-[9px] text-muted-foreground">
              {item.command}
            </code>
          )}
          {item.detail && (
            <p className="mt-1 line-clamp-3 whitespace-pre-wrap text-[9px] text-muted-foreground/75">
              {item.detail}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function TaskCard({
  task,
  depth,
  now,
  refresh,
}: {
  task: TaskNode
  depth: number
  now: number
  refresh: () => Promise<void>
}) {
  const { t } = useTranslation('orchestration')
  const [expanded, setExpanded] = useState(task.status === 'running')
  const [evidence, setEvidence] = useState<OrchestrationEvidence[]>([])
  const [message, setMessage] = useState('')
  const [pending, setPending] = useState(false)
  const Icon = statusIcon(task.status)

  const loadEvidence = useCallback(async () => {
    const response = await ipcClient.invoke('orchestration.read', {
      relationshipId: task.id,
    })
    setEvidence(response?.snapshot?.evidence || [])
  }, [task.id])

  useEffect(() => {
    if (expanded) void loadEvidence()
  }, [expanded, loadEvidence, task.sequence])

  const mutate = async (method: string, payload?: Record<string, unknown>) => {
    setPending(true)
    try {
      await ipcClient.invoke(method, {
        relationshipId: task.id,
        ...payload,
      })
      setMessage('')
      await refresh()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error))
    } finally {
      setPending(false)
    }
  }

  const openChild = async () => {
    if (!task.childSessionFile) return
    await activateWorkspace(task.childWorkspacePath, {
      sessionId: task.childSessionId || task.childSessionFile,
      sessionFile: task.childSessionFile,
    })
  }

  return (
    <div style={{ marginLeft: depth * 10 }}>
      <div className="overflow-hidden rounded-lg border border-border/50 bg-card/25">
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="flex w-full items-start gap-2 px-2.5 py-2 text-left hover:bg-accent/35"
          aria-expanded={expanded}
        >
          <ChevronRight
            className={cn(
              'mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform',
              expanded && 'rotate-90',
            )}
          />
          <Icon
            className={cn(
              'mt-0.5 h-3.5 w-3.5 shrink-0',
              (task.status === 'running' || task.status === 'starting') &&
                'animate-spin text-green-600',
            )}
          />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12px] font-medium">{task.name}</div>
            <div className="mt-1 flex flex-wrap items-center gap-1">
              <span
                className={cn(
                  'rounded px-1.5 py-0.5 text-[9px] font-medium',
                  STATUS_STYLE[task.status],
                )}
              >
                {t(`status.${task.status}`)}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {formatElapsed(task.startedAt, task.completedAt, now)}
              </span>
              <span className="text-[9px] text-muted-foreground">
                {task.environment === 'worktree'
                  ? t('environment.worktree')
                  : t('environment.local')}
              </span>
            </div>
          </div>
        </button>

        {expanded && (
          <div className="space-y-2 border-t border-border/40 px-2.5 py-2">
            <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-foreground-secondary">
              {task.goal}
            </p>
            <div className="grid grid-cols-2 gap-1 text-[9px] text-muted-foreground">
              <span className="truncate" title={task.model}>
                {t('meta.model')}: {task.model || '—'}
              </span>
              <span>
                {t('meta.verification')}:{' '}
                {t(`verification.${task.verificationStatus}`)}
              </span>
            </div>
            <div
              className="truncate font-mono text-[9px] text-muted-foreground"
              title={task.childWorkspacePath}
            >
              {t('meta.workspace')}: {task.childWorkspacePath}
            </div>
            {task.lastSummary && (
              <div className="rounded-md bg-muted/35 p-2 text-[10px] leading-relaxed text-foreground-secondary">
                {task.lastSummary}
              </div>
            )}
            {task.error && (
              <div className="rounded-md bg-destructive/8 p-2 text-[10px] text-destructive">
                {task.error}
              </div>
            )}
            <div className="flex flex-wrap gap-1">
              {task.childSessionFile && (
                <button
                  type="button"
                  onClick={openChild}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-foreground-secondary hover:bg-accent"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t('actions.open')}
                </button>
              )}
              {ACTIVE_STATUSES.has(task.status) && (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() => mutate('orchestration.stop')}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-destructive hover:bg-destructive/10 disabled:opacity-50"
                >
                  <Square className="h-3 w-3" />
                  {t('actions.stop')}
                </button>
              )}
              {(task.status === 'timed_out' ||
                task.status === 'interrupted') && (
                <>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      mutate('orchestration.resume', { action: 'continue' })
                    }
                    className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-foreground-secondary hover:bg-accent"
                  >
                    <Send className="h-3 w-3" />
                    {t('actions.continue')}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      mutate('orchestration.resume', { action: 'retry' })
                    }
                    className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-foreground-secondary hover:bg-accent"
                  >
                    <RotateCcw className="h-3 w-3" />
                    {t('actions.retry')}
                  </button>
                </>
              )}
            </div>
            {task.childSessionFile &&
              task.status !== 'cancelled' &&
              task.status !== 'failed' && (
                <div className="flex gap-1">
                  <input
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    placeholder={t('message.placeholder')}
                    className="min-w-0 flex-1 rounded-md border border-border bg-background px-2 py-1 text-[10px] outline-none focus:border-primary/50"
                  />
                  <button
                    type="button"
                    disabled={pending || !message.trim()}
                    onClick={() =>
                      mutate('orchestration.send', { text: message.trim() })
                    }
                    className="rounded-md bg-primary px-2 text-primary-foreground disabled:opacity-40"
                    aria-label={t('actions.send')}
                  >
                    <MessageSquarePlus className="h-3 w-3" />
                  </button>
                </div>
              )}
            <div>
              <div className="mb-1 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                {t('evidence.title')}
              </div>
              <EvidenceList evidence={evidence} />
            </div>
          </div>
        )}
      </div>
      {task.children.length > 0 && (
        <div className="mt-1 space-y-1 border-l border-border/50 pl-1">
          {task.children.map((child) => (
            <TaskCard
              key={child.id}
              task={child}
              depth={depth + 1}
              now={now}
              refresh={refresh}
            />
          ))}
        </div>
      )}
    </div>
  )
}

export function OrchestrationPanel() {
  const { t } = useTranslation('orchestration')
  const workspace = useUIStore((state) => state.currentWorkspace)
  const parentSessionFile = useUIStore((state) => state.historySessionFile)
  const relationshipMap = useUIStore(
    (state) => state.orchestrationRelationships,
  )
  const loading = useUIStore((state) => state.orchestrationLoading)
  const error = useUIStore((state) => state.orchestrationError)
  const setSnapshot = useUIStore((state) => state.setOrchestrationSnapshot)
  const setLoading = useUIStore((state) => state.setOrchestrationLoading)
  const setError = useUIStore((state) => state.setOrchestrationError)
  const [formOpen, setFormOpen] = useState(false)
  const [goal, setGoal] = useState('')
  const [name, setName] = useState('')
  const [environment, setEnvironment] = useState<'worktree' | 'local'>(
    'worktree',
  )
  const [timeoutMinutes, setTimeoutMinutes] = useState(30)
  const [creating, setCreating] = useState(false)
  const [now, setNow] = useState(Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])

  const refresh = useCallback(async () => {
    if (!workspace) {
      setSnapshot([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const response = await ipcClient.invoke('orchestration.list', {})
      setSnapshot(response?.relationships || [])
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : String(loadError),
      )
    } finally {
      setLoading(false)
    }
  }, [setError, setLoading, setSnapshot, workspace])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const relationships = useMemo(
    () => Object.values(relationshipMap),
    [relationshipMap],
  )
  const tree = useMemo(() => buildTree(relationships), [relationships])
  const activeCount = relationships.filter((relationship) =>
    ACTIVE_STATUSES.has(relationship.status),
  ).length

  const create = async () => {
    if (!workspace || !parentSessionFile || !goal.trim() || creating) return
    setCreating(true)
    try {
      await ipcClient.invoke('orchestration.create', {
        parentSessionFile,
        goal: goal.trim(),
        name: name.trim() || undefined,
        environment,
        timeoutMs: timeoutMinutes * 60_000,
      })
      setGoal('')
      setName('')
      setFormOpen(false)
      await refresh()
    } catch (createError) {
      toast.error(
        createError instanceof Error
          ? createError.message
          : String(createError),
      )
    } finally {
      setCreating(false)
    }
  }

  if (!workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center">
        <Network className="h-8 w-8 text-muted-foreground/30" />
        <span className="text-[12px] text-muted-foreground">
          {t('empty.workspace')}
        </span>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div>
          <div className="flex items-center gap-1.5 text-[11px] font-medium">
            <Network className="h-3.5 w-3.5" />
            {t('title')}
          </div>
          <div className="mt-0.5 text-[9px] text-muted-foreground">
            {t('summary', {
              total: relationships.length,
              active: activeCount,
            })}
          </div>
        </div>
        <div className="flex gap-1">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent"
            aria-label={t('actions.refresh')}
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={() => setFormOpen((value) => !value)}
            disabled={!parentSessionFile}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent disabled:opacity-35"
            aria-label={t('actions.create')}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {formOpen && (
        <div className="space-y-2 border-b border-border/50 p-3">
          <input
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder={t('form.name')}
            className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-[11px]"
          />
          <textarea
            value={goal}
            onChange={(event) => setGoal(event.target.value)}
            placeholder={t('form.goal')}
            rows={4}
            className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 text-[11px]"
          />
          <div className="flex items-center gap-2 text-[10px]">
            <label className="flex items-center gap-1">
              <GitFork className="h-3 w-3" />
              <select
                value={environment}
                onChange={(event) =>
                  setEnvironment(event.target.value as 'worktree' | 'local')
                }
                className="rounded border border-border bg-background px-1.5 py-1"
              >
                <option value="worktree">{t('environment.worktree')}</option>
                <option value="local">{t('environment.local')}</option>
              </select>
            </label>
            <label className="flex items-center gap-1">
              <Clock3 className="h-3 w-3" />
              <input
                type="number"
                min={1}
                max={1_440}
                value={timeoutMinutes}
                onChange={(event) =>
                  setTimeoutMinutes(
                    Math.max(1, Math.min(1_440, Number(event.target.value))),
                  )
                }
                className="w-14 rounded border border-border bg-background px-1.5 py-1"
              />
              {t('form.minutes')}
            </label>
          </div>
          <button
            type="button"
            onClick={create}
            disabled={creating || !goal.trim()}
            className="w-full rounded-md bg-primary py-1.5 text-[11px] font-medium text-primary-foreground disabled:opacity-40"
          >
            {creating ? t('actions.creating') : t('actions.create')}
          </button>
        </div>
      )}

      {!parentSessionFile && (
        <div className="m-3 rounded-md bg-amber-500/10 p-2 text-[10px] text-amber-700 dark:text-amber-300">
          {t('empty.session')}
        </div>
      )}
      {error && (
        <div className="m-3 rounded-md bg-destructive/10 p-2 text-[10px] text-destructive">
          {error}
        </div>
      )}
      <div className="scrollbar-overlay min-h-0 flex-1 space-y-1 overflow-y-auto p-2">
        {tree.map((task) => (
          <TaskCard
            key={task.id}
            task={task}
            depth={0}
            now={now}
            refresh={refresh}
          />
        ))}
        {!loading && tree.length === 0 && (
          <div className="flex flex-col items-center justify-center gap-2 px-4 py-12 text-center">
            <Bot className="h-7 w-7 text-muted-foreground/30" />
            <span className="text-[11px] text-muted-foreground">
              {t('empty.tasks')}
            </span>
          </div>
        )}
      </div>
    </div>
  )
}
