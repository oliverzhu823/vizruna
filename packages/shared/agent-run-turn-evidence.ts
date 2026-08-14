import type { AppEvent } from './app-events'
import type { AgentRunTurnEvidence } from './agent-run-history'

const emptyUsage = () => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 })

export function mergeAgentRunTurnEvidence(
  previous: AgentRunTurnEvidence | undefined,
  event: AppEvent,
): AgentRunTurnEvidence | undefined {
  const runId = 'runId' in event ? event.runId : undefined
  const turnId = 'turnId' in event ? event.turnId : undefined
  if (!runId) return previous
  if (event.type === 'run' && event.phase === 'started') {
    return {
      runId,
      turnId,
      status: 'running',
      startedAt: event.timestamp,
      contextBefore: event.contextSnapshot,
      resourceEvidence: event.resourceEvidence,
      usage: emptyUsage(),
      tools: [],
      compactions: { count: 0, tokensSaved: 0 },
      files: [],
      errors: [],
    }
  }
  if (!previous) return undefined
  const next: AgentRunTurnEvidence = {
    ...previous,
    turnId: turnId || previous.turnId,
    usage: { ...previous.usage },
    tools: previous.tools.map((tool) => ({ ...tool })),
    compactions: { ...previous.compactions },
    files: [...previous.files],
    errors: [...previous.errors],
  }
  if (event.type === 'run') {
    if (event.usage) {
      next.usage.input += event.usage.input
      next.usage.output += event.usage.output
      next.usage.cacheRead += event.usage.cacheRead
      next.usage.cacheWrite += event.usage.cacheWrite
      next.usage.cost += event.usage.cost
    }
    if (event.phase === 'failed') next.status = 'failed'
    if (event.phase === 'cancelled') next.status = 'cancelled'
    if (event.phase === 'idle') {
      if (next.status === 'running') next.status = 'completed'
      next.contextAfter = event.contextSnapshot
      next.endedAt = event.timestamp
    }
  } else if (event.type === 'tool' && event.phase === 'end') {
    const tool = next.tools.find((item) => item.name === event.toolName)
    if (tool) {
      tool.calls += 1
      if (event.isError) tool.failed += 1
    } else next.tools.push({ name: event.toolName, calls: 1, failed: event.isError ? 1 : 0 })
  } else if (event.type === 'compaction' && event.phase === 'end') {
    next.compactions.count += 1
    next.compactions.tokensSaved += event.tokensSaved || 0
  } else if (event.type === 'file') {
    if (!next.files.includes(event.path)) next.files.push(event.path)
  } else if (event.type === 'agent_error') {
    if (event.text && !next.errors.includes(event.text)) next.errors.push(event.text)
  }
  return next
}
