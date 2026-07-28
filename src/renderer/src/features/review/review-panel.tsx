import { useState, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient, onGitWorkspaceChanged } from '@renderer/lib/ipc-client'
import { resolveSystemFilePath } from '@renderer/lib/open-workspace-path'
import MarkdownView from '@renderer/features/timeline/markdown-view'
import { resolveFilePreviewMode } from '@renderer/features/workspace-files/file-preview-mode'
import { parseGitDiff } from '@shared/diff-model'
import {
  Copy,
  Check,
  GitBranch,
  Loader2,
  FileDiff,
  RefreshCw,
  Columns2,
  Rows2,
  ExternalLink,
} from 'lucide-react'
import { parseGitStatus } from './review-git-utils'
import { ChangeIcon, FileDiffView, ReviewCommitBar, type DiffMode } from './review-diff-views'

type AnyFileEntry = {
  path: string
  changeType: string
  staged?: boolean
  source?: string
  runId?: string
  turnId?: string
}

const SCOPES = ['turn', 'session', 'git'] as const
type Scope = (typeof SCOPES)[number]

const REVIEW_READ_MAX_BYTES = 1024 * 1024

function pathsMatch(left: string, right: string): boolean {
  const normalize = (value: string) => value.replace(/\\/g, '/').replace(/\/$/, '')
  const a = normalize(left)
  const b = normalize(right)
  if (a === b || a.endsWith(`/${b}`) || b.endsWith(`/${a}`)) return true
  return a.split('/').pop() === b.split('/').pop()
}

