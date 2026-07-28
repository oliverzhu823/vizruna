import { useCallback } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { executeSlashCommand, isExecutableBuiltin } from './slash-exec'
import { renderRichTextFromPlain, serializeRichInput, type Segment } from './attachments'
import { routeDesktopSlashBeforeSend } from '@renderer/lib/slash-desktop-router'
import { abortAgentTurn, isComposerAbortCooldown } from '@renderer/lib/composer-abort'
import { extensionUiBlocksComposer } from '@renderer/stores/extension-ui-store'
import { composerTurnActive } from '@renderer/lib/session-worker-sync'
import { hideAllDelayedTooltips } from './delayed-tooltip'
import type { useComposerInputHistory } from './use-composer-input-history'
import type { SessionLeaseSnapshot } from '@shared/session-lease'

// Start loading the small optimistic-feedback module as soon as Composer loads.
// It stays split from the main bundle, but is ready before the user's first send.
const optimisticSendModule = import('@renderer/lib/optimistic-send')

class PromptLeaseConflict extends Error {
  constructor(readonly snapshot: SessionLeaseSnapshot) {
    super('Session lease conflict')
  }
}

function assertPromptAccepted(response: {
  error?: string
  leaseConflict?: SessionLeaseSnapshot
}): void {
  if (response?.error === 'SESSION_LEASE_CONFLICT' && response.leaseConflict) {
    throw new PromptLeaseConflict(response.leaseConflict)
  }
}

