import { describe, expect, it } from 'vitest'
import type { AgentRunHistoryItem } from './agent-run-history'
import { buildAgentRunComparison } from './agent-run-comparison'

function run(overrides: Partial<AgentRunHistoryItem> = {}): AgentRunHistoryItem {
  return { sessionId: 's', sessionFile: '/s', workspacePath: '/w', title: 'Run', profileId: 'p', versionId: 'v1', modelId: 'm1', thinkingLevel: 'high', status: 'completed', messageCount: 4, createdAt: 1, updatedAt: 2, artifacts: [], runtimeEvidence: { capturedAt: 2, resourceEvidence: { capturedAt: 1, activeTools: [{ name: 'read' }], skills: [], promptTemplates: [], extensions: [], contextFiles: [], systemPromptSources: [] } }, observability: { completeTimeline: true, analyzedItems: 4, usage: { inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0.01 }, tools: { totalCalls: 1, failedCalls: 0, invoked: [{ name: 'read', calls: 1, failed: 0 }], loadedNotInvoked: [] }, compactions: 0, context: { beforeTokens: 100, afterTokens: 200, deltaTokens: 100, percent: 20, contextWindow: 1000 }, health: 'healthy', signals: [] }, ...overrides }
}

describe('Agent run comparison', () => {
  it('reports deterministic configuration, capability and risk differences', () => {
    const baseline = run()
    const current = run({ versionId: 'v2', modelId: 'm2', runtimeEvidence: { capturedAt: 3, resourceEvidence: { capturedAt: 3, activeTools: [{ name: 'read' }, { name: 'bash' }], skills: [], promptTemplates: [], extensions: [], contextFiles: [], systemPromptSources: [] } }, observability: { ...baseline.observability!, usage: { ...baseline.observability!.usage, inputTokens: 150, cost: 0.02 }, tools: { totalCalls: 2, failedCalls: 1, invoked: [], loadedNotInvoked: [] }, context: { beforeTokens: 100, afterTokens: 400, deltaTokens: 300, percent: 40, contextWindow: 1000 } } })
    const result = buildAgentRunComparison(current, baseline)
    expect(result.status).toBe('attention')
    expect(result.capabilities.added).toEqual(['tool:bash'])
    expect(result.signals).toEqual(expect.arrayContaining(['version-changed', 'model-changed', 'capabilities-changed', 'context-pressure-up', 'tool-failures-up', 'cost-up', 'tokens-up']))
  })

  it('marks missing or sampled runtime facts as incomplete instead of guessing', () => {
    const result = buildAgentRunComparison(run({ runtimeEvidence: undefined, observability: undefined }), run())
    expect(result.capabilities.comparable).toBe(false)
    expect(result.signals).toContain('incomplete-evidence')
  })
})
