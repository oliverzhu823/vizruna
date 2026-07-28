import { beforeEach, describe, expect, it } from 'vitest'
import type { AppEvent } from '@shared/app-events'
import { applyAppEvent } from '../apply-app-event'
import { useUIStore } from '../ui-store'

describe('applyAppEvent session lease loss', () => {
  beforeEach(() => {
    useUIStore.setState({
      sessionLeaseSnapshot: null,
      sessionLeaseDialogOpen: false,
      sessionLeaseTakeoverPending: false,
      runState: {
        status: 'running',
        activeRunId: 'run-1',
        toolCount: 0,
        errorCount: 0,
      },
      sessionRuntimeRunning: { '/tmp/session.jsonl': true },
    })
  })

  it('switches the affected session to read-only and idle immediately', () => {
    const event: AppEvent = {
      type: 'lease',
      phase: 'lost',
      seq: 1,
      workspaceId: '/tmp',
      sessionFile: '/tmp/session.jsonl',
      timestamp: Date.now(),
      snapshot: {
        sessionFile: '/tmp/session.jsonl',
        leaseFile: '/tmp/session.jsonl.lease',
        disposition: 'active-foreign',
        reason: 'same-host-live-pid',
      },
    }

    applyAppEvent(event, {
      get: useUIStore.getState,
      set: useUIStore.setState,
      nextItemId: () => 'item-1',
    })

    const state = useUIStore.getState()
    expect(state.sessionLeaseDialogOpen).toBe(true)
    expect(state.sessionLeaseSnapshot).toEqual(event.snapshot)
    expect(state.runState.status).toBe('idle')
    expect(state.sessionRuntimeRunning['/tmp/session.jsonl']).toBeUndefined()
  })
})
