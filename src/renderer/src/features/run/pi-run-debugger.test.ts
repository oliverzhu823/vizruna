import { describe, expect, it } from 'vitest'
import type { AgentProfileSnapshot } from '@shared/agent-profile'
import { buildPiRunDebuggerSnapshot } from './pi-run-debugger'

describe('Pi Run Debugger projection', () => {
  it('isolates the latest run and explains tool origin, duration, compaction, and failure layer', () => {
    const snapshot: AgentProfileSnapshot = {
      profileId: 'profile-1',
      name: 'Research Agent',
      systemPrompt: 'Research.',
      promptMode: 'append',
      capturedAt: 100,
    }
    const result = buildPiRunDebuggerSnapshot({
      binding: {
        kind: 'agent',
        sessionId: 'session-1',
        sessionFile: '/session.jsonl',
        snapshot,
        createdAt: 100,
      },
      runState: {
        status: 'failed',
        lastRunId: 'run-2',
        toolCount: 2,
        errorCount: 1,
        contextBefore: {
          tokens: 1_000,
          contextWindow: 128_000,
          percent: 0.78,
          messageCount: 4,
          capturedAt: 10,
        },
        contextAfter: {
          tokens: 1_600,
          contextWindow: 128_000,
          percent: 1.25,
          messageCount: 7,
          capturedAt: 20,
        },
      },
      timelineItems: [
        { id: 'u1', type: 'user-message', text: 'old', timestamp: 1 },
        { id: 't1', type: 'tool-call', toolName: 'read', runId: 'run-1', timestamp: 2 },
        { id: 'u2', type: 'user-message', text: 'new', timestamp: 10 },
        {
          id: 't2',
          type: 'tool-call',
          toolName: 'web_search',
          toolPhase: 'end',
          runId: 'run-2',
          timestamp: 20,
          toolEndedAt: 1_020,
        },
        { id: 'c2', type: 'compaction', text: 'saved context', timestamp: 1_100 },
        {
          id: 't3',
          type: 'tool-call',
          toolName: 'bash',
          toolPhase: 'end',
          toolOutput: 'exit 1',
          isError: true,
          runId: 'run-2',
          timestamp: 1_200,
          toolEndedAt: 1_400,
        },
      ],
    })

    expect(result).toMatchObject({
      runId: 'run-2',
      config: { kind: 'agent', name: 'Research Agent', capturedAt: 100 },
      toolCount: 2,
      failureCount: 1,
      compactionCount: 1,
      primaryFailure: { label: 'bash', failureLayer: 'tool' },
      context: { deltaTokens: 600, deltaMessages: 3 },
    })
    expect(result.entries[0]).toMatchObject({
      label: 'web_search',
      origin: 'extension',
      durationMs: 1_000,
    })
  })

  it('classifies provider failures even when no tool ran', () => {
    const result = buildPiRunDebuggerSnapshot({
      binding: null,
      runState: { status: 'failed', toolCount: 0, errorCount: 1 },
      timelineItems: [
        { id: 'u1', type: 'user-message', timestamp: 1 },
        {
          id: 'e1',
          type: 'error',
          text: 'Model usage limit reached',
          timestamp: 2,
        },
      ],
    })

    expect(result.config).toEqual({ kind: 'general', name: 'General Pi' })
    expect(result.primaryFailure?.failureLayer).toBe('provider')
  })
})
