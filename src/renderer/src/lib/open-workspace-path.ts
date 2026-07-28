import { useUIStore } from '@renderer/stores/ui-store'
import { ipcClient } from '@renderer/lib/ipc-client'

function ensureReviewPanelEnabled(): void {
  const store = useUIStore.getState()
  if (store.rightPanelPrefs.review) return
  const prefs = { ...store.rightPanelPrefs, review: true }
  store.applyRightPanelRuntime(store.rightPanelCatalog, prefs, store.rightPanelOrder)
  void ipcClient
    .invoke('rightPanels.saveLayout', { prefs, order: store.rightPanelOrder })
    .catch(() => {})
}

export function resolveWorkspaceRelativePath(
  input: string,
  workspaceRoot?: string | null,
): string | null {
  let raw = input.replace(/\\/g, '/').replace(/^\.\//, '').trim()
  if (!raw || raw.includes('..')) return null

  if (workspaceRoot) {
    const root = workspaceRoot.replace(/\\/g, '/').replace(/\/$/, '')
    if (raw.toLowerCase().startsWith(root.toLowerCase() + '/')) {
      raw = raw.slice(root.length + 1)
    } else if (raw.toLowerCase() === root.toLowerCase()) {
      return null
    }
  }

  // Absolute path outside workspace cannot be opened in Files panel
  if (/^[a-zA-Z]:\//.test(raw) || raw.startsWith('/')) return null
  return raw
}

export function isAbsoluteFilePath(input: string): boolean {
  const normalized = input.replace(/\\/g, '/').trim()
  return normalized.startsWith('/') || /^[a-zA-Z]:\//.test(normalized)
}

/** Resolve either an in-workspace file or an explicit absolute artifact path for OS opening. */
export function resolveSystemFilePath(
  input: string,
  workspaceRoot?: string | null,
): string | null {
  const relativePath = resolveWorkspaceRelativePath(input, workspaceRoot)
  if (relativePath && workspaceRoot) {
    return `${workspaceRoot.replace(/[\\/]+$/, '')}/${relativePath}`
  }
  return isAbsoluteFilePath(input) ? input.trim() : null
}

/** Open a repo-relative (or workspace-absolute) path in Files panel. */
export function openWorkspaceRelativePath(relPath: string): boolean {
  const store = useUIStore.getState()
  const raw = resolveWorkspaceRelativePath(relPath, store.currentWorkspace)
  if (!raw) return false
  store.setActivePanel('files')
  if (store.rightPanelCollapsed) store.toggleRightPanel()
  store.requestWorkspaceFileOpen(raw, raw.split('/').pop() || raw)
  return true
}

/** Open Review panel (git scope by default) and optionally focus a file. */
export function openReviewGitForPath(relPath: string): void {
  ensureReviewPanelEnabled()
  const store = useUIStore.getState()
  const raw = resolveWorkspaceRelativePath(relPath, store.currentWorkspace) || relPath.replace(/\\/g, '/').trim()
  if (!raw) return
  store.setActivePanel('review')
  if (store.rightPanelCollapsed) store.toggleRightPanel()
  store.requestReviewFileOpen('git', raw)
  window.dispatchEvent(new CustomEvent('pi-enterprise-desktop:review-scope', { detail: 'git' }))
  window.dispatchEvent(
    new CustomEvent('pi-enterprise-desktop:review-focus-file', {
      detail: { path: raw },
    }),
  )
}

/** Open the session Review panel even when it was previously hidden in panel settings. */
export function openReviewSession(): void {
  ensureReviewPanelEnabled()
  const store = useUIStore.getState()
  store.setActivePanel('review')
  if (store.rightPanelCollapsed) store.toggleRightPanel()
  window.dispatchEvent(new CustomEvent('pi-enterprise-desktop:review-scope', { detail: 'session' }))
}

/** Open Review panel on session/turn file list and focus a path. */
export function openReviewSessionForPath(relPath: string): void {
  ensureReviewPanelEnabled()
  const store = useUIStore.getState()
  const raw = resolveWorkspaceRelativePath(relPath, store.currentWorkspace) || relPath.replace(/\\/g, '/').trim()
  if (!raw) return
  store.setActivePanel('review')
  if (store.rightPanelCollapsed) store.toggleRightPanel()
  store.requestReviewFileOpen('session', raw)
  window.dispatchEvent(new CustomEvent('pi-enterprise-desktop:review-scope', { detail: 'session' }))
  window.dispatchEvent(
    new CustomEvent('pi-enterprise-desktop:review-focus-file', {
      detail: { path: raw },
    }),
  )
}
