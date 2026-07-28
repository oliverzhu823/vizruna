import { ipcClient } from '@renderer/lib/ipc-client'
import { normalizeModelKey } from '@renderer/lib/format-run-display'
import { useUIStore } from '@renderer/stores/ui-store'

export async function selectSessionModel(
  provider: string,
  modelId: string,
  context?: { workspaceId?: string; sessionFile?: string; deferUntilSession?: boolean },
): Promise<string> {
  const state = useUIStore.getState()
  const requested = `${provider}/${modelId}`
  const workspaceId = context ? context.workspaceId : state.currentWorkspace ?? undefined
  const sessionFile = context ? context.sessionFile : state.historySessionFile ?? undefined
  const deferUntilSession = context?.deferUntilSession ?? state.ephemeralSandboxDraft
  const response = await ipcClient.invoke('model.set', {
    sessionId: '',
    provider,
    modelId,
    workspaceId,
    sessionFile,
    deferUntilSession,
  })
  const actual = normalizeModelKey(response?.modelId)
  if (!actual) throw new Error('Model switch was not confirmed')
  if (actual !== requested) {
    throw new Error(`Model switch mismatch: requested ${requested}, actual ${actual}`)
  }
  return actual
}
