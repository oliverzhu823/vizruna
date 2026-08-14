import type { AgentRunHistoryItem, AgentRunObservability, AgentRunSignalCode } from './agent-run-history'

type TimelineRecord = Record<string, unknown>
type Usage = { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: number | { total?: number } }

const finite = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0

function cost(value: Usage['cost']): number {
  return finite(typeof value === 'object' && value ? value.total : value)
}

export function buildAgentRunObservability(input: {
  items: TimelineRecord[]
  totalCount: number
  runtimeEvidence?: AgentRunHistoryItem['runtimeEvidence']
}): AgentRunObservability {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let cacheWriteTokens = 0
  let totalCost = 0
  let compactions = 0
  const tools = new Map<string, { calls: number; failed: number }>()
  for (const item of input.items) {
    if (item.type === 'compaction') compactions += 1
    if (item.type === 'tool-call') {
      const name = String(item.toolName || 'tool')
      const current = tools.get(name) || { calls: 0, failed: 0 }
      current.calls += 1
      if (item.isError === true) current.failed += 1
      tools.set(name, current)
    }
    if (item.type !== 'assistant-message') continue
    const usage = item.usage as Usage | undefined
    if (!usage) continue
    inputTokens += finite(usage.input)
    outputTokens += finite(usage.output)
    cacheReadTokens += finite(usage.cacheRead)
    cacheWriteTokens += finite(usage.cacheWrite)
    totalCost += cost(usage.cost)
  }
  const invoked = [...tools.entries()].map(([name, value]) => ({ name, ...value })).sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name))
  const invokedNames = new Set(invoked.map((item) => item.name))
  const loadedNotInvoked = (input.runtimeEvidence?.resourceEvidence?.activeTools || []).map((item) => item.name).filter((name) => !invokedNames.has(name)).sort()
  const before = input.runtimeEvidence?.contextBefore
  const after = input.runtimeEvidence?.contextAfter
  const context = before || after ? {
    beforeTokens: before?.tokens ?? null,
    afterTokens: after?.tokens ?? null,
    deltaTokens: before?.tokens != null && after?.tokens != null ? after.tokens - before.tokens : null,
    percent: after?.percent ?? before?.percent ?? null,
    contextWindow: after?.contextWindow ?? before?.contextWindow ?? 0,
  } : null
  const failedCalls = invoked.reduce((sum, item) => sum + item.failed, 0)
  const signals: AgentRunSignalCode[] = []
  if (context?.percent != null && context.percent >= 90) signals.push('context-critical')
  else if (context?.percent != null && context.percent >= 75) signals.push('context-high')
  if (context?.deltaTokens != null && context.contextWindow > 0 && context.deltaTokens / context.contextWindow >= 0.15) signals.push('context-grew')
  if (compactions > 0) signals.push('compacted')
  if (failedCalls > 0) signals.push('tool-failures')
  const hasEvidence = input.items.length > 0 || !!context
  const health = !hasEvidence ? 'no-evidence' : signals.includes('context-critical') ? 'critical' : signals.some((item) => item !== 'context-grew') ? 'warning' : 'healthy'
  return {
    completeTimeline: input.items.length >= input.totalCount,
    analyzedItems: input.items.length,
    usage: { inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, cost: totalCost },
    tools: { totalCalls: invoked.reduce((sum, item) => sum + item.calls, 0), failedCalls, invoked, loadedNotInvoked },
    compactions,
    context,
    health,
    signals,
  }
}
