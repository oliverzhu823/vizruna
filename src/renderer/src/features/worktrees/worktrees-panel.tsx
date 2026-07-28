import { useCallback, useEffect, useId, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ExternalLink,
  FolderGit2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { ManagedWorktree, WorktreeSafety } from '@shared/managed-worktree'
import { activateWorkspace } from '@renderer/lib/activate-workspace'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'

const STATUS_STYLE: Record<ManagedWorktree['status'], string> = {
  creating: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  ready: 'bg-green-500/15 text-green-700 dark:text-green-300',
  dirty: 'bg-amber-500/15 text-amber-700 dark:text-amber-300',
  missing: 'bg-destructive/10 text-destructive',
  error: 'bg-destructive/10 text-destructive',
  removing: 'bg-blue-500/15 text-blue-600 dark:text-blue-300',
  removed: 'bg-muted text-muted-foreground',
}

function shortPath(path: string): string {
  const normalized = path.replace(/\\/g, '/')
  const parts = normalized.split('/').filter(Boolean)
  return parts.slice(-3).join('/')
}

function WorktreeRemovalDialog({
  worktree,
  safety,
  pending,
  onClose,
  onRemove,
}: {
  worktree: ManagedWorktree
  safety: WorktreeSafety
  pending: boolean
  onClose: () => void
  onRemove: (options: { force: boolean; deleteBranch: boolean }) => void
}) {
  const { t } = useTranslation('worktrees')
  const titleId = useId()
  const [confirmed, setConfirmed] = useState(false)
  const [deleteBranch, setDeleteBranch] = useState(safety.safeToRemove)
  const force = !safety.safeToRemove && safety.forceRemovalAllowed
  const prohibited = !safety.forceRemovalAllowed
  const removalCommand = `git worktree remove${force ? ' --force' : ''} ${JSON.stringify(worktree.worktreePath)}`
  const branchCommand = `git branch ${force ? '-D' : '-d'} ${JSON.stringify(worktree.branchName)}`

  return createPortal(
    <div className="electron-no-drag fixed inset-0 z-[640] flex items-center justify-center bg-black/45 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl border border-border bg-popover p-5 shadow-2xl"
      >
        <div className="mb-4 flex items-start gap-3">
          <div className={cn('rounded-lg p-2', force ? 'bg-destructive/10 text-destructive' : 'bg-amber-500/15 text-amber-600')}>
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h2 id={titleId} className="text-[15px] font-semibold">
              {prohibited ? t('remove.prohibitedTitle') : force ? t('remove.forceTitle') : t('remove.title')}
            </h2>
            <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
              {prohibited
                ? t('remove.prohibitedDescription')
                : force
                  ? t('remove.forceDescription')
                  : t('remove.description')}
            </p>
          </div>
        </div>

        <div className="mb-4 rounded-lg border border-border/70 bg-muted/25 p-3 text-[11px]">
          <div className="font-medium text-foreground">{worktree.branchName}</div>
          <div className="mt-1 break-all text-muted-foreground">{worktree.worktreePath}</div>
          {safety.blockers.length > 0 && (
            <ul className="mt-3 space-y-1 text-destructive">
              {safety.blockers.map((blocker) => (
                <li key={blocker}>• {t(`blockers.${blocker}`)}</li>
              ))}
            </ul>
          )}
          {safety.changedFiles.length > 0 && (
            <div className="mt-3">
              <div className="font-medium text-foreground">{t('remove.changedFiles')}</div>
              <ul className="mt-1 max-h-24 overflow-y-auto font-mono text-muted-foreground">
                {safety.changedFiles.slice(0, 20).map((file) => (
                  <li key={file} className="truncate">{file}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        {!prohibited && (
          <>
            <div className="mb-3 rounded-md bg-muted/50 p-2.5">
              <div className="mb-1 text-[10px] font-medium text-muted-foreground">
                {t('remove.commandPreview')}
              </div>
              <code className="block break-all text-[10px] text-foreground-secondary">
                {removalCommand}
              </code>
              {deleteBranch && (
                <code className="mt-1 block break-all text-[10px] text-foreground-secondary">
                  {branchCommand}
                </code>
              )}
            </div>
            <label className="mb-3 flex items-start gap-2 text-[12px] text-foreground-secondary">
              <input
                type="checkbox"
                checked={deleteBranch}
                onChange={(event) => setDeleteBranch(event.target.checked)}
                className="mt-0.5"
              />
              <span>{t('remove.deleteBranch')}</span>
            </label>
          </>
        )}
        {force && (
          <label className="mb-4 flex items-start gap-2 rounded-lg bg-destructive/8 p-3 text-[12px] text-destructive">
            <input
              type="checkbox"
              checked={confirmed}
              onChange={(event) => setConfirmed(event.target.checked)}
              className="mt-0.5"
            />
            <span>{t('remove.confirmRisk')}</span>
          </label>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={pending}
            className="rounded-md px-3 py-1.5 text-[12px] text-foreground-secondary hover:bg-accent"
          >
            {t('actions.cancel')}
          </button>
          {!prohibited && (
            <button
              type="button"
              onClick={() => onRemove({ force, deleteBranch })}
              disabled={pending || (force && !confirmed)}
              className={cn(
                'rounded-md px-3 py-1.5 text-[12px] text-white disabled:opacity-40',
                force ? 'bg-destructive hover:bg-destructive/90' : 'bg-primary hover:bg-primary/90',
              )}
            >
              {pending ? t('actions.removing') : force ? t('actions.forceRemove') : t('actions.remove')}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function WorktreesPanel() {
  const { t } = useTranslation('worktrees')
  const workspace = useUIStore((state) => state.currentWorkspace)
  const worktrees = useUIStore((state) => state.managedWorktrees)
  const capability = useUIStore((state) => state.worktreeCapability)
  const unregistered = useUIStore((state) => state.unregisteredWorktrees)
  const loading = useUIStore((state) => state.worktreeLoading)
  const error = useUIStore((state) => state.worktreeError)
  const setState = useUIStore((state) => state.setManagedWorktreeState)
  const [creating, setCreating] = useState(false)
  const [createFormOpen, setCreateFormOpen] = useState(false)
  const [name, setName] = useState('')
  const [branchName, setBranchName] = useState('')
  const [removal, setRemoval] = useState<{
    worktree: ManagedWorktree
    safety: WorktreeSafety
  } | null>(null)
  const [removing, setRemoving] = useState(false)

  const refresh = useCallback(async () => {
    if (!workspace) {
      setState({
        worktrees: [],
        capability: null,
        unregistered: [],
        loading: false,
        error: null,
      })
      return
    }
    setState({ loading: true, error: null })
    try {
      const [capabilityResult, reconcileResult, listResult] = await Promise.all([
        ipcClient.invoke('worktree.capability', {}),
        ipcClient.invoke('worktree.reconcile', {}),
        ipcClient.invoke('worktree.list', {}),
      ])
      if (!capabilityResult?.ok) {
        setState({
          capability: capabilityResult?.capability ?? {
            isGitRepository: false,
            reason: 'unknown',
            message: capabilityResult?.error,
          },
          worktrees: [],
          unregistered: [],
          error: capabilityResult?.error || null,
          loading: false,
        })
        return
      }
      setState({
        capability: capabilityResult.capability,
        worktrees: reconcileResult?.ok
          ? reconcileResult.worktrees || []
          : listResult?.worktrees || [],
        unregistered: reconcileResult?.ok ? reconcileResult.unregistered || [] : [],
        error:
          reconcileResult?.ok && listResult?.ok
            ? null
            : reconcileResult?.error || listResult?.error || null,
        loading: false,
      })
    } catch (loadError) {
      setState({
        loading: false,
        error: loadError instanceof Error ? loadError.message : String(loadError),
      })
    }
  }, [setState, workspace])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const createWorktree = async () => {
    if (!workspace || creating) return
    setCreating(true)
    try {
      const response = await ipcClient.invoke('worktree.create', {
        name: name.trim() || undefined,
        branchName: branchName.trim() || undefined,
      })
      if (!response?.ok) {
        toast.error(response?.error || t('errors.createFailed'))
        return
      }
      setName('')
      setBranchName('')
      setCreateFormOpen(false)
      toast.success(t('messages.created'))
      await refresh()
    } finally {
      setCreating(false)
    }
  }

  const inspectRemoval = async (worktree: ManagedWorktree) => {
    const response = await ipcClient.invoke('worktree.inspectRemoval', { id: worktree.id })
    if (!response?.ok || !response.safety) {
      toast.error(response?.error || t('errors.inspectFailed'))
      return
    }
    setRemoval({ worktree, safety: response.safety })
  }

  const removeWorktree = async (options: { force: boolean; deleteBranch: boolean }) => {
    if (!removal || removing) return
    setRemoving(true)
    try {
      const response = await ipcClient.invoke('worktree.remove', {
        id: removal.worktree.id,
        force: options.force,
        confirmed: options.force ? true : undefined,
        deleteBranch: options.deleteBranch,
      })
      if (!response?.ok) {
        toast.error(response?.error || t('errors.removeFailed'))
        return
      }
      setRemoval(null)
      toast.success(t('messages.removed'))
      await refresh()
    } finally {
      setRemoving(false)
    }
  }

  if (!workspace) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-5 text-center">
        <FolderGit2 className="h-8 w-8 text-muted-foreground/30" />
        <p className="text-[12px] text-muted-foreground">{t('empty.openProject')}</p>
      </div>
    )
  }

  if (capability && !capability.isGitRepository) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-5 text-center">
        <FolderGit2 className="h-8 w-8 text-muted-foreground/30" />
        <div>
          <p className="text-[13px] font-medium">{t('empty.notGit')}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            {capability.message || t('empty.localFallback')}
          </p>
        </div>
        <button type="button" onClick={() => void refresh()} className="text-[11px] text-primary hover:underline">
          {t('actions.refresh')}
        </button>
      </div>
    )
  }

  return (
    <div className="scrollbar-overlay flex h-full flex-col overflow-y-auto">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-border/50 bg-background/95 px-3 py-2 backdrop-blur">
        <div>
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            {t('title')}
          </div>
          {capability?.currentBranch && (
            <div className="mt-0.5 max-w-[12rem] truncate font-mono text-[9px] text-muted-foreground/70">
              {capability.currentBranch}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            title={t('actions.refresh')}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
          </button>
          <button
            type="button"
            onClick={() => setCreateFormOpen((open) => !open)}
            title={t('actions.create')}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {createFormOpen && (
        <div className="border-b border-border/40 bg-muted/20 p-3">
          <label className="text-[10px] font-medium text-muted-foreground">
            {t('create.name')}
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength={80}
              placeholder={t('create.placeholder')}
              className="mt-1.5 w-full rounded-md border border-border bg-background px-2.5 py-2 text-[12px] outline-none focus:border-primary/50"
            />
          </label>
          <label className="mt-3 block text-[10px] font-medium text-muted-foreground">
            {t('create.branchName')}
            <input
              value={branchName}
              onChange={(event) => setBranchName(event.target.value)}
              maxLength={200}
              placeholder={t('create.branchPlaceholder')}
              className="mt-1.5 w-full rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[12px] outline-none focus:border-primary/50"
            />
          </label>
          <p className="mt-1.5 text-[10px] leading-relaxed text-muted-foreground">
            {t('create.description')}
          </p>
          <div className="mt-3 flex justify-end gap-2">
            <button type="button" onClick={() => setCreateFormOpen(false)} className="px-2 py-1 text-[11px] text-muted-foreground">
              {t('actions.cancel')}
            </button>
            <button
              type="button"
              onClick={() => void createWorktree()}
              disabled={creating}
              className="rounded-md bg-primary px-3 py-1.5 text-[11px] text-primary-foreground disabled:opacity-50"
            >
              {creating ? t('actions.creating') : t('actions.create')}
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="m-3 rounded-lg border border-destructive/20 bg-destructive/5 p-3 text-[11px] text-destructive">
          {error}
        </div>
      )}

      <div className="space-y-2 p-2.5">
        {!loading && worktrees.length === 0 && (
          <div className="rounded-lg border border-dashed border-border p-5 text-center">
            <p className="text-[12px] text-muted-foreground">{t('empty.noWorktrees')}</p>
            <button type="button" onClick={() => setCreateFormOpen(true)} className="mt-2 text-[11px] text-primary hover:underline">
              {t('actions.createFirst')}
            </button>
          </div>
        )}
        {worktrees.map((worktree) => (
          <div key={worktree.id} className="rounded-lg border border-border/60 bg-card/40 p-3">
            <div className="flex items-start gap-2">
              <FolderGit2 className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-[11px] font-medium">{worktree.branchName}</div>
                <div title={worktree.worktreePath} className="mt-0.5 truncate text-[10px] text-muted-foreground">
                  {shortPath(worktree.worktreePath)}
                </div>
                {worktree.createdBySession && (
                  <div
                    title={worktree.createdBySession}
                    className="mt-0.5 truncate text-[9px] text-muted-foreground/70"
                  >
                    {t('labels.session')}: {shortPath(worktree.createdBySession)}
                  </div>
                )}
              </div>
              <span className={cn('rounded px-1.5 py-0.5 text-[9px] font-medium', STATUS_STYLE[worktree.status])}>
                {t(`status.${worktree.status}`)}
              </span>
            </div>
            {worktree.lastError && (
              <p className="mt-2 line-clamp-3 text-[10px] leading-relaxed text-destructive">
                {worktree.lastError}
              </p>
            )}
            <div className="mt-3 flex items-center justify-end gap-1">
              {(worktree.status === 'ready' || worktree.status === 'dirty') && (
                <button
                  type="button"
                  onClick={() => void activateWorkspace(worktree.worktreePath, { preferHome: true })}
                  className="flex items-center gap-1 rounded px-2 py-1 text-[10px] text-foreground-secondary hover:bg-accent"
                >
                  <ExternalLink className="h-3 w-3" />
                  {t('actions.open')}
                </button>
              )}
              <button
                type="button"
                onClick={() => void ipcClient.invoke('shell.showItemInFolder', { path: worktree.worktreePath })}
                className="rounded px-2 py-1 text-[10px] text-foreground-secondary hover:bg-accent"
              >
                {t('actions.reveal')}
              </button>
              <button
                type="button"
                onClick={() => void inspectRemoval(worktree)}
                className="rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                title={t('actions.remove')}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        ))}
      </div>

      {unregistered.length > 0 && (
        <div className="mx-2.5 mb-3 rounded-lg border border-amber-500/25 bg-amber-500/8 p-3">
          <div className="text-[11px] font-medium text-amber-800 dark:text-amber-200">
            {t('unregistered.title', { count: unregistered.length })}
          </div>
          <p className="mt-1 text-[10px] leading-relaxed text-amber-800/80 dark:text-amber-200/80">
            {t('unregistered.description')}
          </p>
          <ul className="mt-2 space-y-1 text-[9px] text-muted-foreground">
            {unregistered.map((entry) => (
              <li key={entry.worktreePath} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-mono" title={entry.worktreePath}>
                  {entry.branchName || shortPath(entry.worktreePath)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    void ipcClient.invoke('shell.showItemInFolder', {
                      path: entry.worktreePath,
                    })
                  }
                  className="shrink-0 rounded px-1.5 py-0.5 hover:bg-amber-500/10"
                >
                  {t('actions.reveal')}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {removal && (
        <WorktreeRemovalDialog
          worktree={removal.worktree}
          safety={removal.safety}
          pending={removing}
          onClose={() => setRemoval(null)}
          onRemove={(options) => void removeWorktree(options)}
        />
      )}
    </div>
  )
}
