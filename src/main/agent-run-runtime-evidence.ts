import type { RunEvent } from '@shared/app-events'
import type { AgentRunHistoryItem } from '@shared/agent-run-history'

export function mergeAgentRunRuntimeEvidence(
  previous: AgentRunHistoryItem['runtimeEvidence'],
  event: RunEvent,
): AgentRunHistoryItem['runtimeEvidence'] | undefined {
  if (event.phase !== 'started' && event.phase !== 'idle') return previous
  return {
    runId: event.runId || previous?.runId,
    resourceEvidence: event.resourceEvidence || previous?.resourceEvidence,
    contextBefore: event.phase === 'started' ? event.contextSnapshot : previous?.contextBefore,
    contextAfter: event.phase === 'idle' ? event.contextSnapshot : undefined,
    capturedAt: event.timestamp || Date.now(),
  }
}
