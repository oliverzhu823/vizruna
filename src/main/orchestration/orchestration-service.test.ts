import { describe, expect, it, vi } from 'vitest'
import type { AppEvent } from '@shared/app-events'
import type { AgentRelationship } from '@shared/orchestration'
import { MemoryOrchestrationRepository } from './orchestration-repository'
import {
  OrchestrationService,
  type OrchestrationRuntime,
} from './orchestration-service'

class FakeRuntime implements OrchestrationRuntime {
  max = 4
  counter = 0
  failPrompt = false
  readonly active = new Set<string>()
  readonly stopped: string[] = []
  readonly aborted: string[] = []
  readonly messages: Array<{ sessionFile: string; text: string }> = []

  async createSession(cwd: string) {
    if (this.active.size >= this.max) return null
    const id = ++this.counter
    const sessionFile = `/sessions/child-${id}.jsonl`
    this.active.add(sessionFile)
    return {
      sessionId: `child-${id}`,
      sessionFile,
      workerKey: sessionFile,
      model: 'test/model',
      thinkingLevel: 'medium',
      cwd,
    }
  }

  async ensureSession(sessionFile: string, cwd: string) {
    if (this.active.size >= this.max && !this.active.has(sessionFile)) {
      return null
    }
    this.active.add(sessionFile)
    return {
      sessionId: sessionFile,
      sessionFile,
      workerKey: sessionFile,
      model: 'test/model',
      thinkingLevel: 'medium',
      cwd,
    }
  }

  async getState() {
    return { model: 'test/parent-model', thinkingLevel: 'high' }
  }

  async configure() {}

  async prompt(sessionFile: string, text: string) {
    if (this.failPrompt) {
      this.failPrompt = false
      this.active.delete(sessionFile)
      throw new Error('provider unavailable')
    }
    this.messages.push({ sessionFile, text })
  }

  async message(sessionFile: string, text: string) {
    this.messages.push({ sessionFile, text })
  }

  async abort(sessionFile: string) {
    this.aborted.push(sessionFile)
    this.active.delete(sessionFile)
  }

  async stop(sessionFile: string) {
    this.stopped.push(sessionFile)
    this.active.delete(sessionFile)
  }
}

function createHarness(options?: {
  repository?: MemoryOrchestrationRepository
  runtime?: FakeRuntime
  publish?: (relationship: AgentRelationship) => void
}) {
  const repository =
    options?.repository ?? new MemoryOrchestrationRepository()
  const runtime = options?.runtime ?? new FakeRuntime()
  let worktreeCounter = 0
  const published: AgentRelationship[] = []
  const service = new OrchestrationService({
    repository,
    runtime,
    worktrees: {
      async create(request) {
        const id = `00000000-0000-4000-8000-${String(++worktreeCounter).padStart(12, '0')}`
        return {
          id,
          rootWorkspacePath: request.rootWorkspacePath,
          worktreePath: `/managed/worktree-${worktreeCounter}`,
          branchName: `pi-agent/task-${worktreeCounter}`,
          baseRef: 'main',
          baseCommit: 'abc123',
          status: 'ready' as const,
          createdBySession: request.createdBySession,
          createdAt: Date.now(),
          updatedAt: Date.now(),
        }
      },
    },
    publish(event) {
      published.push(structuredClone(event.relationship))
      options?.publish?.(event.relationship)
    },
  })
  return { service, repository, runtime, published }
}

function request(
  goal: string,
  environment: 'worktree' | 'local' = 'worktree',
  timeoutMs = 30_000,
) {
  return {
    parentSessionFile: '/sessions/parent.jsonl',
    parentWorkerKey: '/sessions/parent.jsonl',
    rootWorkspacePath: '/repo',
    goal,
    environment,
    timeoutMs,
  }
}

function runtimeEvent(
  relationship: AgentRelationship,
  event: AppEvent,
) {
  return {
    type: 'app-event' as const,
    event,
    cwd: relationship.childWorkspacePath,
    poolKey: relationship.childWorkerKey!,
    sessionFile: relationship.childSessionFile!,
    agentTurnActive: event.type === 'run' && event.phase === 'running',
  }
}

