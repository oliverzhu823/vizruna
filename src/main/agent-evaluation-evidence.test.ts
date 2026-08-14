import { describe, expect, it } from 'vitest'
import type { AgentCase } from '@shared/agent-case'
import type { AgentEvaluationScenario } from '@shared/agent-evaluation'
import type { AgentProfileSnapshot } from '@shared/agent-profile'
import { buildAgentEvaluationEvidence } from './agent-evaluation-evidence'

const agentCase: AgentCase = {
  id: 'case-1',
  name: 'Report case',
  tags: [],
  status: 'validated',
  workspacePath: '/workspace',
  sourceSessionId: 'session-1',
  sourceSessionFile: '/sessions/session-1.jsonl',
  modelId: 'fallback/model',
  provenance: { capturedAt: 1, piRuntimeVersion: '0.84.1', packages: [] },
  createdAt: 1,
  updatedAt: 1,
}

const scenario: AgentEvaluationScenario = {
  id: 'scenario-1',
  suiteId: 'suite-1',
  name: 'Write report',
  prompt: 'Write a report',
  tags: [],
  sortOrder: 0,
  createdAt: 1,
  updatedAt: 1,
}

const snapshot: AgentProfileSnapshot = {
  profileId: 'profile-1',
  name: 'Report Agent',
  systemPrompt: 'Be precise',
  promptMode: 'append',
  capturedAt: 10,
}

describe('agent evaluation evidence', () => {
  it('captures only the last Pi turn and excludes thinking text', () => {
    const result = buildAgentEvaluationEvidence({
      agentCase,
      scenario,
      snapshot,
      capturedAt: 20,
      sessionMeta: { model: 'openai/gpt-5', thinkingLevel: 'high' },
      items: [
        { type: 'user-message', text: 'Old task', timestamp: 1 },
        { type: 'assistant-message', text: 'Old answer', timestamp: 2 },
        { type: 'user-message', text: '  Write a report  ', timestamp: 100 },
        {
          type: 'assistant-message',
          text: 'Final report',
          thinkingText: 'private chain of thought',
          timestamp: 150,
          usage: { input: 120, output: 30, cacheRead: 10, cost: { total: 0.02 } },
        },
        { type: 'tool-call', toolName: 'write', isError: true, timestamp: 175 },
      ],
    })
    expect(result).toMatchObject({
      actualPrompt: 'Write a report',
      promptMatched: true,
      outputText: 'Final report',
      modelId: 'openai/gpt-5',
      thinkingLevel: 'high',
      piRuntimeVersion: '0.84.1',
      metrics: {
        durationMs: 75,
        inputTokens: 120,
        outputTokens: 30,
        cacheReadTokens: 10,
        toolCalls: 1,
        failedToolCalls: 1,
        assistantMessages: 1,
      },
      agent: { profileId: 'profile-1', name: 'Report Agent', snapshotCapturedAt: 10 },
    })
    expect(result.outputText).not.toContain('private chain')
    expect(result.agent?.snapshotDigest).toMatch(/^[0-9a-f]{64}$/)
  })

  it('marks a different real prompt instead of silently treating it as the scenario', () => {
    const result = buildAgentEvaluationEvidence({
      agentCase,
      scenario,
      items: [
        { type: 'user-message', text: 'Write a short memo', timestamp: 1 },
        { type: 'assistant-message', text: '', timestamp: 1 },
      ],
    })
    expect(result.promptMatched).toBe(false)
    expect(result.metrics.durationMs).toBe(0)
  })

  it('rejects a session without a user task', () => {
    expect(() => buildAgentEvaluationEvidence({
      agentCase,
      scenario,
      items: [{ type: 'assistant-message', text: 'orphan', timestamp: 1 }],
    })).toThrow('no user turn')
  })
})
