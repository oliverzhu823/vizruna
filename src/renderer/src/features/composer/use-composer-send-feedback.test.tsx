import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { useComposerSend } from './use-composer-send'

const mocks = vi.hoisted(() => ({
  appendOptimisticOutgoingMessage: vi.fn(),
  afterPromptSent: vi.fn().mockResolvedValue(undefined),
  resolvePrompt: null as null | ((value: unknown) => void),
}))

vi.mock('@renderer/lib/ipc-client', () => ({
  ipcClient: { invoke: vi.fn().mockResolvedValue({ adapters: [] }) },
}))

vi.mock('./attachments', () => ({
  serializeRichInput: () => ({
    displayText: '你好',
    payload: '你好',
    attachments: [],
    segments: [{ type: 'text', text: '你好' }],
  }),
  renderRichTextFromPlain: vi.fn(),
}))

vi.mock('@renderer/lib/session-worker-sync', () => ({
  composerTurnActive: () => false,
}))

vi.mock('./delayed-tooltip', () => ({ hideAllDelayedTooltips: vi.fn() }))
vi.mock('@renderer/lib/optimistic-send', () => ({
  appendOptimisticOutgoingMessage: mocks.appendOptimisticOutgoingMessage,
  clearOptimisticOutgoing: vi.fn(),
}))
vi.mock('@renderer/lib/after-prompt-sent', () => ({
  afterPromptSent: mocks.afterPromptSent,
}))
vi.mock('@renderer/lib/slash-desktop-router', () => ({
  routeDesktopSlashBeforeSend: vi.fn().mockResolvedValue({ handled: false }),
}))
vi.mock('@renderer/lib/composer-abort', () => ({
  abortAgentTurn: vi.fn(),
  isComposerAbortCooldown: () => false,
}))
vi.mock('@renderer/stores/extension-ui-store', () => ({
  extensionUiBlocksComposer: () => false,
}))

describe('useComposerSend immediate feedback', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.resolvePrompt = null
    useUIStore.setState({
      currentWorkspace: '/workspace',
      ephemeralSandboxDraft: false,
      pendingNewSessionPlaceholder: false,
      currentSessionId: 'session-1',
      historySessionFile: '/sessions/current.jsonl',
      timelineItems: [],
      streamingAssistantId: null,
      optimisticPendingUserText: null,
      agentTurnBootstrapping: false,
      sessionRuntimeRunning: {},
      workerLiveSnapshot: { sessionId: null, sessionFile: null, status: 'idle' },
      runState: { status: 'idle', toolCount: 0, errorCount: 0 },
    })
    vi.mocked(ipcClient.invoke).mockImplementation(
      () =>
        new Promise((resolve) => {
          mocks.resolvePrompt = resolve
        }) as never,
    )
  })

  it('shows the optimistic thinking state before waiting for prompt IPC', async () => {
    const editor = document.createElement('div')
    const inputHistory = { recordSent: vi.fn() }
    const { result } = renderHook(() =>
      useComposerSend({
        editorRef: { current: editor },
        text: '你好',
        attachments: [],
        updateFromEditor: vi.fn(),
        clearEditor: vi.fn(),
        setContent: vi.fn(),
        restoreSegments: vi.fn(),
        inputHistory: inputHistory as never,
        refreshCommands: vi.fn().mockResolvedValue(undefined),
        showComposerStop: false,
        isRunning: false,
      }),
    )

    let pending: Promise<void>
    act(() => {
      pending = result.current.sendCurrent()
    })

    await vi.waitFor(() => {
      expect(mocks.appendOptimisticOutgoingMessage).toHaveBeenCalledWith('你好', {
        attachments: [],
        segments: [{ type: 'text', text: '你好' }],
      })
    })
    expect(mocks.resolvePrompt).toBeTypeOf('function')

    await act(async () => {
      mocks.resolvePrompt?.({})
      await pending!
    })
    expect(mocks.afterPromptSent).toHaveBeenCalledOnce()
  })
})
