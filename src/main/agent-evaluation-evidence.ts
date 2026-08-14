import { createHash } from 'node:crypto'
import type { AgentCase } from '@shared/agent-case'
import type {
  AgentEvaluationEvidence,
  AgentEvaluationMetrics,
  AgentEvaluationScenario,
} from '@shared/agent-evaluation'
import { normalizeEvaluationPrompt } from '@shared/agent-evaluation-metrics'
import type { AgentProfileSnapshot } from '@shared/agent-profile'
import { readPiInfo } from './pi-info'
import { sqliteIndex } from './sqlite-index'

type TimelineRecord = Record<string, unknown>
type TimelineUsage = {
  input?: number
  output?: number
  cacheRead?: number
  cacheWrite?: number
  cost?: { total?: number }
}

function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

function snapshotDigest(snapshot: AgentProfileSnapshot): string {
  return snapshot.versionDigest || createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function timelineTimestamp(item: TimelineRecord): number | null {
  const timestamp = typeof item.timestamp === 'number' && Number.isFinite(item.timestamp)
    ? item.timestamp
    : null
  const toolEndedAt = typeof item.toolEndedAt === 'number' && Number.isFinite(item.toolEndedAt)
    ? item.toolEndedAt
    : null
  if (timestamp == null) return toolEndedAt
  if (toolEndedAt == null) return timestamp
  return Math.max(timestamp, toolEndedAt)
}

function lastTurn(items: TimelineRecord[]): TimelineRecord[] {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index]?.type === 'user-message') return items.slice(index)
  }
  return []
}

function aggregateMetrics(turn: TimelineRecord[]): AgentEvaluationMetrics {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let cost = 0
  let toolCalls = 0
  let failedToolCalls = 0
  let assistantMessages = 0
  let startedAt: number | null = null
  let endedAt: number | null = null
  for (const item of turn) {
    const timestamp = timelineTimestamp(item)
    if (timestamp != null) {
      startedAt ??= timestamp
      endedAt = timestamp
    }
    if (item.type === 'tool-call') {
      toolCalls += 1
      if (item.isError === true) failedToolCalls += 1
    }
    if (item.type !== 'assistant-message') continue
    assistantMessages += 1
    const usage = item.usage as TimelineUsage | undefined
    if (!usage) continue
    inputTokens += finite(usage.input)
    outputTokens += finite(usage.output)
    cacheReadTokens += finite(usage.cacheRead)
    cacheWriteTokens += finite(usage.cacheWrite)
    cost += finite(usage.cost?.total)
  }
  return {
    durationMs:
      startedAt != null && endedAt != null && endedAt >= startedAt
        ? endedAt - startedAt
        : null,
    inputTokens,
    outputTokens,
    cacheReadTokens,
    cacheWriteTokens,
    cost,
    toolCalls,
    failedToolCalls,
    assistantMessages,
  }
}

export function buildAgentEvaluationEvidence(input: {
  agentCase: AgentCase
  scenario: AgentEvaluationScenario
  items: TimelineRecord[]
  sessionMeta?: { model?: string; thinkingLevel?: string }
  snapshot?: AgentProfileSnapshot
  capturedAt?: number
}): AgentEvaluationEvidence {
  const turn = lastTurn(input.items)
  if (turn.length === 0) throw new Error('Source session has no user turn to evaluate')
  const actualPrompt = String(turn[0]?.text || '').trim()
  const outputText = turn
    .filter((item) => item.type === 'assistant-message')
    .map((item) => String(item.text || '').trim())
    .filter(Boolean)
    .join('\n\n')
    .slice(0, 200_000)
  const snapshot = input.snapshot
  return {
    capturedAt: input.capturedAt ?? Date.now(),
    piRuntimeVersion: input.agentCase.provenance?.piRuntimeVersion || readPiInfo().sdkVersion,
    sourceSessionId: input.agentCase.sourceSessionId,
    sourceSessionFile: input.agentCase.sourceSessionFile,
    actualPrompt,
    promptMatched:
      normalizeEvaluationPrompt(actualPrompt) === normalizeEvaluationPrompt(input.scenario.prompt),
    outputText,
    modelId: input.sessionMeta?.model || input.agentCase.modelId,
    thinkingLevel: input.sessionMeta?.thinkingLevel || input.agentCase.thinkingLevel,
    agent: snapshot
      ? {
          profileId: snapshot.profileId,
          name: snapshot.name,
          versionId: snapshot.versionId,
          versionNumber: snapshot.versionNumber,
          snapshotCapturedAt: snapshot.capturedAt,
          snapshotDigest: snapshotDigest(snapshot),
          snapshot,
        }
      : undefined,
    metrics: aggregateMetrics(turn),
  }
}

export async function captureAgentEvaluationEvidence(input: {
  agentCase: AgentCase
  scenario: AgentEvaluationScenario
  capturedAt?: number
}): Promise<AgentEvaluationEvidence> {
  const { getSessionMessagesFromDisk } = await import('./session-messages-from-disk')
  const timeline = await getSessionMessagesFromDisk(
    input.agentCase.sourceSessionFile,
    0,
    500,
  )
  const binding = sqliteIndex.getSessionAgentBinding({
    sessionFile: input.agentCase.sourceSessionFile,
  })
  return buildAgentEvaluationEvidence({
    agentCase: input.agentCase,
    scenario: input.scenario,
    items: timeline.items,
    sessionMeta: timeline.sessionMeta,
    snapshot: binding?.snapshot,
    capturedAt: input.capturedAt,
  })
}

/** Capture the same Pi JSONL evidence without creating a reusable Agent Case asset. */
export async function captureAgentEvaluationSessionEvidence(input: {
  scenario: AgentEvaluationScenario
  sourceSessionId: string
  sourceSessionFile: string
  snapshot: AgentProfileSnapshot
  capturedAt?: number
}): Promise<AgentEvaluationEvidence> {
  const { getSessionMessagesFromDisk } = await import('./session-messages-from-disk')
  const timeline = await getSessionMessagesFromDisk(input.sourceSessionFile, 0, 500)
  return buildAgentEvaluationEvidence({
    agentCase: {
      id: `evaluation-session:${input.sourceSessionId}`,
      name: input.scenario.name,
      tags: [],
      status: 'draft',
      workspacePath: '',
      sourceSessionId: input.sourceSessionId,
      sourceSessionFile: input.sourceSessionFile,
      provenance: {
        capturedAt: input.capturedAt ?? Date.now(),
        piRuntimeVersion: readPiInfo().sdkVersion,
        agent: {
          profileId: input.snapshot.profileId,
          name: input.snapshot.name,
          versionId: input.snapshot.versionId,
          versionNumber: input.snapshot.versionNumber,
          snapshotCapturedAt: input.snapshot.capturedAt,
          snapshotDigest: snapshotDigest(input.snapshot),
        },
        packages: [],
      },
      createdAt: input.capturedAt ?? Date.now(),
      updatedAt: input.capturedAt ?? Date.now(),
    },
    scenario: input.scenario,
    items: timeline.items,
    sessionMeta: timeline.sessionMeta,
    snapshot: input.snapshot,
    capturedAt: input.capturedAt,
  })
}

export const agentEvaluationEvidenceTestApi = {
  aggregateMetrics,
  lastTurn,
  snapshotDigest,
}
