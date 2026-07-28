import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import type { SessionItem } from '@renderer/stores/ui-store-types'
import { titleFromFirstMessage } from '@renderer/lib/ephemeral-sandbox'
import { normalizeModelKey, normalizeThinkingLevel } from '@renderer/lib/format-run-display'
import i18n from '@renderer/lib/i18n'

/** 侧栏「新会话」：仅占位，不碰 Worker */
export function enterNewSessionPlaceholder(): void {
  useUIStore.getState().enterPendingNewSessionPlaceholder()
}

/** 首条消息：创建真实 session 并刷新侧栏 */
export async function materializePendingNewSession(workspaceId: string, firstMessage: string): Promise<void> {
  if (!workspaceId) return
  const store = useUIStore.getState()

  const title = titleFromFirstMessage(firstMessage, 48) || i18n.t('common:newSession')
  const inheritedModel =
    normalizeModelKey(store.runState.model) ?? normalizeModelKey(store.lastModel)
  const inheritedThinking =
    normalizeThinkingLevel(store.runState.thinkingLevel) ??
    normalizeThinkingLevel(store.lastThinking)

  const res = await ipcClient.invoke('session.new', {
    workspaceId,
    ...(inheritedModel ? { modelId: inheritedModel } : {}),
    ...(inheritedThinking ? { thinkingLevel: inheritedThinking } : {}),
  })
  const sessionId = res?.session?.sessionId
  if (!sessionId) throw new Error('session.new returned no sessionId')

  const sessionFile = res?.session?.sessionFile as string | undefined

  store.clearPendingNewSessionPlaceholder()
  store.setCurrentSession(sessionId)
  // 勿 loadHistoryItems([])：首条发送前 Composer 已 append 乐观气泡
  store.clearFileChanges()
  if (sessionFile) {
    store.setHistoryMeta(0, 0, sessionFile)
    // session.new 后 Worker 已是新会话，勿 setPendingBind（否则 prompt.send 会再 loadSession 卡很久）
    await ipcClient.invoke('session.setPendingBind', { sessionFile: null }).catch(() => {})
  }

  const { refreshComposerRunDisplay } = await import('@renderer/lib/composer-run-display')
  void refreshComposerRunDisplay()

  const row = {
    sessionId,
    sessionFile,
    title,
    updatedAt: Date.now(),
    messageCount: 0,
    modelId: res.session.modelId || inheritedModel || '',
  }
  const upsertCreatedSession = (sessions: SessionItem[]): SessionItem[] => {
    const inList = sessions.some((session) => session.sessionId === sessionId)
    if (!inList) return [row as SessionItem, ...sessions]
    return sessions.map((session) =>
      session.sessionId === sessionId
        ? { ...session, sessionFile: sessionFile ?? session.sessionFile, title }
        : session,
    )
  }

  // Paint the sidebar immediately. Disk reconciliation is non-critical and must
  // not delay the first prompt reaching the Worker.
  store.setSessions(upsertCreatedSession(useUIStore.getState().sessions))
  void ipcClient
    .invoke('session.list', { workspaceId })
    .then((listRes) => {
      if (useUIStore.getState().currentWorkspace !== workspaceId) return
      const listed = (listRes?.sessions || []) as SessionItem[]
      useUIStore.getState().setSessions(upsertCreatedSession(listed))
    })
    .catch(() => {})
}
