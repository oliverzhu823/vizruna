import type { ConversationConfigBinding } from '@shared/system-prompt-preset'
import type { RunContextSnapshot, RunResourceEvidence } from '@shared/app-events'
import type { RunState, TimelineItem } from '@renderer/stores/ui-store-types'

const PI_BASE_TOOLS = new Set(['read', 'bash', 'edit', 'write', 'grep', 'find', 'ls'])

export type PiRunFailureLayer =
  | 'authentication'
  | 'provider'
  | 'context'
  | 'extension'
  | 'tool'
  | 'runtime'

export type PiRunDebuggerEntry = {
  id: string
  kind: 'tool' | 'compaction' | 'error'
  label: string
  status: 'running' | 'success' | 'failed' | 'info'
  origin?: 'pi-base' | 'extension'
  timestamp: number
  durationMs?: number
  summary?: string
  failureLayer?: PiRunFailureLayer
}

export type PiRunDebuggerSnapshot = {
  runId?: string
  config: {
    kind: 'general' | 'agent' | 'prompt'
    name: string
    capturedAt?: number
  }
  entries: PiRunDebuggerEntry[]
  toolCount: number
  failureCount: number
  compactionCount: number
  primaryFailure?: PiRunDebuggerEntry
  context: {
    before?: RunContextSnapshot
    after?: RunContextSnapshot
    deltaTokens?: number
    deltaMessages?: number
  }
  resources?: RunResourceEvidence
}

function failureLayer(text: string, toolName?: string): PiRunFailureLayer {
  const value = text.toLowerCase()
  if (/auth|oauth|api[ _-]?key|401|403|credential|login/.test(value)) return 'authentication'
  if (/context|token limit|too many tokens|maximum.*token/.test(value)) return 'context'
  if (/provider|model|rate limit|usage limit|429|quota/.test(value)) return 'provider'
  if (toolName && !PI_BASE_TOOLS.has(toolName.toLowerCase())) return 'extension'
  if (toolName) return 'tool'
  return 'runtime'
}

function oneLine(value: string | undefined, limit = 180): string | undefined {
  const text = value?.replace(/\s+/g, ' ').trim()
  if (!text) return undefined
  return text.length > limit ? `${text.slice(0, limit)}…` : text
}

function currentRunSlice(items: TimelineItem[], runId?: string): TimelineItem[] {
  if (items.length === 0) return []
  let anchor = runId
    ? items.findIndex((item) => item.runId === runId)
    : -1
  if (anchor < 0) {
    for (let index = items.length - 1; index >= 0; index--) {
      if (items[index].type === 'user-message') {
        anchor = index
        break
      }
    }
  }
  if (anchor < 0) return []
  let start = anchor
  while (start > 0 && items[start].type !== 'user-message') start -= 1
  if (items[start].type !== 'user-message') start = anchor
  let end = items.length
  for (let index = start + 1; index < items.length; index++) {
    if (items[index].type === 'user-message') {
      end = index
      break
    }
  }
  return items.slice(start, end)
}

function bindingConfig(binding: ConversationConfigBinding | null): PiRunDebuggerSnapshot['config'] {
  if (!binding) return { kind: 'general', name: 'General Pi' }
  return {
    kind: binding.kind,
    name: binding.snapshot.name,
    capturedAt: binding.snapshot.capturedAt,
  }
}

export function buildPiRunDebuggerSnapshot(input: {
  timelineItems: TimelineItem[]
  runState: RunState
  binding: ConversationConfigBinding | null
}): PiRunDebuggerSnapshot {
  const runId = input.runState.activeRunId || input.runState.lastRunId
  const slice = currentRunSlice(input.timelineItems, runId)
  const entries: PiRunDebuggerEntry[] = []
  for (const item of slice) {
    if (item.type === 'tool-call') {
      const failed = item.isError === true
      const status = failed
        ? 'failed'
        : item.toolPhase === 'start' || item.toolPhase === 'update'
          ? 'running'
          : 'success'
      entries.push({
        id: item.id,
        kind: 'tool',
        label: item.toolName || 'tool',
        status,
        origin: PI_BASE_TOOLS.has((item.toolName || '').toLowerCase())
          ? 'pi-base'
          : 'extension',
        timestamp: item.timestamp,
        durationMs:
          item.toolEndedAt && item.toolEndedAt >= item.timestamp
            ? item.toolEndedAt - item.timestamp
            : undefined,
        summary: oneLine(failed ? item.toolOutput : item.toolStatusLine || item.toolOutput, 140),
        failureLayer: failed ? failureLayer(item.toolOutput || '', item.toolName) : undefined,
      })
    } else if (item.type === 'compaction') {
      entries.push({
        id: item.id,
        kind: 'compaction',
        label: 'context compaction',
        status: 'info',
        timestamp: item.timestamp,
        summary: oneLine(item.text, 140),
      })
    } else if (item.type === 'error') {
      entries.push({
        id: item.id,
        kind: 'error',
        label: item.errorKind === 'aborted' ? 'aborted' : 'run error',
        status: item.errorKind === 'aborted' ? 'info' : 'failed',
        timestamp: item.timestamp,
        summary: oneLine(item.text),
        failureLayer:
          item.errorKind === 'aborted' ? undefined : failureLayer(item.text || ''),
      })
    }
  }
  const failures = entries.filter((entry) => entry.status === 'failed')
  const before = input.runState.contextBefore
  const after = input.runState.contextAfter
  return {
    runId,
    config: bindingConfig(input.binding),
    entries,
    toolCount: entries.filter((entry) => entry.kind === 'tool').length,
    failureCount: failures.length,
    compactionCount: entries.filter((entry) => entry.kind === 'compaction').length,
    primaryFailure: failures[0],
    context: {
      before,
      after,
      deltaTokens:
        before?.tokens != null && after?.tokens != null
          ? after.tokens - before.tokens
          : undefined,
      deltaMessages:
        before && after ? after.messageCount - before.messageCount : undefined,
    },
    resources: input.runState.resourceEvidence,
  }
}
