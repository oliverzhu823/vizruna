import { describe, expect, it } from 'vitest'
import type { AgentRunHistoryItem } from './agent-run-history'
import { buildAgentRunDiagnosis } from './agent-run-diagnosis'

const base: AgentRunHistoryItem = { sessionId: 's', sessionFile: '/s', workspacePath: '/w', title: 'Run', profileId: 'p', status: 'completed', messageCount: 3, createdAt: 1, updatedAt: 2, artifacts: [], capabilitySnapshot: { tools: ['read', 'write'], extensionTools: [] }, runtimeEvidence: { capturedAt: 2, resourceEvidence: { capturedAt: 2, activeTools: [{ name: 'read' }], skills: [], promptTemplates: [], extensions: [], contextFiles: [], systemPromptSources: [] } }, observability: { completeTimeline: true, analyzedItems: 3, usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0 }, tools: { totalCalls: 1, failedCalls: 1, invoked: [{ name: 'read', calls: 1, failed: 1 }], loadedNotInvoked: [] }, compactions: 0, context: { beforeTokens: 700, afterTokens: 950, deltaTokens: 250, percent: 95, contextWindow: 1000 }, health: 'critical', signals: ['context-critical', 'context-grew', 'tool-failures'] } }

describe('Agent run diagnosis', () => {
  it('prioritizes concrete blockers and routes to the matching repair surface', () => {
    const result = buildAgentRunDiagnosis(base)
    expect(result.status).toBe('blocked')
    expect(result.issues.map((issue) => issue.code)).toEqual(['capability-missing', 'context-critical', 'tool-failures'])
    expect(result.primaryAction).toBe('manage-resources')
  })

  it('does not invent a diagnosis when old runs lack evidence', () => {
    const result = buildAgentRunDiagnosis({ ...base, capabilitySnapshot: undefined, runtimeEvidence: undefined, observability: undefined })
    expect(result).toMatchObject({ status: 'unknown', primaryAction: 'rerun', issues: [{ code: 'legacy-evidence' }] })
  })

  it('keeps the actual run failure as the first action', () => {
    const result = buildAgentRunDiagnosis({ ...base, status: 'failed', failureReason: 'quota' })
    expect(result.issues[0]).toMatchObject({ code: 'run-failed', action: 'open-run' })
  })
})
