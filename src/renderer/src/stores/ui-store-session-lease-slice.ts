import type { StoreApi } from 'zustand'
import type { UIState } from '@renderer/stores/ui-store-types'

type SessionLeaseSlice = Pick<
  UIState,
  | 'sessionLeaseSnapshot'
  | 'sessionLeaseDialogOpen'
  | 'sessionLeaseTakeoverPending'
  | 'setSessionLeaseSnapshot'
  | 'dismissSessionLeaseDialog'
  | 'setSessionLeaseTakeoverPending'
>

export function createSessionLeaseSlice(
  set: StoreApi<UIState>['setState'],
): SessionLeaseSlice {
  return {
    sessionLeaseSnapshot: null,
    sessionLeaseDialogOpen: false,
    sessionLeaseTakeoverPending: false,
    setSessionLeaseSnapshot: (snapshot, options) => {
      const conflict =
        snapshot != null &&
        snapshot.disposition !== 'available' &&
        snapshot.disposition !== 'owned'
      set({
        sessionLeaseSnapshot: snapshot,
        sessionLeaseDialogOpen:
          conflict && options?.openConflictDialog === true,
        sessionLeaseTakeoverPending: false,
      })
    },
    dismissSessionLeaseDialog: () => set({ sessionLeaseDialogOpen: false }),
    setSessionLeaseTakeoverPending: (pending) =>
      set({ sessionLeaseTakeoverPending: pending }),
  }
}