export function useComposerSend(opts: {
  editorRef: React.RefObject<HTMLDivElement | null>
  text: string
  attachments: { path: string }[]
  updateFromEditor: () => void
  clearEditor: () => void
  setContent: (plain: string) => void
  restoreSegments: (segments: Segment[]) => void
  inputHistory: ReturnType<typeof useComposerInputHistory>
  refreshCommands: () => Promise<void>
  showComposerStop: boolean
  isRunning: boolean
}) {
  const { t } = useTranslation()
  const {
    editorRef,
    text,
    attachments,
    updateFromEditor,
    clearEditor,
    setContent,
    restoreSegments,
    inputHistory,
    refreshCommands,
    showComposerStop,
    isRunning,
  } = opts

  const sendCurrent = useCallback(
    async (queueOpts?: { queue?: 'steer' | 'followUp' }) => {
      if (extensionUiBlocksComposer()) {
        toast.message(t('composer:toast.completeExtensionFirst'))
        return
      }
      const el = editorRef.current
      if (!el) return
      const { displayText, payload, attachments: atts, segments } = serializeRichInput(el)
      if (!displayText.trim() && atts.length === 0) return
      const draft = useUIStore.getState().ephemeralSandboxDraft
      const currentWorkspace = useUIStore.getState().currentWorkspace
      if (!currentWorkspace && !draft) return
      const store = useUIStore.getState()
      const running = composerTurnActive({
        historySessionFile: store.historySessionFile,
        workerLiveSnapshot: store.workerLiveSnapshot,
        runState: store.runState,
        streamingAssistantId: store.streamingAssistantId,
        optimisticPendingUserText: store.optimisticPendingUserText,
        sessionRuntimeRunning: store.sessionRuntimeRunning,
        agentTurnBootstrapping: store.agentTurnBootstrapping,
      })
      if (displayText.trim()) inputHistory.recordSent(displayText.trim())
      hideAllDelayedTooltips()
      renderRichTextFromPlain(el, '')
      updateFromEditor()
      editorRef.current?.focus()
      const pendingNew = store.pendingNewSessionPlaceholder
      const homeMode = !store.currentSessionId && store.timelineItems.length === 0
      const { appendOptimisticOutgoingMessage, clearOptimisticOutgoing } =
        await optimisticSendModule
      const promptPayload = () => ({
        sessionId: '',
        sessionFile: useUIStore.getState().historySessionFile ?? undefined,
        text: payload,
      })
      const sendPrompt = () => ipcClient.invoke('prompt.send', promptPayload())
      const syncAfterPrompt = async (bind: Awaited<ReturnType<typeof sendPrompt>>) => {
        const { afterPromptSent } = await import('@renderer/lib/after-prompt-sent')
        await afterPromptSent(bind)
      }
      const pendMsg = displayText.trim()
      if (pendMsg.startsWith('/')) {
        const routed = await routeDesktopSlashBeforeSend(pendMsg)
        if (routed.handled) return
      }
      try {
        if (!running && draft) {
          appendOptimisticOutgoingMessage(pendMsg, { bootstrap: true, attachments: atts, segments })
          const { finalizeEphemeralSandboxOnFirstSend } = await import('@renderer/lib/ephemeral-sandbox')
          await finalizeEphemeralSandboxOnFirstSend(pendMsg)
          const bind = await sendPrompt()
          assertPromptAccepted(bind)
          await syncAfterPrompt(bind)
          return
        }
        if (!running && (homeMode || pendingNew) && store.currentWorkspace) {
          appendOptimisticOutgoingMessage(pendMsg, { bootstrap: true, attachments: atts, segments })
          const { materializePendingNewSession } = await import('@renderer/lib/new-session')
          await materializePendingNewSession(store.currentWorkspace, pendMsg)
          const bind = await sendPrompt()
          assertPromptAccepted(bind)
          await syncAfterPrompt(bind)
          return
        }
        if (running) {
          const queue = queueOpts?.queue ?? 'steer'
          if (queue === 'steer') {
            const bind = await ipcClient.invoke('prompt.steer', promptPayload())
            assertPromptAccepted(bind)
            await syncAfterPrompt(bind)
          } else {
            const bind = await ipcClient.invoke('prompt.followUp', promptPayload())
            assertPromptAccepted(bind)
            await syncAfterPrompt(bind)
          }
          return
        }
        appendOptimisticOutgoingMessage(pendMsg, { attachments: atts, segments })
        const bind = await sendPrompt()
        assertPromptAccepted(bind)
        await syncAfterPrompt(bind)
      } catch (e) {
        console.error('Send failed:', e)
        clearOptimisticOutgoing()
        useUIStore.getState().setRunState({ status: 'idle' })
        if (e instanceof PromptLeaseConflict) {
          restoreSegments(segments)
          useUIStore.getState().setSessionLeaseSnapshot(e.snapshot, {
            openConflictDialog: true,
          })
          toast.warning(t('lease:sendBlocked'))
          return
        }
        toast.error(t('composer:toast.sendFailed'))
      }
    },
    [editorRef, inputHistory, restoreSegments, t, updateFromEditor],
  )

  const handleSend = useCallback(async () => {
    if (extensionUiBlocksComposer()) {
      toast.message(t('composer:toast.completeExtensionFirst'))
      return
    }
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0) return
    if (attachments.length === 0 && trimmed.startsWith('/') && isExecutableBuiltin(trimmed)) {
      const handled = await executeSlashCommand(trimmed, { refreshCommands })
      if (handled) {
        clearEditor()
        return
      }
    }
    if (trimmed.startsWith('/')) {
      const routed = await routeDesktopSlashBeforeSend(trimmed)
      if (routed.handled) {
        clearEditor()
        return
      }
    }
    await sendCurrent(showComposerStop || isRunning ? { queue: 'steer' } : undefined)
  }, [
    attachments.length,
    clearEditor,
    isRunning,
    refreshCommands,
    sendCurrent,
    showComposerStop,
    t,
    text,
  ])

  const runComposerAbort = useCallback(
    async (currentText: string) => {
      const { dismissExtensionDialogState } = await import('@renderer/lib/extension-ui-channel')
      dismissExtensionDialogState()
      await abortAgentTurn({ restoreEditorText: currentText, setEditorText: setContent })
    },
    [setContent],
  )

  const handleAbort = useCallback(() => {
    if (isComposerAbortCooldown()) return
    const el = editorRef.current
    const currentText = el ? serializeRichInput(el).displayText : text
    void runComposerAbort(currentText)
  }, [editorRef, runComposerAbort, text])

  return { sendCurrent, handleSend, runComposerAbort, handleAbort }
}
