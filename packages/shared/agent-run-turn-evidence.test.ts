import { describe, expect, it } from 'vitest'
import type { AppEvent } from './app-events'
import { mergeAgentRunTurnEvidence } from './agent-run-turn-evidence'

const base = { seq: 1, workspaceId: '/w', sessionId: 's', sessionFile: '/s.jsonl', runId: 'r1', turnId: 't1', timestamp: 10 }
const apply = (previous: ReturnType<typeof mergeAgentRunTurnEvidence>, event: Partial<AppEvent> & Pick<AppEvent, 'type'>) => mergeAgentRunTurnEvidence(previous, { ...base, ...event } as AppEvent)

describe('per-run Pi evidence', () => {
  it('keeps one immutable run boundary and aggregates runtime facts', () => {
    let evidence = apply(undefined, { type: 'run', phase: 'started', contextSnapshot: { tokens: 100, contextWindow: 1000, percent: 10, messageCount: 1, capturedAt: 10 } })
    evidence = apply(evidence, { type: 'run', phase: 'running', usage: { input: 80, output: 20, cacheRead: 10, cacheWrite: 0, cost: 0.01 } })
    evidence = apply(evidence, { type: 'tool', phase: 'end', toolCallId: 'a', toolName: 'read', isError: false })
    evidence = apply(evidence, { type: 'tool', phase: 'end', toolCallId: 'b', toolName: 'read', isError: true })
    evidence = apply(evidence, { type: 'compaction', phase: 'end', tokensSaved: 200 })
    evidence = apply(evidence, { type: 'file', source: 'write', path: '/w/report.md', changeType: 'added' })
    evidence = apply(evidence, { type: 'run', phase: 'idle', timestamp: 30, contextSnapshot: { tokens: 300, contextWindow: 1000, percent: 30, messageCount: 3, capturedAt: 30 } })
    expect(evidence).toMatchObject({ status: 'completed', startedAt: 10, endedAt: 30, usage: { input: 80, output: 20, cost: 0.01 }, tools: [{ name: 'read', calls: 2, failed: 1 }], compactions: { count: 1, tokensSaved: 200 }, files: ['/w/report.md'], contextAfter: { tokens: 300 } })
  })

  it('does not let idle erase a failed outcome', () => {
    let evidence = apply(undefined, { type: 'run', phase: 'started' })
    evidence = apply(evidence, { type: 'run', phase: 'failed' })
    evidence = apply(evidence, { type: 'run', phase: 'idle' })
    expect(evidence?.status).toBe('failed')
  })
})