function SessionFileReviewContent({
  path,
  workspace,
  changeType,
  source,
  runId,
}: {
  path: string
  workspace: string | null
  changeType: string
  source?: string
  runId?: string
}) {
  const { t } = useTranslation('review')
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const systemPath = resolveSystemFilePath(path, workspace)
  const mode = resolveFilePreviewMode(path)

  useEffect(() => {
    let cancelled = false
    setContent(null)
    setError(null)
    if (!systemPath) {
      setLoading(false)
      setError('invalid_path')
      return
    }
    setLoading(true)
    void ipcClient
      .invoke('review.readArtifactText', { path: systemPath, maxBytes: REVIEW_READ_MAX_BYTES })
      .then((result) => {
        if (cancelled) return
        if (result?.ok) setContent(result.content ?? '')
        else setError(result?.error || 'read_failed')
      })
      .catch(() => {
        if (!cancelled) setError('read_failed')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [systemPath])

  return (
    <div className="border-t border-border/30 bg-[var(--bg-2)]">
      <div className="flex items-center gap-2 border-b border-border/20 px-3 py-1.5 text-[10px] text-foreground-secondary">
        <span>{t('currentFileContent')}</span>
        <span className="truncate opacity-60">
          {changeType} · {source || t('unknownSource')}
          {runId ? ` · run ${runId.slice(0, 8)}` : ''}
        </span>
        {systemPath ? (
          <button
            type="button"
            className="chrome-icon-btn ml-auto flex shrink-0 items-center gap-1 rounded px-1 py-0.5"
            title={t('openInDefaultApp')}
            onClick={() => void ipcClient.invoke('shell.openPath', { path: systemPath })}
          >
            <ExternalLink className="h-3 w-3" aria-hidden="true" />
            <span>{t('openInDefaultApp')}</span>
          </button>
        ) : null}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 px-3 py-6 text-[11px] text-foreground-secondary">
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
          {t('loadingFileContent')}
        </div>
      ) : error ? (
        <div className="px-3 py-4 text-[11px] text-foreground-secondary">
          {error === 'too_large' ? t('fileTooLarge') : t('fileContentUnavailable')}
        </div>
      ) : mode === 'markdown' && content != null ? (
        <div className="px-3 py-3 text-[12px]">
          <MarkdownView>{content}</MarkdownView>
        </div>
      ) : content != null ? (
        <pre className="m-0 overflow-x-auto whitespace-pre-wrap break-words px-3 py-3 font-mono text-[10px] leading-relaxed text-foreground">
          {content}
        </pre>
      ) : null}
    </div>
  )
}

export function ReviewPanel() {
  const { t } = useTranslation()
  const [scope, setScope] = useState<Scope>('session')
  const fileChanges = useUIStore((s) => s.fileChanges)
  const workspace = useUIStore((s) => s.currentWorkspace)
  const activeRunId = useUIStore((s) => s.runState.activeRunId)
  const lastRunId = useUIStore((s) => s.runState.lastRunId)
  const running = useUIStore((s) => s.runState.status === 'running')
  const [copiedPath, setCopiedPath] = useState<string | null>(null)
  const [gitData, setGitData] = useState<{
    files: { path: string; changeType: string }[]
    raw: string
    branch?: string
    log?: string
    error?: string
    isRepo?: boolean
    message?: string
  } | null>(null)
  const [loading, setLoading] = useState(false)
  const [expandedGitPath, setExpandedGitPath] = useState<string | null>(null)
  const [focusGitPath, setFocusGitPath] = useState<string | null>(null)
  const [focusedSessionPath, setFocusedSessionPath] = useState<string | null>(null)
  const [expandedMetaPath, setExpandedMetaPath] = useState<string | null>(null)
  const [diffMode, setDiffMode] = useState<DiffMode>('inline')
  const [gitReloadKey, setGitReloadKey] = useState(0)
  const reviewFileOpenRequest = useUIStore((s) => s.reviewFileOpenRequest)
  const consumeReviewFileOpen = useUIStore((s) => s.consumeReviewFileOpen)

  const turnRunId = running ? activeRunId : lastRunId

  useEffect(() => {
    const saved = localStorage.getItem('reviewDiffMode')
    if (saved === 'split' || saved === 'inline') setDiffMode(saved)
  }, [])

  const toggleDiffMode = () => {
    const next = diffMode === 'inline' ? 'split' : 'inline'
    setDiffMode(next)
    localStorage.setItem('reviewDiffMode', next)
  }

  useEffect(() => {
    const onScope = (e: Event) => {
      const s = (e as CustomEvent<Scope>).detail
      if (s && SCOPES.includes(s)) setScope(s)
    }
    window.addEventListener('pi-enterprise-desktop:review-scope', onScope)
    return () => window.removeEventListener('pi-enterprise-desktop:review-scope', onScope)
  }, [])

  useEffect(() => {
    const onFocus = (e: Event) => {
      const path = (e as CustomEvent<{ path?: string }>).detail?.path
      if (path) {
        const normalized = path.replace(/\\/g, '/')
        setFocusGitPath(normalized)
        setFocusedSessionPath(normalized)
        setExpandedGitPath(normalized)
        setExpandedMetaPath(normalized)
      }
    }
    window.addEventListener('pi-enterprise-desktop:review-focus-file', onFocus)
    return () => window.removeEventListener('pi-enterprise-desktop:review-focus-file', onFocus)
  }, [])

  useEffect(() => {
    if (!reviewFileOpenRequest) return
    const normalized = reviewFileOpenRequest.path.replace(/\\/g, '/')
    setScope(reviewFileOpenRequest.scope)
    setFocusGitPath(normalized)
    if (reviewFileOpenRequest.scope !== 'git') setFocusedSessionPath(normalized)
    setExpandedGitPath(normalized)
    setExpandedMetaPath(normalized)
    consumeReviewFileOpen(reviewFileOpenRequest.id)
  }, [consumeReviewFileOpen, reviewFileOpenRequest])

  const loadGit = () => {
    if (!workspace) return
    setLoading(true)
    setGitReloadKey((k) => k + 1)
    ipcClient
      .invoke('review.getDiff', { sessionId: '', scope: 'git' })
      .then((res) => {
        if (res?.diff) {
          const isRepo = res.diff.isRepo !== false
          setGitData({
            files: parseGitStatus(res.diff.status || ''),
            raw: res.diff.raw || '',
            branch: res.diff.branch,
            log: res.diff.log,
            isRepo,
            message: res.diff.message,
            error: isRepo ? res.diff.error : undefined,
          })
        }
      })
      .catch(() => setGitData(null))
      .finally(() => setLoading(false))
  }

  useEffect(() => {
    if (scope === 'git' && workspace) loadGit()
  }, [scope, workspace])

  useEffect(() => {
    return onGitWorkspaceChanged((payload) => {
      if (!workspace || payload.cwd.replace(/\\/g, '/') !== workspace.replace(/\\/g, '/')) return
      if (scope === 'git') loadGit()
    })
  }, [scope, workspace])

  const turnFiles = useMemo(
    () => fileChanges.filter((f) => turnRunId && f.runId === turnRunId),
    [fileChanges, turnRunId],
  )

  const scopedSessionFiles: AnyFileEntry[] = scope === 'turn' ? turnFiles : fileChanges
  const files: AnyFileEntry[] =
    scope === 'git'
      ? (gitData?.files as AnyFileEntry[]) || []
      : focusedSessionPath && !scopedSessionFiles.some((file) => pathsMatch(file.path, focusedSessionPath))
        ? [
            ...scopedSessionFiles,
            {
              path: focusedSessionPath,
              changeType: 'created',
              source: 'timeline',
            },
          ]
        : scopedSessionFiles

  const diffFiles = useMemo(() => {
    if (scope !== 'git' || !gitData?.raw) return []
    return parseGitDiff(gitData.raw)
  }, [scope, gitData?.raw])

  const cwd = workspace || ''

  const handleCopy = (path: string) => {
    navigator.clipboard.writeText(path)
    setCopiedPath(path)
    setTimeout(() => setCopiedPath(null), 1500)
  }

  const scopeHint =
    scope === 'turn'
      ? turnRunId
        ? t('review:scopeHintTurn', { id: turnRunId.slice(0, 8) })
        : t('review:scopeHintNoTurn')
      : scope === 'session'
        ? t('review:scopeHintSession', { count: files.length })
        : gitData?.isRepo === false
          ? t('review:scopeHintNotRepo')
          : gitData?.branch
            ? t('review:scopeHintBranch', { branch: gitData.branch })
            : t('review:scopeHintGit')

  return (
    <div className="flex h-full flex-col">
      <div className="flex border-b border-border/80">
        {SCOPES.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setScope(s)}
            className={cn(
              'flex-1 px-2 py-2.5 text-[11px] font-medium transition-colors',
              scope === s ? 'bg-[var(--bg-active)] text-foreground' : 'text-foreground-secondary hover:bg-[var(--bg-hover)]',
            )}
          >
            {t(`review.scope.${s}`)}
          </button>
        ))}
      </div>
      <div className="flex items-center justify-between gap-2 border-b border-border/40 px-3 py-1.5">
        <span className="truncate text-[10px] text-foreground-secondary/80">{scopeHint}</span>
        <div className="flex items-center gap-1">
          {scope === 'git' && diffFiles.length > 0 && (
            <button
              type="button"
              onClick={toggleDiffMode}
              className="chrome-icon-btn rounded p-1"
              title={diffMode === 'inline' ? t('review:toggleSplit') : t('review:toggleInline')}
            >
              {diffMode === 'inline' ? <Columns2 className="h-3 w-3" /> : <Rows2 className="h-3 w-3" />}
            </button>
          )}
          {scope === 'git' && (
            <button type="button" onClick={loadGit} className="chrome-icon-btn rounded p-1" title={t('review:refresh')}>
              <RefreshCw className={cn('h-3 w-3', loading && 'animate-spin')} />
            </button>
          )}
        </div>
      </div>
      <div className="scrollbar-overlay flex-1 overflow-y-auto">
        {scope === 'git' && gitData?.log && (
          <div className="border-b border-border/40 px-3 py-2">
            <div className="mb-1 flex items-center gap-1.5 text-[10px] font-semibold text-foreground-secondary/70">
              <GitBranch className="h-3 w-3" />
              {t('review:recentCommits')}
            </div>
            <pre className="max-h-28 overflow-y-auto font-mono text-[10px] leading-relaxed text-foreground-secondary/90">
              {gitData.log}
            </pre>
          </div>
        )}
        {loading ? (
          <div className="flex h-32 items-center justify-center">
            <Loader2 className="h-4 w-4 animate-spin text-muted-foreground/40" />
          </div>
        ) : scope === 'git' && gitData?.isRepo === false ? (
          <div className="flex flex-col items-center gap-2 px-4 py-12 text-center">
            <GitBranch className="h-8 w-8 text-muted-foreground/25" />
            <span className="text-[12px] text-foreground-secondary">
              {gitData.message || t('review:notGitRepo')}
            </span>
            <span className="text-[11px] text-muted-foreground/50">{t('review:notGitHint')}</span>
          </div>
        ) : scope === 'git' && gitData?.error ? (
          <p className="px-3 py-4 text-[11px] text-destructive/80">{gitData.error}</p>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-12">
            <FileDiff className="h-8 w-8 text-muted-foreground/25" />
            <span className="text-[11px] text-muted-foreground/40">{t('review:empty')}</span>
          </div>
        ) : scope === 'git' ? (
          <div className="py-1">
            {files.map((fc) => {
              const file = diffFiles.find((d) => d.path === fc.path || fc.path.endsWith(d.path))
              return (
                <FileDiffView
                  key={`${fc.path}-${gitReloadKey}`}
                  file={file}
                  fallbackPath={fc.path}
                  fallbackChangeType={fc.changeType}
                  staged={fc.staged ?? false}
                  mode={diffMode}
                  cwd={cwd}
                  defaultOpen={(() => {
                    const n = (p: string) => p.replace(/\\/g, '/')
                    const fp = focusGitPath ? n(focusGitPath) : null
                    const cp = n(fc.path)
                    return expandedGitPath === fc.path || (fp != null && (cp === fp || cp.endsWith(`/${fp}`)))
                  })()}
                />
              )
            })}
          </div>
        ) : (
          <div className="py-1.5">
            {files.map((fc) => {
              const open =
                (expandedMetaPath != null && pathsMatch(fc.path, expandedMetaPath)) ||
                (focusGitPath != null && pathsMatch(fc.path, focusGitPath))
              return (
                <div key={`${fc.path}-${fc.runId || ''}`} className="group">
                  <div className="flex items-center gap-2 px-3 py-1.5 hover:bg-[var(--bg-hover)]">
                    <ChangeIcon type={fc.changeType} />
                    <button
                      type="button"
                      className="min-w-0 flex-1 truncate text-left font-mono text-[11px]"
                      onClick={() => {
                        if (open) {
                          setExpandedMetaPath(null)
                          setFocusGitPath(null)
                        } else {
                          setExpandedMetaPath(fc.path)
                        }
                      }}
                    >
                      {fc.path}
                    </button>
                    <span className="text-[9px] text-foreground-secondary/50">{fc.source}</span>
                    <button type="button" onClick={() => handleCopy(fc.path)} className="opacity-0 group-hover:opacity-100">
                      {copiedPath === fc.path ? <Check className="h-3 w-3 text-green-500" /> : <Copy className="h-3 w-3" />}
                    </button>
                  </div>
                  {open && (
                    <SessionFileReviewContent
                      path={fc.path}
                      workspace={workspace}
                      changeType={fc.changeType}
                      source={fc.source}
                      runId={fc.runId}
                    />
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>
      {scope === 'git' && gitData?.isRepo !== false && files.length > 0 && (
        <ReviewCommitBar cwd={cwd} onCommitted={loadGit} />
      )}
    </div>
  )
}
