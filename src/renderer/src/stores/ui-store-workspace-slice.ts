import type { StoreApi } from 'zustand'
import type { UIState } from '@renderer/stores/ui-store-types'

type WorkspaceSlice = Pick<
  UIState,
  | 'currentWorkspace'
  | 'recentProjects'
  | 'ephemeralSandboxDraft'
  | 'pendingNewSessionPlaceholder'
  | 'enterEphemeralSandboxDraft'
  | 'enterPendingNewSessionPlaceholder'
  | 'clearPendingNewSessionPlaceholder'
  | 'clearEphemeralSandboxDraft'
  | 'setWorkspace'
  | 'workspaceFileOpenRequest'
  | 'requestWorkspaceFileOpen'
  | 'consumeWorkspaceFileOpen'
  | 'reviewFileOpenRequest'
  | 'requestReviewFileOpen'
  | 'consumeReviewFileOpen'
>

let workspaceFileOpenSeq = 0
let reviewFileOpenSeq = 0

export function createWorkspaceSlice(
  set: StoreApi<UIState>['setState'],
): WorkspaceSlice {
  return {
    currentWorkspace: null,
    recentProjects: [],
    ephemeralSandboxDraft: false,
    pendingNewSessionPlaceholder: false,
    workspaceFileOpenRequest: null,
    reviewFileOpenRequest: null,

    requestWorkspaceFileOpen: (rel, name) =>
      set({
        workspaceFileOpenRequest: {
          id: ++workspaceFileOpenSeq,
          rel,
          name,
        },
      }),

    consumeWorkspaceFileOpen: (requestId) =>
      set((state) =>
        state.workspaceFileOpenRequest?.id === requestId
          ? { workspaceFileOpenRequest: null }
          : {},
      ),

    requestReviewFileOpen: (scope, path) =>
      set({
        reviewFileOpenRequest: {
          id: ++reviewFileOpenSeq,
          scope,
          path,
        },
      }),

    consumeReviewFileOpen: (requestId) =>
      set((state) =>
        state.reviewFileOpenRequest?.id === requestId
          ? { reviewFileOpenRequest: null }
          : {},
      ),

    enterEphemeralSandboxDraft: () => {
      set({
        ephemeralSandboxDraft: true,
        pendingNewSessionPlaceholder: false,
        currentWorkspace: null,
        currentSessionId: '__ephemeral_draft__',
        reviewFileOpenRequest: null,
        timelineItems: [],
        streamingAssistantId: null,
        fileChanges: [],
        historyTotalCount: 0,
        historyLoadedCount: 0,
        historySessionFile: null,
        historyLoading: false,
        sessionLeaseSnapshot: null,
        sessionLeaseDialogOpen: false,
        managedWorktrees: [],
        worktreeCapability: null,
        unregisteredWorktrees: [],
        worktreeError: null,
      })
      void import('@renderer/lib/ipc-client').then(({ ipcClient }) =>
        ipcClient.invoke('session.setEphemeralDraft', { active: true }).catch(() => {}),
      )
      void import('@renderer/stores/extension-ui-store').then(({ useExtensionUIStore }) =>
        useExtensionUIStore.getState().resetForSessionContext(),
      )
    },

    enterPendingNewSessionPlaceholder: (opts) => {
      const keepTimeline = opts?.keepTimeline === true
      set({
        pendingNewSessionPlaceholder: true,
        ephemeralSandboxDraft: false,
        currentSessionId: '__pending_new__',
        reviewFileOpenRequest: null,
        ...(keepTimeline
          ? {}
          : {
              timelineItems: [],
              streamingAssistantId: null,
              fileChanges: [],
              historyTotalCount: 0,
              historyLoadedCount: 0,
              historySessionFile: null,
              historyLoading: false,
              sessionLeaseSnapshot: null,
              sessionLeaseDialogOpen: false,
            }),
      })
      void import('@renderer/lib/ipc-client').then(({ ipcClient }) =>
        ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {}),
      )
      void import('@renderer/stores/extension-ui-store').then(({ useExtensionUIStore }) =>
        useExtensionUIStore.getState().resetForSessionContext(),
      )
    },

    clearPendingNewSessionPlaceholder: () => {
      set({ pendingNewSessionPlaceholder: false })
    },

    clearEphemeralSandboxDraft: () => {
      set({ ephemeralSandboxDraft: false })
      void import('@renderer/lib/ipc-client').then(({ ipcClient }) =>
        ipcClient.invoke('session.setEphemeralDraft', { active: false }).catch(() => {}),
      )
    },

    setWorkspace: (workspacePath) =>
      set((state) => {
        const changed = workspacePath !== state.currentWorkspace
        return {
          currentWorkspace: workspacePath,
          workspaceFileOpenRequest: null,
          reviewFileOpenRequest: null,
          ephemeralSandboxDraft: false,
          pendingNewSessionPlaceholder: false,
          recentProjects: workspacePath
            ? [
                workspacePath,
                ...state.recentProjects.filter((projectPath) => projectPath !== workspacePath),
              ].slice(0, 16)
            : state.recentProjects,
          ...(changed
            ? {
                sessions: [],
                currentSessionId: null,
                sessionLeaseSnapshot: null,
                sessionLeaseDialogOpen: false,
                managedWorktrees: [],
                worktreeCapability: null,
                unregisteredWorktrees: [],
                worktreeError: null,
              }
            : {}),
        }
      }),
  }
}
