import { describe, expect, it } from 'vitest'
import { mergeAgentRunRuntimeEvidence } from './agent-run-runtime-evidence'

const resourceEvidence = { capturedAt: 10, activeTools: [{ name: 'read' }], skills: [], promptTemplates: [], extensions: [], contextFiles: [], systemPromptSources: [] }
const before = { tokens: 100, contextWindow: 1000, percent: 10, messageCount: 2, capturedAt: 10 }
const after = { tokens: 180, contextWindow: 1000, percent: 18, messageCount: 4, capturedAt: 20 }

describe('Agent run runtime evidence merge', () => {
  it('captures immutable run-start resources and before-context', () => {
    expect(mergeAgentRunRuntimeEvidence(undefined, { type: 'run', phase: 'started', seq: 1, workspaceId: '/w', sessionId: 's', runId: 'r', timestamp: 10, resourceEvidence, contextSnapshot: before })).toEqual({ runId: 'r', resourceEvidence, contextBefore: before, contextAfter: undefined, capturedAt: 10 })
  })

  it('clears the previous completion snapshot when a new run starts', () => {
    const previous = { runId: 'old', resourceEvidence, contextBefore: before, contextAfter: after, capturedAt: 5 }
    expect(mergeAgentRunRuntimeEvidence(previous, { type: 'run', phase: 'started', seq: 3, workspaceId: '/w', runId: 'new', timestamp: 30, resourceEvidence, contextSnapshot: before })?.contextAfter).toBeUndefined()
  })

  it('adds completion context without discarding start evidence', () => {
    const previous = { runId: 'r', resourceEvidence, contextBefore: before, capturedAt: 10 }
    expect(mergeAgentRunRuntimeEvidence(previous, { type: 'run', phase: 'idle', seq: 2, workspaceId: '/w', sessionId: 's', runId: 'r', timestamp: 20, contextSnapshot: after })).toEqual({ ...previous, contextAfter: after, capturedAt: 20 })
  })

  it('ignores intermediate usage events', () => {
    const previous = { runId: 'r', resourceEvidence, contextBefore: before, capturedAt: 10 }
    expect(mergeAgentRunRuntimeEvidence(previous, { type: 'run', phase: 'running', seq: 2, workspaceId: '/w', timestamp: 15 })).toBe(previous)
  })
})
