import { describe, expect, it } from 'vitest'
import { buildAgentRunObservability } from './agent-run-observability'

describe('Agent run observability', () => {
  it('aggregates Pi usage, tool activity and context pressure', () => {
    const result = buildAgentRunObservability({
      items: [
        { type: 'assistant-message', usage: { input: 100, output: 20, cacheRead: 40, cacheWrite: 5, cost: { total: 0.02 } } },
        { type: 'tool-call', toolName: 'read' },
        { type: 'tool-call', toolName: 'bash', isError: true },
        { type: 'compaction' },
      ],
      totalCount: 4,
      runtimeEvidence: {
        capturedAt: 2,
        contextBefore: { tokens: 700, contextWindow: 1000, percent: 70, messageCount: 2, capturedAt: 1 },
        contextAfter: { tokens: 920, contextWindow: 1000, percent: 92, messageCount: 5, capturedAt: 2 },
        resourceEvidence: { capturedAt: 1, activeTools: [{ name: 'read' }, { name: 'bash' }, { name: 'write' }], skills: [], promptTemplates: [], extensions: [], contextFiles: [], systemPromptSources: [] },
      },
    })
    expect(result).toMatchObject({
      completeTimeline: true,
      usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 40, cost: 0.02 },
      tools: { totalCalls: 2, failedCalls: 1, loadedNotInvoked: ['write'] },
      compactions: 1,
      context: { deltaTokens: 220, percent: 92 },
      health: 'critical',
    })
    expect(result.signals).toEqual(['context-critical', 'context-grew', 'compacted', 'tool-failures'])
  })

  it('does not invent evidence for an empty legacy session', () => {
    expect(buildAgentRunObservability({ items: [], totalCount: 0 }).health).toBe('no-evidence')
  })
})
