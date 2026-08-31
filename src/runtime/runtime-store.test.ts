import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { RuntimeStore } from './runtime-store'

const temporary: string[] = []
afterEach(() => temporary.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true })))

describe('RuntimeStore', () => {
  it('persists runs and resumable monotonic events', () => {
    const root = mkdtempSync(join(tmpdir(), 'vizruna-runtime-store-'))
    temporary.push(root)
    const store = new RuntimeStore(root)
    store.saveRun({
      id: 'run-1', workspacePath: '/tmp', prompt: 'test', piRuntimeVersion: '0.84.4',
      status: 'queued', permission: { mode: 'observe', requestedTools: [], allowedTools: [], deniedTools: [], approvedTools: [] },
      createdAt: 1, updatedAt: 1,
      metrics: { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, cost: 0, toolCalls: 0, failedToolCalls: 0 },
      tools: [], artifacts: [],
    })
    store.appendEvent({ id: 1, timestamp: 1, type: 'run.queued', runId: 'run-1', data: {} })
    store.appendEvent({ id: 2, timestamp: 2, type: 'run.running', runId: 'run-1', data: {} })
    expect(store.getRun('run-1')?.status).toBe('queued')
    expect(store.listEvents({ after: 1 }).map((event) => event.id)).toEqual([2])
    expect(store.nextEventId()).toBe(3)
  })
})
