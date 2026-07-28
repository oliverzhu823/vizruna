import { describe, expect, it } from 'vitest'
import type { AgentRelationship } from '@shared/orchestration'
import type { UIState } from './ui-store-types'
import { createOrchestrationSlice } from './ui-store-orchestration-slice'
import { persistedUiSubset } from './ui-store'

function relationship(sequence: number, status: AgentRelationship['status']) {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    parentSessionFile: '/parent.jsonl',
    parentWorkerKey: '/parent.jsonl',
    rootWorkspacePath: '/repo',
    childWorkspacePath: '/repo-child',
    environment: 'worktree',
    name: 'Child',
    goal: 'Goal',
    status,
    depth: 1,
    sequence,
    lastWorkerEventSequence: sequence,
    timeoutMs: 30_000,
    requiresInput: false,
    verificationStatus: 'unverified',
    createdAt: 1,
    updatedAt: sequence,
  } satisfies AgentRelationship
}

describe('orchestration UI slice', () => {
  it('ignores duplicate and out-of-order relationship events', () => {
    let state = {} as UIState
    const setState = (
      patch:
        | Partial<UIState>
        | ((current: UIState) => Partial<UIState> | UIState),
    ) => {
      const next = typeof patch === 'function' ? patch(state) : patch
      state = { ...state, ...next }
    }
    const slice = createOrchestrationSlice(
      setState as Parameters<typeof createOrchestrationSlice>[0],
    )
    state = { ...state, ...slice }

    slice.upsertOrchestrationRelationship(relationship(3, 'running'))
    slice.upsertOrchestrationRelationship(relationship(2, 'failed'))

    expect(
      state.orchestrationRelationships[
        '00000000-0000-4000-8000-000000000001'
      ].status,
    ).toBe('running')
  })

  it('does not persist derived orchestration runtime state', () => {
    const subset = persistedUiSubset({
      currentWorkspace: '/repo',
      recentProjects: ['/repo'],
      activePanel: 'agents',
      theme: 'system',
      sidebarWidth: 260,
      sidebarCollapsed: false,
      rightPanelWidth: 320,
      rightPanelCollapsed: false,
      lastModel: null,
      lastThinking: null,
      orchestrationRelationships: {
        child: relationship(4, 'running'),
      },
    } as unknown as UIState)

    expect(subset).not.toHaveProperty('orchestrationRelationships')
    expect(subset).not.toHaveProperty('orchestrationLoading')
  })
})