describe('OrchestrationService', () => {
  it('starts isolated and local children with inherited runtime settings', async () => {
    const { service, runtime } = createHarness()
    const isolated = await service.createChild(request('Implement API'))
    const local = await service.createChild(request('Review docs', 'local'))

    expect(isolated.status).toBe('running')
    expect(isolated.childWorkspacePath).toBe('/managed/worktree-1')
    expect(isolated.worktreeId).toBeTruthy()
    expect(isolated.model).toBe('test/parent-model')
    expect(isolated.thinkingLevel).toBe('high')
    expect(local.status).toBe('running')
    expect(local.childWorkspacePath).toBe('/repo')
    expect(local.worktreeId).toBeUndefined()
    expect(runtime.messages).toHaveLength(2)
  })

  it('queues at capacity and starts the next child after an idle event', async () => {
    const runtime = new FakeRuntime()
    runtime.max = 1
    const { service } = createHarness({ runtime })
    const first = await service.createChild(request('First'))
    const second = await service.createChild(request('Second'))
    expect(second.status).toBe('queued')

    runtime.active.delete(first.childSessionFile!)
    await service.processRuntimeNotification(
      runtimeEvent(first, {
        type: 'run',
        phase: 'idle',
        seq: 10,
        workspaceId: first.childWorkspacePath,
        sessionFile: first.childSessionFile,
        timestamp: Date.now(),
      }),
    )

    expect((await service.readChild(first.id)).relationship.status).toBe(
      'complete',
    )
    expect((await service.readChild(second.id)).relationship.status).toBe(
      'running',
    )
  })

  it('runs at most four of six requested children and keeps the rest queued', async () => {
    const runtime = new FakeRuntime()
    runtime.max = 4
    const { service } = createHarness({ runtime })
    const children = []
    for (let index = 0; index < 6; index++) {
      children.push(await service.createChild(request(`Task ${index + 1}`)))
    }
    const current = await service.listChildren('/sessions/parent.jsonl')
    expect(current.filter((item) => item.status === 'running')).toHaveLength(4)
    expect(current.filter((item) => item.status === 'queued')).toHaveLength(2)
    expect(runtime.active.size).toBe(4)
  })

  it('captures honest verification evidence and ignores out-of-order events', async () => {
    const { service } = createHarness()
    const child = await service.createChild(request('Test the change'))
    const base = {
      workspaceId: child.childWorkspacePath,
      sessionFile: child.childSessionFile,
      timestamp: Date.now(),
    }
    await service.processRuntimeNotification(
      runtimeEvent(child, {
        ...base,
        type: 'tool',
        phase: 'start',
        toolCallId: 'tool-1',
        toolName: 'bash',
        input: { command: 'npm test' },
        seq: 20,
      }),
    )
    await service.processRuntimeNotification(
      runtimeEvent(child, {
        ...base,
        type: 'tool',
        phase: 'end',
        toolCallId: 'tool-1',
        toolName: 'bash',
        output: { details: { exitCode: 0 } },
        details: { exitCode: 0 },
        isError: false,
        seq: 21,
      }),
    )
    await service.processRuntimeNotification(
      runtimeEvent(child, {
        ...base,
        type: 'message',
        role: 'assistant',
        phase: 'end',
        text: 'new summary',
        seq: 30,
      }),
    )
    await service.processRuntimeNotification(
      runtimeEvent(child, {
        ...base,
        type: 'message',
        role: 'assistant',
        phase: 'end',
        text: 'stale summary',
        seq: 29,
      }),
    )

    const snapshot = await service.readChild(child.id)
    expect(snapshot.relationship.verificationStatus).toBe('passed')
    expect(snapshot.relationship.lastSummary).toBe('new summary')
    expect(snapshot.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: 'acceptance',
          status: 'passed',
          command: 'npm test',
          exitCode: 0,
        }),
      ]),
    )
  })

  it('accepts a restarted worker event sequence after an explicit follow-up', async () => {
    const { service } = createHarness()
    const child = await service.createChild(request('Resume me', 'local'))
    await service.processRuntimeNotification(
      runtimeEvent(child, {
        type: 'run',
        phase: 'idle',
        seq: 100,
        workspaceId: child.childWorkspacePath,
        sessionFile: child.childSessionFile,
        timestamp: Date.now(),
      }),
    )
    const resumed = await service.sendMessage(child.id, 'Continue')
    expect(resumed.lastWorkerEventSequence).toBe(0)
    await service.processRuntimeNotification(
      runtimeEvent(resumed, {
        type: 'message',
        role: 'assistant',
        phase: 'end',
        text: 'accepted after restart',
        seq: 1,
        workspaceId: child.childWorkspacePath,
        sessionFile: child.childSessionFile,
        timestamp: Date.now(),
      }),
    )
    expect((await service.readChild(child.id)).relationship.lastSummary).toBe(
      'accepted after restart',
    )
  })

  it('isolates a child prompt failure and leaves another child runnable', async () => {
    const runtime = new FakeRuntime()
    runtime.failPrompt = true
    const { service } = createHarness({ runtime })
    const failed = await service.createChild(request('Will fail'))
    const healthy = await service.createChild(request('Will run'))

    expect(failed.status).toBe('failed')
    expect(failed.error).toContain('provider unavailable')
    expect(healthy.status).toBe('running')
  })

  it('isolates an unexpected child worker exit', async () => {
    const { service } = createHarness()
    const crashed = await service.createChild(request('Crash'))
    const healthy = await service.createChild(request('Continue'))
    await service.processRuntimeNotification({
      type: 'slot-exit',
      code: 9,
      cwd: crashed.childWorkspacePath,
      poolKey: crashed.childWorkerKey!,
      sessionFile: crashed.childSessionFile!,
      stopping: false,
    })
    expect((await service.readChild(crashed.id)).relationship.status).toBe(
      'interrupted',
    )
    expect((await service.readChild(healthy.id)).relationship.status).toBe(
      'running',
    )
  })

  it('propagates parent cancellation through nested descendants', async () => {
    const { service, runtime } = createHarness()
    const child = await service.createChild(request('Parent child'))
    const grandchild = await service.createChild({
      ...request('Nested child', 'local'),
      parentSessionFile: child.childSessionFile!,
      parentWorkerKey: child.childWorkerKey!,
    })
    await service.cancelChildrenForParent('/sessions/parent.jsonl')

    expect((await service.readChild(child.id)).relationship.status).toBe(
      'cancelled',
    )
    expect((await service.readChild(grandchild.id)).relationship.status).toBe(
      'cancelled',
    )
    expect(runtime.stopped).toEqual(
      expect.arrayContaining([
        child.childSessionFile,
        grandchild.childSessionFile,
      ]),
    )
  })

  it('marks active tasks interrupted on restart and requires explicit resume', async () => {
    const repository = new MemoryOrchestrationRepository()
    const now = Date.now()
    repository.saveRelationship({
      id: '00000000-0000-4000-8000-000000000001',
      parentSessionFile: '/sessions/parent.jsonl',
      childSessionFile: '/sessions/child.jsonl',
      parentWorkerKey: '/sessions/parent.jsonl',
      childWorkerKey: '/sessions/child.jsonl',
      rootWorkspacePath: '/repo',
      childWorkspacePath: '/managed/child',
      environment: 'worktree',
      name: 'Recovered',
      goal: 'Recover',
      status: 'running',
      depth: 1,
      sequence: 2,
      lastWorkerEventSequence: 12,
      timeoutMs: 10_000,
      requiresInput: false,
      verificationStatus: 'unverified',
      createdAt: now - 1_000,
      updatedAt: now - 500,
      startedAt: now - 900,
    })
    const { service } = createHarness({ repository })
    await service.initialize()
    const recovered = await service.readChild(
      '00000000-0000-4000-8000-000000000001',
    )
    expect(recovered.relationship.status).toBe('interrupted')
    expect(recovered.relationship.error).toContain('restarted')
  })

  it('moves an overlong run to timed_out and exposes continue/retry recovery', async () => {
    const { service, runtime } = createHarness()
    const child = await service.createChild(request('Slow task', 'local', 10))
    await vi.waitFor(
      async () => {
        expect((await service.readChild(child.id)).relationship.status).toBe(
          'timed_out',
        )
      },
      { timeout: 1_000 },
    )
    expect(runtime.aborted).toContain(child.childSessionFile)
    const resumed = await service.resumeChild(child.id, 'retry')
    expect(resumed.status).toBe('running')
    expect(runtime.messages.at(-1)?.text).toContain('Retry the original goal')
  })

  it('completes 100 sequential child lifecycles without residual runtime slots', async () => {
    const runtime = new FakeRuntime()
    runtime.max = 1
    const { service, repository } = createHarness({ runtime })
    for (let index = 0; index < 100; index++) {
      const child = await service.createChild(
        request(`Soak task ${index + 1}`, 'local', 30_000),
      )
      runtime.active.delete(child.childSessionFile!)
      await service.processRuntimeNotification(
        runtimeEvent(child, {
          type: 'run',
          phase: 'idle',
          seq: 1,
          workspaceId: child.childWorkspacePath,
          sessionFile: child.childSessionFile,
          timestamp: Date.now(),
        }),
      )
    }
    const relationships = repository.listRelationships({
      parentSessionFile: '/sessions/parent.jsonl',
    })
    expect(relationships).toHaveLength(100)
    expect(relationships.every((item) => item.status === 'complete')).toBe(true)
    expect(runtime.active.size).toBe(0)
  })
})
