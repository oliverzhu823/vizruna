import { execFile as execFileCallback } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it } from 'vitest'
import type { AppEvent } from '@shared/app-events'
import type { AgentRelationship } from '@shared/orchestration'
import { MemoryManagedWorktreeRepository } from '../worktree/managed-worktree-repository'
import { ManagedWorktreeService } from '../worktree/managed-worktree-service'
import { MemoryOrchestrationRepository } from './orchestration-repository'
import {
  OrchestrationService,
  type OrchestrationRuntime,
} from './orchestration-service'

const execFile = promisify(execFileCallback)
const temporaryRoots: string[] = []

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((path) =>
      rm(path, { recursive: true, force: true }),
    ),
  )
})

class DeterministicRuntime implements OrchestrationRuntime {
  private counter = 0
  readonly active = new Set<string>()

  async createSession() {
    const id = ++this.counter
    const sessionFile = `/sessions/integration-child-${id}.jsonl`
    this.active.add(sessionFile)
    return {
      sessionId: `integration-child-${id}`,
      sessionFile,
      workerKey: sessionFile,
      model: 'fixture/model',
      thinkingLevel: 'low',
    }
  }

  async ensureSession(sessionFile: string) {
    this.active.add(sessionFile)
    return {
      sessionId: sessionFile,
      sessionFile,
      workerKey: sessionFile,
      model: 'fixture/model',
      thinkingLevel: 'low',
    }
  }

  async getState() {
    return { model: 'fixture/model', thinkingLevel: 'low' }
  }

  async configure() {}
  async prompt() {}
  async message() {}
  async abort(sessionFile: string) {
    this.active.delete(sessionFile)
  }
  async stop(sessionFile: string) {
    this.active.delete(sessionFile)
  }
}

async function createGitFixture(): Promise<{ root: string; managedRoot: string }> {
  const container = await mkdtemp(join(tmpdir(), 'pi-orchestration-worktree-'))
  temporaryRoots.push(container)
  const root = join(container, 'repository')
  const managedRoot = join(container, 'managed')
  await mkdir(root)
  await execFile('git', ['init', '-b', 'main'], { cwd: root })
  await execFile('git', ['config', 'user.name', 'Pi Test'], { cwd: root })
  await execFile('git', ['config', 'user.email', 'pi-test@example.invalid'], {
    cwd: root,
  })
  await writeFile(join(root, 'README.md'), '# fixture\n', 'utf8')
  await execFile('git', ['add', 'README.md'], { cwd: root })
  await execFile('git', ['commit', '-m', 'fixture'], { cwd: root })
  return { root, managedRoot }
}

function notification(
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

describe('orchestration + real managed worktrees', () => {
  it('closes two isolated code tasks with real file and test evidence', async () => {
    const { root, managedRoot } = await createGitFixture()
    const worktrees = new ManagedWorktreeService({
      managedRoot,
      repository: new MemoryManagedWorktreeRepository(),
    })
    const service = new OrchestrationService({
      repository: new MemoryOrchestrationRepository(),
      runtime: new DeterministicRuntime(),
      worktrees,
    })
    const baseRequest = {
      parentSessionFile: '/sessions/parent.jsonl',
      parentWorkerKey: '/sessions/parent.jsonl',
      rootWorkspacePath: root,
      environment: 'worktree' as const,
      timeoutMs: 30_000,
    }
    const children = await Promise.all([
      service.createChild({ ...baseRequest, goal: 'Implement agent A module' }),
      service.createChild({ ...baseRequest, goal: 'Implement agent B module' }),
    ])
    expect(children[0].childWorkspacePath).not.toBe(
      children[1].childWorkspacePath,
    )

    for (const [index, child] of children.entries()) {
      const moduleName = `agent-${index + 1}.mjs`
      const modulePath = join(child.childWorkspacePath, moduleName)
      await writeFile(
        modulePath,
        `export const value = ${index + 1}\n`,
        'utf8',
      )
      const command = `node -e "import('./${moduleName}').then(m=>{if(m.value!==${index + 1})process.exit(1)})"`
      await service.processRuntimeNotification(
        notification(child, {
          type: 'file',
          source: 'write',
          path: moduleName,
          changeType: 'added',
          seq: 10,
          workspaceId: child.childWorkspacePath,
          sessionFile: child.childSessionFile,
          timestamp: Date.now(),
        }),
      )
      await service.processRuntimeNotification(
        notification(child, {
          type: 'tool',
          phase: 'start',
          toolCallId: `test-${index}`,
          toolName: 'bash',
          input: { command: `npm test -- ${moduleName}` },
          seq: 11,
          workspaceId: child.childWorkspacePath,
          sessionFile: child.childSessionFile,
          timestamp: Date.now(),
        }),
      )
      const result = await execFile('sh', ['-c', command], {
        cwd: child.childWorkspacePath,
      })
      await service.processRuntimeNotification(
        notification(child, {
          type: 'tool',
          phase: 'end',
          toolCallId: `test-${index}`,
          toolName: 'bash',
          output: result.stdout,
          details: { exitCode: 0 },
          isError: false,
          seq: 12,
          workspaceId: child.childWorkspacePath,
          sessionFile: child.childSessionFile,
          timestamp: Date.now(),
        }),
      )
      await service.processRuntimeNotification(
        notification(child, {
          type: 'run',
          phase: 'idle',
          seq: 13,
          workspaceId: child.childWorkspacePath,
          sessionFile: child.childSessionFile,
          timestamp: Date.now(),
        }),
      )

      expect(await readFile(modulePath, 'utf8')).toContain(
        `value = ${index + 1}`,
      )
      const snapshot = await service.readChild(child.id)
      expect(snapshot.relationship.status).toBe('complete')
      expect(snapshot.relationship.verificationStatus).toBe('passed')
      expect(snapshot.evidence).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            kind: 'change',
            workspacePath: child.childWorkspacePath,
          }),
          expect.objectContaining({
            kind: 'acceptance',
            status: 'passed',
            exitCode: 0,
            workspacePath: child.childWorkspacePath,
          }),
        ]),
      )
    }
  })
})
