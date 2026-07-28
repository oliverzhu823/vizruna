import { useCallback, useEffect, useMemo, useState } from 'react'
import { GitFork, Loader2, RefreshCw } from 'lucide-react'
import { useUIStore } from '@renderer/stores/ui-store'
import { navigateSessionToEntry } from '@renderer/lib/session-rewind'
import { forkSessionFromEntry } from '@renderer/lib/session-fork'
import { refreshSessionTree } from '@renderer/lib/rewind-metadata'
import { capSessionTreeForDisplay } from '@renderer/features/rewind/session-tree-display-cap'
import {
  SessionTreeList,
  filterSessionTreeNodes,
  type SessionTreeNode,
  type TreeFilterMode,
} from '@renderer/features/rewind/session-tree-list'
import { cn } from '@renderer/lib/utils'
import { useTranslation } from 'react-i18next'

const FILTER_OPTS: { key: TreeFilterMode; labelKey: string }[] = [
  { key: 'default', labelKey: 'tree.filter.default' },
  { key: 'no-tools', labelKey: 'tree.filter.noTools' },
  { key: 'user-only', labelKey: 'tree.filter.userOnly' },
  { key: 'labeled-only', labelKey: 'tree.filter.labeledOnly' },
  { key: 'all', labelKey: 'tree.filter.all' },
]

export function TreePanel() {
  const { t } = useTranslation('timeline')
  const workspace = useUIStore((s) => s.currentWorkspace)
  const sessionFile = useUIStore((s) => s.historySessionFile)
  const rawTree = useUIStore((s) => s.rewindTreeNodes) as SessionTreeNode[]
  const loading = useUIStore((s) => s.rewindLoadingTree)
  const treeError = useUIStore((s) => s.rewindTreeError)
  const [filter, setFilter] = useState<TreeFilterMode>('default')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const refresh = useCallback(() => {
    if (!sessionFile) return
    void refreshSessionTree(sessionFile)
  }, [sessionFile])

  useEffect(() => {
    if (sessionFile && rawTree.length === 0 && !loading && !treeError) {
      void refreshSessionTree(sessionFile)
    }
  }, [sessionFile, rawTree.length, loading, treeError])

  const filtered = useMemo(() => filterSessionTreeNodes(rawTree, filter), [rawTree, filter])
  const { nodes: display, truncated, hiddenCount } = useMemo(
    () => capSessionTreeForDisplay(filtered),
    [filtered],
  )
  // Same heuristic as double-Esc overlay: guides off only for very large trees
  const showGuides = display.length > 0 && display.length <= 400

  useEffect(() => {
    if (selectedId && display.some((node) => node.id === selectedId)) return
    const prefer =
      [...display].reverse().find((node) => !node.isLeaf) ??
      display.find((node) => node.isLeaf) ??
      display[0]
    setSelectedId(prefer?.id ?? null)
  }, [display, selectedId])

  if (!workspace) {
    return (
      <div className="p-4 text-[12px] leading-relaxed text-muted-foreground">
        {t('tree.openWorkspace')}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col text-[12px]">
      <div className="flex items-center justify-between border-b border-border/50 px-3 py-2">
        <div className="min-w-0">
          <span className="font-medium text-foreground">{t('tree.title')}</span>
          <p className="mt-0.5 text-[10px] leading-snug text-muted-foreground">
            {t('tree.panelHint')}
          </p>
        </div>
        <button
          type="button"
          className="chrome-icon-btn rounded-md p-1.5"
          title={t('common:refresh')}
          onClick={refresh}
          disabled={!sessionFile}
        >
          <RefreshCw className={cn('h-3.5 w-3.5', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex flex-wrap gap-1 border-b border-border/40 px-2 py-1.5">
        {FILTER_OPTS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => setFilter(option.key)}
            className={cn(
              'rounded-md px-2 py-0.5 text-[10px] transition-colors',
              filter === option.key
                ? 'bg-primary/12 font-medium text-primary'
                : 'text-muted-foreground hover:bg-muted/80',
            )}
          >
            {t(option.labelKey)}
          </button>
        ))}
      </div>

      <div className="scrollbar-overlay min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-1">
        {!sessionFile ? (
          <p className="px-3 py-6 text-[11px] text-muted-foreground/70">{t('tree.noSession')}</p>
        ) : loading && rawTree.length === 0 ? (
          <div className="flex items-center gap-2 px-3 py-6 text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" />
            {t('loadingSession')}
          </div>
        ) : treeError ? (
          <p className="px-3 py-6 text-[11px] text-amber-700/85 dark:text-amber-300/80">
            {t('tree.loadingFailed', { error: treeError })}
          </p>
        ) : display.length === 0 ? (
          <p className="px-3 py-6 text-[11px] text-muted-foreground/70">
            {rawTree.length === 0 ? t('tree.empty') : t('tree.noMatch')}
          </p>
        ) : (
          <>
            {truncated && (
              <p className="px-3 pb-1.5 text-[10px] text-muted-foreground/80">
                {t('tree.panelTruncated', { visible: display.length, hidden: hiddenCount })}
              </p>
            )}
            <SessionTreeList
              className="px-0.5"
              nodes={display}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onActivate={(id) => void navigateSessionToEntry(id)}
              showGuides={showGuides}
              rowClassName="text-[11px]"
              renderTrailing={(node) =>
                node.entryType === 'message' && node.role === 'user' ? (
                  <button
                    type="button"
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-primary"
                    title={t('tree.forkNew')}
                    onClick={(event) => {
                      event.stopPropagation()
                      void forkSessionFromEntry(node.id)
                    }}
                  >
                    <GitFork className="h-3.5 w-3.5" />
                  </button>
                ) : null
              }
            />
          </>
        )}
      </div>
    </div>
  )
}
