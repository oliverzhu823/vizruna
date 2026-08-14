import { randomUUID } from 'node:crypto'
import type {
  AgentEvaluationBatch,
  AgentEvaluationBatchItem,
  AgentEvaluationRun,
  AgentEvaluationSuite,
} from '@shared/agent-evaluation'
import { auditRepository } from './audit/audit-repository'
import { captureAgentEvaluationSessionEvidence } from './agent-evaluation-evidence'
import { requireAgentVersion } from './agent-version-service'
import { sqliteIndex } from './sqlite-index'
import {
  resolveConversationConfigSnapshot,
  saveConversationConfigBinding,
} from './system-prompt-preset-service'
import { workerManager } from './worker-manager'

const POLL_MS = 250
const RUN_TIMEOUT_MS = 30 * 60 * 1_000

type ActiveBatch = {
  cancelled: boolean
  currentSessionFile?: string
}

const active = new Map<string, ActiveBatch>()

function save(batch: AgentEvaluationBatch): AgentEvaluationBatch {
  if (!sqliteIndex.saveAgentEvaluationBatch(batch)) {
    throw new Error('Agent evaluation batch store is unavailable')
  }
  return batch
}

function updateItem(
  batch: AgentEvaluationBatch,
  scenarioId: string,
  patch: Partial<AgentEvaluationBatchItem>,
): AgentEvaluationBatch {
  return save({
    ...batch,
    items: batch.items.map((item) => item.scenarioId === scenarioId ? { ...item, ...patch } : item),
  })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function waitForIdle(sessionFile: string, state: ActiveBatch): Promise<void> {
  const startedAt = Date.now()
  let observedBusy = false
  while (Date.now() - startedAt < RUN_TIMEOUT_MS) {
    if (state.cancelled) throw new Error('BATCH_CANCELLED')
    const runtime = await workerManager.getState(sessionFile)
    const busy = !!runtime.isStreaming
    observedBusy ||= busy
    if (observedBusy && !busy) return
    await delay(POLL_MS)
  }
  throw new Error('Evaluation task exceeded the 30 minute timeout')
}

async function executeBatch(initial: AgentEvaluationBatch, suite: AgentEvaluationSuite): Promise<void> {
  const control = active.get(initial.id)
  if (!control) return
  let batch = save({ ...initial, status: 'running', startedAt: Date.now() })
  try {
    const version = requireAgentVersion(batch.versionId, batch.profileId)
    const snapshot = await resolveConversationConfigSnapshot({
      kind: 'agent',
      profileId: batch.profileId,
      versionId: version.id,
    }, batch.workspacePath)
    if (!snapshot || !('profileId' in snapshot)) throw new Error('Immutable Agent snapshot is unavailable')
    for (const scenario of sqliteIndex.listAgentEvaluationScenarios(suite.id)) {
      if (control.cancelled) break
      batch = updateItem(batch, scenario.id, { status: 'running', startedAt: Date.now() })
      let sessionFile: string | undefined
      try {
        const session = await workerManager.createConfiguredBackgroundSession(batch.workspacePath, snapshot)
        if (!session) throw new Error('No background Pi worker capacity is available')
        sessionFile = session.sessionFile
        control.currentSessionFile = sessionFile
        saveConversationConfigBinding({
          sessionId: session.sessionId,
          sessionFile,
          snapshot,
        })
        await workerManager.configureBackgroundSession(sessionFile, {
          model: snapshot.modelId,
          thinkingLevel: snapshot.thinkingLevel,
        })
        batch = updateItem(batch, scenario.id, {
          sessionId: session.sessionId,
          sessionFile,
        })
        await workerManager.promptBackgroundSession(sessionFile, scenario.prompt)
        await waitForIdle(sessionFile, control)
        const evidence = await captureAgentEvaluationSessionEvidence({
          scenario,
          sourceSessionId: session.sessionId,
          sourceSessionFile: sessionFile,
          snapshot,
        })
        if (evidence.agent?.versionId !== version.id) {
          throw new Error('Background run did not preserve the requested Agent version')
        }
        const now = Date.now()
        const run: AgentEvaluationRun = {
          id: randomUUID(),
          suiteId: suite.id,
          scenarioId: scenario.id,
          sourceCaseId: `batch:${batch.id}`,
          evidence,
          verdict: 'pending',
          createdAt: now,
          updatedAt: now,
        }
        if (!sqliteIndex.saveAgentEvaluationRun(run)) {
          throw new Error('Agent evaluation run store is unavailable')
        }
        batch = updateItem(batch, scenario.id, {
          status: 'completed',
          runId: run.id,
          completedAt: now,
        })
      } catch (error) {
        const cancelled = control.cancelled || String(error).includes('BATCH_CANCELLED')
        batch = updateItem(batch, scenario.id, {
          status: cancelled ? 'cancelled' : 'failed',
          error: cancelled ? undefined : error instanceof Error ? error.message : String(error),
          completedAt: Date.now(),
        })
      } finally {
        control.currentSessionFile = undefined
        if (sessionFile) await workerManager.stopBackgroundSession(sessionFile).catch(() => {})
      }
    }
    const completedAt = Date.now()
    batch = save({
      ...batch,
      status: control.cancelled ? 'cancelled' : 'completed',
      completedAt,
      items: control.cancelled
        ? batch.items.map((item) => item.status === 'pending' ? { ...item, status: 'cancelled', completedAt } : item)
        : batch.items,
    })
    auditRepository.write({
      category: 'operation',
      action: 'agent-evaluation.batch.finish',
      outcome: control.cancelled ? 'blocked' : 'success',
      workspaceId: batch.workspacePath,
      details: {
        batchId: batch.id,
        suiteId: batch.suiteId,
        completed: batch.items.filter((item) => item.status === 'completed').length,
        failed: batch.items.filter((item) => item.status === 'failed').length,
        cancelled: control.cancelled,
      },
    })
  } catch (error) {
    save({
      ...batch,
      status: control.cancelled ? 'cancelled' : 'failed',
      completedAt: Date.now(),
      items: batch.items.map((item) => item.status === 'running' || item.status === 'pending'
        ? { ...item, status: control.cancelled ? 'cancelled' : 'failed', error: String(error), completedAt: Date.now() }
        : item),
    })
  } finally {
    active.delete(batch.id)
  }
}

export function startAgentEvaluationBatch(suite: AgentEvaluationSuite): AgentEvaluationBatch {
  const scenarios = sqliteIndex.listAgentEvaluationScenarios(suite.id)
  if (scenarios.length === 0) throw new Error('Add at least one fixed task before running regression')
  if (!suite.versionId) throw new Error('Evaluation suite has no immutable Agent version')
  const latest = sqliteIndex.getLatestAgentEvaluationBatch(suite.id)
  if (latest && (latest.status === 'queued' || latest.status === 'running') && active.has(latest.id)) {
    throw new Error('This evaluation suite already has a regression running')
  }
  const now = Date.now()
  const batch = save({
    id: randomUUID(),
    suiteId: suite.id,
    workspacePath: suite.workspacePath,
    profileId: suite.profileId,
    versionId: suite.versionId,
    status: 'queued',
    items: scenarios.map((scenario) => ({
      scenarioId: scenario.id,
      scenarioName: scenario.name,
      status: 'pending',
    })),
    createdAt: now,
  })
  active.set(batch.id, { cancelled: false })
  void executeBatch(batch, suite)
  auditRepository.write({
    category: 'operation',
    action: 'agent-evaluation.batch.start',
    outcome: 'success',
    workspaceId: batch.workspacePath,
    details: { batchId: batch.id, suiteId: suite.id, taskCount: batch.items.length },
  })
  return batch
}

export function getAgentEvaluationBatch(batchId: string): AgentEvaluationBatch {
  const batch = sqliteIndex.getAgentEvaluationBatch(batchId)
  if (!batch) throw new Error('Agent evaluation batch not found')
  // A process restart cannot resume a Pi turn safely. Expose this honestly instead of showing endless progress.
  if ((batch.status === 'queued' || batch.status === 'running') && !active.has(batch.id)) {
    const now = Date.now()
    return save({
      ...batch,
      status: 'failed',
      completedAt: now,
      items: batch.items.map((item) => item.status === 'pending' || item.status === 'running'
        ? { ...item, status: 'failed', error: 'Vizruna restarted before this task completed', completedAt: now }
        : item),
    })
  }
  return batch
}

export function getLatestAgentEvaluationBatch(suiteId: string): AgentEvaluationBatch | null {
  const batch = sqliteIndex.getLatestAgentEvaluationBatch(suiteId)
  return batch ? getAgentEvaluationBatch(batch.id) : null
}

export async function cancelAgentEvaluationBatch(batchId: string): Promise<AgentEvaluationBatch> {
  const batch = getAgentEvaluationBatch(batchId)
  const control = active.get(batch.id)
  if (!control || (batch.status !== 'queued' && batch.status !== 'running')) return batch
  control.cancelled = true
  if (control.currentSessionFile) {
    await workerManager.abortBackgroundSession(control.currentSessionFile).catch(() => {})
  }
  return sqliteIndex.getAgentEvaluationBatch(batch.id) ?? batch
}
