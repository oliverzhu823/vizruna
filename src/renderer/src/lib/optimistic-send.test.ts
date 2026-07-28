import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useUIStore } from '@renderer/stores/ui-store'
import { appendOptimisticOutgoingMessage, clearOptimisticOutgoing } from './optimistic-send'

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({}) },
}))

vi.mock('@renderer/features/timeline/timeline-bottom-anchor', () => ({
  requestTimelineBottomAnchor: vi.fn(),
}))

describe('clearOptimisticOutgoing', () => {
  beforeEach(() => {
    useUIStore.getState().clearTimeline()
    useUIStore.setState({
      historySessionFile: '/sessions/current.jsonl',
      sessionRuntimeRunning: {},
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    })
  })

  it('removes only the failed optimistic pair and resets its running state', () => {
    useUIStore.setState({
      timelineItems: [
        {
          id: 'opt-user-previous',
          type: 'user-message',
          text: 'previous accepted message',
          sessionEntryId: 'entry-1',
          timestamp: 1,
        },
      ],
    })
    appendOptimisticOutgoingMessage('failed message')
    expect(useUIStore.getState().timelineItems).toHaveLength(3)

    clearOptimisticOutgoing()

    const state = useUIStore.getState()
    expect(state.timelineItems).toEqual([
      expect.objectContaining({ id: 'opt-user-previous', sessionEntryId: 'entry-1' }),
    ])
    expect(state.optimisticPendingUserText).toBeNull()
    expect(state.agentTurnBootstrapping).toBe(false)
    expect(state.streamingAssistantId).toBeNull()
    expect(state.sessionRuntimeRunning['/sessions/current.jsonl']).toBeUndefined()
  })
})
