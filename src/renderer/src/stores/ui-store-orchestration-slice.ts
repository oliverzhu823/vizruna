import type { StoreApi } from 'zustand'
import type { AgentRelationship } from '@shared/orchestration'
import type { UIState } from '@renderer/stores/ui-store-types'

type OrchestrationSlice = Pick<
  UIState,
  | 'orchestrationRelationships'
  | 'orchestrationLoading'
  | 'orchestrationError'
  | 'setOrchestrationSnapshot'
  | 'upsertOrchestrationRelationship'
  | 'setOrchestrationLoading'
  | 'setOrchestrationError'
>

export function createOrchestrationSlice(
  set: StoreApi<UIState>['setState'],
): OrchestrationSlice {
  return {
    orchestrationRelationships: {},
    orchestrationLoading: false,
    orchestrationError: null,
    setOrchestrationSnapshot: (relationships) =>
      set({
        orchestrationRelationships: Object.fromEntries(
          relationships.map((relationship) => [
            relationship.id,
            relationship,
          ]),
        ),
      }),
    upsertOrchestrationRelationship: (relationship) =>
      set((state) => {
        const current = state.orchestrationRelationships[relationship.id]
        if (current && current.sequence >= relationship.sequence) return state
        return {
          orchestrationRelationships: {
            ...state.orchestrationRelationships,
            [relationship.id]: relationship,
          },
        }
      }),
    setOrchestrationLoading: (loading) =>
      set({ orchestrationLoading: loading }),
    setOrchestrationError: (error) =>
      set({ orchestrationError: error }),
  }
}
