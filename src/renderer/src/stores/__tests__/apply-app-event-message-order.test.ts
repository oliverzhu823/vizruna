import { describe, expect, it } from 'vitest'
import { handleMessage } from '../apply-app-event-message'
import type { StoreApi } from '../apply-app-event-types'
import type { RunState, TimelineItem, UIState } from '../ui-store-types'

function makeApi(
  initialItems: TimelineItem[],
  initialStreamingAssistantId: string | null,
): { api: StoreApi; state: UIState } {
  let seq = 0
  const state = {
    timelineItems: initialItems,
    streamingAssistantId: initialStreamingAssistantId,
    optimisticPendingUserText: null,
    agentTurnBootstrapping: false,
    runState: { status: 'running', toolCount: 0, errorCount: 0 } as RunState,
    appendTimeline: (item: TimelineItem) => {
      state.timelineItems = [...state.timelineItems, item]
    },
    updateTimelineItem: (id: string, patch: Partial<TimelineItem>) => {
      state.timelineItems = state.timelineItems.map((item) =>
        item.id === id ? { ...item, ...patch } : item,
      )
    },
    setRunState: (patch: Partial<RunState>) => {
      state.runState = { ...state.runState, ...patch }
    },
  } as unknown as UIState

  return {
    state,
    api: {
      get: () => state,
      set: (partial) => Object.assign(state, partial),
      nextItemId: () => `generated-${++seq}`,
    },
  }
}

function assistantStart(runId = 'run-2') {
  return {
    type: 'message' as const,
    role: 'assistant' as const,
    phase: 'start' as const,
    seq: 10,
    workspaceId: '/workspace',
    sessionId: 'session-1',
    sessionFile: '/session.jsonl',
    runId,
    timestamp: 10,
  }
}

describe('assistant live message ordering', () => {
  it('appends a post-tool reply instead of reusing an empty placeholder from a failed turn', () => {
    const { api, state } = makeApi(
      [
        { id: 'user-1', type: 'user-message', text: '你是什么模型', timestamp: 1 },
        {
          id: 'opt-asst-1',
          type: 'assistant-message',
          text: '',
          thinkingText: '',
          incomplete: true,
          stopReason: 'error',
          timestamp: 2,
        },
        { id: 'error-1', type: 'error', text: 'usage limit', timestamp: 3 },
        { id: 'user-2', type: 'user-message', text: '你是什么模型', timestamp: 4 },
        {
          id: 'opt-asst-2',
          type: 'assistant-message',
          text: '',
          thinkingText: '思考了 6 秒',
          runId: 'run-2',
          sessionEntryId: 'assistant-tool-entry',
          timestamp: 5,
        },
        {
          id: 'tool-1',
          type: 'tool-call',
          toolName: 'bash',
          toolCallId: 'call-1',
          toolPhase: 'end',
          runId: 'run-2',
          timestamp: 6,
        },
      ],
      null,
    )

    handleMessage(assistantStart(), api)

    expect(state.timelineItems.map((item) => item.id)).toEqual([
      'user-1',
      'opt-asst-1',
      'error-1',
      'user-2',
      'opt-asst-2',
      'tool-1',
      'generated-1',
    ])
    expect(state.streamingAssistantId).toBe('generated-1')
    expect(state.timelineItems[1]).toMatchObject({
      id: 'opt-asst-1',
      text: '',
      incomplete: true,
      stopReason: 'error',
    })
  })

  it('rejects a stale streaming id that is before the latest user message', () => {
    const { api, state } = makeApi(
      [
        { id: 'old-user', type: 'user-message', text: 'first', timestamp: 1 },
        { id: 'old-assistant', type: 'assistant-message', text: '', timestamp: 2 },
        { id: 'latest-user', type: 'user-message', text: 'second', timestamp: 3 },
      ],
      'old-assistant',
    )

    handleMessage(assistantStart(), api)

    expect(state.streamingAssistantId).toBe('generated-1')
    expect(state.timelineItems.at(-1)).toMatchObject({
      id: 'generated-1',
      type: 'assistant-message',
      runId: 'run-2',
    })
  })

  it('keeps the current optimistic placeholder for the latest user message', () => {
    const { api, state } = makeApi(
      [
        { id: 'latest-user', type: 'user-message', text: 'hello', timestamp: 1 },
        { id: 'opt-asst-current', type: 'assistant-message', text: '', timestamp: 2 },
      ],
      'opt-asst-current',
    )

    handleMessage(assistantStart(), api)

    expect(state.timelineItems).toHaveLength(2)
    expect(state.streamingAssistantId).toBe('opt-asst-current')
    expect(state.timelineItems[1]).toMatchObject({ id: 'opt-asst-current', runId: 'run-2' })
  })
})
