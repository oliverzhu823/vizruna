import { resolve } from 'node:path'
import type { AgentRunArtifact, AgentRunHistoryItem } from '@shared/agent-run-history'
import { buildAgentRunObservability } from '@shared/agent-run-observability'
import { sqliteIndex } from '../../sqlite-index'
import { workerManager } from '../../worker-manager'
import { listSessionsOnDisk } from '../sdk-session'
import { registerHandlerWithSchema } from '../registry'
import { agentRunHistoryListSchema } from '../schemas'

function tailEvidence(items: Array<Record<string, unknown>>): {
  failureReason?: string
  files: AgentRunArtifact[]
} {
  let failureReason: string | undefined
  const files = new Map<string, AgentRunArtifact>()
  for (const item of items) {
    const type = String(item.type || '')
    if (type === 'agent_error' || type === 'error') {
      const value = String(item.text || item.message || '').trim()
      if (value) failureReason = value
    }
    if (
      (type === 'message' && String(item.role || '') === 'assistant') ||
      (type === 'run' && String(item.phase || '') === 'idle')
    ) failureReason = undefined
    if (type === 'file') {
      const path = String(item.path || '').trim()
      if (path) files.set(path, { kind: 'file', name: path.split(/[\\/]/).pop() || path, path })
    }
  }
  return { failureReason, files: [...files.values()] }
}

export function registerAgentRunHandlers(): void {
  registerHandlerWithSchema('ipc:agentRun.list', agentRunHistoryListSchema, async (request) => {
    const { getSessionMessagesFromDisk } = await import('../../session-messages-from-disk')
    const sessions = await listSessionsOnDisk(request.workspacePath)
    const sessionByFile = new Map(sessions.map((session) => [resolve(session.path), session]))
    const runningFiles = new Set(
      workerManager.listSessionRuntime().filter((item) => item.running).map((item) => resolve(item.sessionFile)),
    )
    const cases = sqliteIndex.listAgentCases({ workspacePath: request.workspacePath, includeArchived: false })
    const caseBySession = new Map(cases.map((agentCase) => [resolve(agentCase.sourceSessionFile), agentCase]))
    const bindings = sqliteIndex.listSessionAgentBindings(request.profileId)
    const selected = bindings
      .filter((binding) => sessionByFile.has(resolve(binding.sessionFile)))
      .slice(0, request.limit ?? 12)

    const runs = await Promise.all(selected.map(async (binding): Promise<AgentRunHistoryItem> => {
      const key = resolve(binding.sessionFile)
      const session = sessionByFile.get(key)!
      const agentCase = caseBySession.get(key)
      const tail = await getSessionMessagesFromDisk(binding.sessionFile, undefined, 500).catch(() => ({ items: [] as Array<Record<string, unknown>>, totalCount: 0 }))
      const evidence = tailEvidence(tail.items)
      const runtimeEvidence = sqliteIndex.getAgentRunRuntimeEvidence(binding.sessionFile)
      const running = runningFiles.has(key)
      const artifacts: AgentRunArtifact[] = [
        ...(agentCase ? [{ kind: 'case' as const, id: agentCase.id, name: agentCase.name }] : []),
        ...evidence.files,
      ]
      return {
        sessionId: binding.sessionId,
        sessionFile: binding.sessionFile,
        workspacePath: session.cwd || request.workspacePath,
        title: session.name || session.firstMessage?.slice(0, 60) || binding.snapshot.name,
        prompt: session.firstMessage || undefined,
        profileId: binding.profileId,
        versionId: binding.snapshot.versionId,
        versionNumber: binding.snapshot.versionNumber,
        modelId: binding.snapshot.modelId,
        thinkingLevel: binding.snapshot.thinkingLevel,
        status: running ? 'running' : evidence.failureReason ? 'failed' : 'completed',
        failureReason: evidence.failureReason,
        messageCount: session.messageCount || tail.totalCount || 0,
        createdAt: session.created?.getTime() || binding.createdAt,
        updatedAt: session.modified?.getTime() || binding.createdAt,
        artifacts,
        caseId: agentCase?.id,
        runtimeEvidence,
        observability: buildAgentRunObservability({ items: tail.items, totalCount: tail.totalCount, runtimeEvidence }),
        turns: sqliteIndex.listAgentRunTurnEvidence(binding.sessionFile, 50),
        capabilitySnapshot: {
          tools: binding.snapshot.tools,
          extensionTools: binding.snapshot.extensionTools,
          resourceSnapshot: binding.snapshot.resourceSnapshot,
        },
      }
    }))
    return { runs: runs.sort((a, b) => b.updatedAt - a.updatedAt) }
  })
}
