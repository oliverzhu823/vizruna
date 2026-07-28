import type { StoreApi } from 'zustand'
import type { UIState } from '@renderer/stores/ui-store-types'

type WorktreeSlice = Pick<
  UIState,
  | 'managedWorktrees'
  | 'worktreeCapability'
  | 'unregisteredWorktrees'
  | 'worktreeLoading'
  | 'worktreeError'
  | 'setManagedWorktreeState'
>

export function createWorktreeSlice(
  set: StoreApi<UIState>['setState'],
): WorktreeSlice {
  return {
    managedWorktrees: [],
    worktreeCapability: null,
    unregisteredWorktrees: [],
    worktreeLoading: false,
    worktreeError: null,
    setManagedWorktreeState: (patch) =>
      set({
        ...(patch.worktrees !== undefined ? { managedWorktrees: patch.worktrees } : {}),
        ...(patch.capability !== undefined
          ? { worktreeCapability: patch.capability }
          : {}),
        ...(patch.unregistered !== undefined
          ? { unregisteredWorktrees: patch.unregistered }
          : {}),
        ...(patch.loading !== undefined ? { worktreeLoading: patch.loading } : {}),
        ...(patch.error !== undefined ? { worktreeError: patch.error } : {}),
      }),
  }
}
