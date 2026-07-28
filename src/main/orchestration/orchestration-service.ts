import { randomUUID } from 'node:crypto'
import type { AppEvent, ToolEvent } from '@shared/app-events'
import type { AuditEventInput } from '@shared/audit-events'
import type { ManagedWorktree } from '@shared/managed-worktree'
import {
  isTerminalOrchestrationStatus,
  orchestrationWorkerRequestSchema,
  type AgentRelationship,
  type CreateChildAgentRequest,
  type OrchestrationEnvironment,
  type OrchestrationEvidence,
  type OrchestrationEvent,
  type OrchestrationTaskSnapshot,
  type OrchestrationWorkerResponse,
  type WaitForChildrenResult,
} from '@shared/orchestration'
import type { WorkerRuntimeNotification } from '../worker-manager'
import type { OrchestrationRepository } from './orchestration-repository'

const DEFAULT_TIMEOUT_MS = 30 * 60 * 1_000
const MAX_DEPTH = 3
const ATTENTION_STATUSES = new Set([
  'waiting',
  'timed_out',
  'complete',
  'failed',
  'cancelled',
  'interrupted',
])

export interface OrchestrationRuntime {
  createSession(cwd: string): Promise<{
    sessionId: string
    sessionFile: string
    workerKey: string
    model?: string
    thinkingLevel?: string
  } | null>
  ensureSession(
    sessionFile: string,
    cwd: string,
  ): ReturnType<OrchestrationRuntime['createSession']>
  getState(sessionFile: string): Promise<Record<string, unknown>>
  configure(
    sessionFile: string,
    options: { model?: string; thinkingLevel?: string },
  ): Promise<void>
  prompt(sessionFile: string, text: string): Promise<void>
  message(sessionFile: string, text: string): Promise<void>
  abort(sessionFile: string): Promise<void>
  stop(sessionFile: string): Promise<void>
}

export interface OrchestrationWorktreeController {
  create(request: {
    rootWorkspacePath: string
    name?: string
    createdBySession?: string
  }): Promise<ManagedWorktree>
}

export interface OrchestrationServiceOptions {
  repository: OrchestrationRepository
  runtime: OrchestrationRuntime
  worktrees: OrchestrationWorktreeController
  publish?: (event: OrchestrationEvent) => void
  audit?: (event: AuditEventInput) => void | Promise<void>
  now?: () => number
  idFactory?: () => string
}

type RequestContext = {
  parentSessionFile: string
  parentWorkerKey: string
  rootWorkspacePath: string
}

function concise(value: unknown, limit = 4_000): string | undefined {
  if (value == null) return undefined
  const text = typeof value === 'string' ? value : JSON.stringify(value)
  return text.trim().slice(0, limit) || undefined
}

function commandFromTool(event: ToolEvent): string | undefined {
  if (event.toolName.toLowerCase() !== 'bash') return undefined
  const input = event.input
  if (typeof input === 'string') return input
  if (input && typeof input === 'object') {
    const record = input as Record<string, unknown>
    return concise(record.command ?? record.cmd)
  }
  return undefined
}

function exitCodeFromTool(event: ToolEvent): number {
  if (event.details && typeof event.details === 'object') {
    const details = event.details as Record<string, unknown>
    const raw = details.exitCode ?? details.code
    if (typeof raw === 'number' && Number.isFinite(raw)) return raw
  }
  if (!event.isError) return 0
  const output = concise(event.output) || ''
  const match = output.match(/(?:exit(?:ed)?(?: with)?(?: code)?|code)\s*[:=]?\s*(-?\d+)/i)
  return match ? Number(match[1]) : 1
}

function isVerificationCommand(command: string): boolean {
  return /(?:^|\s)(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|check|verify|build)\b|(?:^|\s)(?:vitest|jest|pytest|cargo\s+test|go\s+test|mvn\s+test|gradle\s+test)\b/i.test(
    command,
  )
}

function childPrompt(relationship: AgentRelationship): string {
  return [
    `You are child agent "${relationship.name}" in an enterprise orchestration run.`,
    `Goal: ${relationship.goal}`,
    `Workspace: ${relationship.childWorkspacePath}`,
    'Work independently within this goal. Inspect existing code before editing.',
    'Run relevant verification. Never claim a test passed unless the command actually completed successfully.',
    'Finish with a concise summary of changes, verification evidence, and any blockers.',
  ].join('\n')
}

export class OrchestrationService {
  private readonly repository: OrchestrationRepository
  private readonly runtime: OrchestrationRuntime
  private readonly worktrees: OrchestrationWorktreeController
  private readonly publishEvent?: OrchestrationServiceOptions['publish']
  private readonly auditWriter?: OrchestrationServiceOptions['audit']
  private readonly now: () => number
  private readonly idFactory: () => string
  private chain: Promise<unknown> = Promise.resolve()
  private readonly timeoutTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly waiters = new Set<() => void>()

  constructor(options: OrchestrationServiceOptions) {
    this.repository = options.repository
    this.runtime = options.runtime
    this.worktrees = options.worktrees
    this.publishEvent = options.publish
    this.auditWriter = options.audit
    this.now = options.now ?? Date.now
    this.idFactory = options.idFactory ?? randomUUID
  }

  private serialize<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.chain.catch(() => {}).then(operation)
    this.chain = run.then(
      () => undefined,
      () => undefined,
    )
    return run
  }

  private audit(event: AuditEventInput): void {
    void Promise.resolve(this.auditWriter?.(event)).catch((error) => {
      console.warn('[orchestration] audit write failed:', error)
    })
  }

  private async persist(
    relationship: AgentRelationship,
    options?: { publish?: boolean; action?: string },
  ): Promise<AgentRelationship> {
    const next = {
      ...relationship,
      sequence: relationship.sequence + 1,
      updatedAt: this.now(),
    }
    await this.repository.saveRelationship(next)
    if (options?.publish !== false) this.publish(next)
    if (options?.action) {
      const outcome =
        next.status === 'failed'
          ? 'failed'
          : next.status === 'waiting' ||
              next.status === 'timed_out' ||
              next.status === 'interrupted'
            ? 'blocked'
            : 'success'
      this.audit({
        category: 'operation',
        action: options.action,
        outcome,
        actor: next.parentSessionFile,
        workspaceId: next.rootWorkspacePath,
        sessionFile: next.childSessionFile,
        details: {
          relationshipId: next.id,
          parentSessionFile: next.parentSessionFile,
          childSessionFile: next.childSessionFile,
          environment: next.environment,
        },
      })
    }
    this.wakeWaiters()
    return next
  }

  private publish(relationship: AgentRelationship): void {
    this.publishEvent?.({
      type: 'orchestration',
      seq: relationship.sequence,
      workspaceId: relationship.rootWorkspacePath,
      sessionId: relationship.childSessionFile,
      sessionFile: relationship.childSessionFile,
      timestamp: relationship.updatedAt,
      relationship,
    })
  }

  private wakeWaiters(): void {
    for (const wake of this.waiters) wake()
    this.waiters.clear()
  }

  private clearTimeoutTimer(id: string): void {
    const timer = this.timeoutTimers.get(id)
    if (timer) clearTimeout(timer)
    this.timeoutTimers.delete(id)
  }

  private scheduleTimeout(relationship: AgentRelationship): void {
    this.clearTimeoutTimer(relationship.id)
    if (!relationship.startedAt || relationship.timeoutMs <= 0) return
    const remaining =
      relationship.startedAt + relationship.timeoutMs - this.now()
    const timer = setTimeout(() => {
      void this.serialize(() => this.timeoutUnlocked(relationship.id))
    }, Math.max(1, remaining))
    if (typeof timer === 'object' && 'unref' in timer) timer.unref?.()
    this.timeoutTimers.set(relationship.id, timer)
  }

  async initialize(): Promise<void> {
    await this.serialize(async () => {
      const relationships = await this.repository.listRelationships()
      for (const relationship of relationships) {
        if (
          relationship.status === 'starting' ||
          relationship.status === 'running' ||
          relationship.status === 'waiting' ||
          relationship.status === 'timed_out'
        ) {
          await this.persist(
            {
              ...relationship,
              status: 'interrupted',
              requiresInput: false,
              error: 'Application restarted before the child task completed',
              completedAt: this.now(),
            },
            { action: 'orchestration.recover.interrupted' },
          )
        } else {
          this.publish(relationship)
        }
      }
      await this.pumpQueueUnlocked()
    })
  }

  async handleWorkerRequest(payload: {
    request: unknown
    parentSessionFile: string | null
    parentWorkerKey: string
    rootWorkspacePath: string
  }): Promise<OrchestrationWorkerResponse> {
    if (!payload.parentSessionFile) {
      return {
        ok: false,
        code: 'PARENT_SESSION_REQUIRED',
        error: 'The parent worker is not bound to a persisted session yet',
      }
    }
    const parsed = orchestrationWorkerRequestSchema.safeParse(payload.request)
    if (!parsed.success) {
      return {
        ok: false,
        code: 'INVALID_REQUEST',
        error: parsed.error.issues.map((issue) => issue.message).join('; '),
      }
    }
    const context: RequestContext = {
      parentSessionFile: payload.parentSessionFile,
      parentWorkerKey: payload.parentWorkerKey,
      rootWorkspacePath: payload.rootWorkspacePath,
    }
    try {
      const request = parsed.data
      if (request.method === 'createChild') {
        return {
          ok: true,
          result: await this.createChild({
            ...context,
            goal: request.goal,
            name: request.name,
            environment: request.environment,
            timeoutMs: request.timeoutMs,
          }),
        }
      }
      if (request.method === 'listChildren') {
        return {
          ok: true,
          result: await this.listChildren(context.parentSessionFile),
        }
      }
      if (request.method === 'waitChildren') {
        return {
          ok: true,
          result: await this.waitForChildren(
            context.parentSessionFile,
            request.relationshipIds,
            request.timeoutMs,
          ),
        }
      }
      const relationship = await this.authorizeDirectChild(
        context.parentSessionFile,
        request.relationshipId,
      )
      if (request.method === 'readChild') {
        return {
          ok: true,
          result: request.includeEvidence === false
            ? relationship
            : await this.readChild(relationship.id),
        }
      }
      if (request.method === 'sendMessage') {
        return {
          ok: true,
          result: await this.sendMessage(relationship.id, request.text),
        }
      }
      if (request.method === 'stopChild') {
        return { ok: true, result: await this.cancelChild(relationship.id) }
      }
      throw new Error('Unsupported orchestration request')
    } catch (error) {
      return {
        ok: false,
        code: 'ORCHESTRATION_REQUEST_FAILED',
        error: error instanceof Error ? error.message : String(error),
      }
    }
  }

  async createChild(
    request: CreateChildAgentRequest & {
      parentWorkerKey: string
      rootWorkspacePath: string
      parentWorkspacePath?: string
    },
  ): Promise<AgentRelationship> {
    return this.serialize(async () => {
      const parent = await this.repository.getByChildSession(
        request.parentSessionFile,
      )
      const depth = parent ? parent.depth + 1 : 1
      if (depth > MAX_DEPTH) {
        throw new Error(`Maximum child-agent depth (${MAX_DEPTH}) exceeded`)
      }
      const now = this.now()
      const rootWorkspacePath =
        parent?.rootWorkspacePath ?? request.rootWorkspacePath
      const parentWorkspacePath =
        parent?.childWorkspacePath ??
        request.parentWorkspacePath ??
        request.rootWorkspacePath
      const environment: OrchestrationEnvironment =
        request.environment ?? 'worktree'
      let relationship: AgentRelationship = {
        id: this.idFactory(),
        parentSessionFile: request.parentSessionFile,
        parentWorkerKey: request.parentWorkerKey,
        rootWorkspacePath,
        childWorkspacePath: parentWorkspacePath,
        environment,
        name:
          request.name?.trim() ||
          request.goal.trim().split(/\r?\n/)[0].slice(0, 80),
        goal: request.goal.trim(),
        status: 'queued',
        depth,
        sequence: 0,
        lastWorkerEventSequence: 0,
        timeoutMs: request.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        requiresInput: false,
        verificationStatus: 'unverified',
        createdAt: now,
        updatedAt: now,
      }
      relationship = await this.persist(relationship, {
        action: 'orchestration.create',
      })
      if (environment === 'worktree') {
        try {
          const worktree = await this.worktrees.create({
            rootWorkspacePath,
            name: relationship.name,
            createdBySession: request.parentSessionFile,
          })
          relationship = await this.persist({
            ...relationship,
            rootWorkspacePath: worktree.rootWorkspacePath,
            worktreeId: worktree.id,
            childWorkspacePath: worktree.worktreePath,
          })
        } catch (error) {
          return this.persist(
            {
              ...relationship,
              status: 'failed',
              error: error instanceof Error ? error.message : String(error),
              completedAt: this.now(),
            },
            { action: 'orchestration.worktree.failed' },
          )
        }
      }
      await this.pumpQueueUnlocked()
      return (await this.repository.getRelationship(relationship.id))!
    })
  }

  async listChildren(parentSessionFile: string): Promise<AgentRelationship[]> {
    return this.repository.listRelationships({ parentSessionFile })
  }

  async listWorkspace(rootWorkspacePath: string): Promise<AgentRelationship[]> {
    return this.repository.listRelationships({ rootWorkspacePath })
  }

  async readChild(id: string): Promise<OrchestrationTaskSnapshot> {
    const relationship = await this.repository.getRelationship(id)
    if (!relationship) throw new Error('Child agent not found')
    return {
      relationship,
      evidence: await this.repository.listEvidence(id),
    }
  }

  private async authorizeDirectChild(
    parentSessionFile: string,
    id: string,
  ): Promise<AgentRelationship> {
    const relationship = await this.repository.getRelationship(id)
    if (!relationship || relationship.parentSessionFile !== parentSessionFile) {
      throw new Error('Child agent not found for this parent session')
    }
    return relationship
  }

  private async pumpQueueUnlocked(): Promise<void> {
    const relationships = await this.repository.listRelationships()
    for (const queued of relationships.filter((item) => item.status === 'queued')) {
      let relationship = await this.persist(
        { ...queued, status: 'starting', error: undefined },
        { action: 'orchestration.starting' },
      )
      const resumingExisting = !!relationship.childSessionFile
      let child: Awaited<ReturnType<OrchestrationRuntime['createSession']>>
      try {
        child = relationship.childSessionFile
          ? await this.runtime.ensureSession(
              relationship.childSessionFile,
              relationship.childWorkspacePath,
            )
          : await this.runtime.createSession(
              relationship.childWorkspacePath,
            )
      } catch (error) {
        await this.persist(
          {
            ...relationship,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            completedAt: this.now(),
          },
          { action: 'orchestration.worker.failed' },
        )
        continue
      }
      if (!child) {
        await this.persist({ ...relationship, status: 'queued' })
        return
      }
      const parentState: Record<string, unknown> = await this.runtime
        .getState(relationship.parentSessionFile)
        .catch((): Record<string, unknown> => ({}))
      relationship = await this.persist({
        ...relationship,
        childSessionId: child.sessionId || relationship.childSessionId,
        childSessionFile: child.sessionFile,
        childWorkerKey: child.workerKey,
        model:
          typeof parentState.model === 'string'
            ? parentState.model
            : child.model,
        thinkingLevel:
          typeof parentState.thinkingLevel === 'string'
            ? parentState.thinkingLevel
            : child.thinkingLevel,
        status: 'running',
        startedAt: this.now(),
        lastWorkerEventSequence: 0,
      })
      try {
        await this.runtime.configure(child.sessionFile, {
          model: relationship.model,
          thinkingLevel: relationship.thinkingLevel,
        })
        if (resumingExisting) {
          await this.runtime.message(
            child.sessionFile,
            relationship.pendingMessage ||
              'Continue the original goal from the current workspace state and verify the result.',
          )
        } else {
          await this.runtime.prompt(
            child.sessionFile,
            [
              childPrompt(relationship),
              relationship.pendingMessage
                ? `Additional parent instruction: ${relationship.pendingMessage}`
                : '',
            ]
              .filter(Boolean)
              .join('\n\n'),
          )
        }
        if (relationship.pendingMessage) {
          relationship = await this.persist({
            ...relationship,
            pendingMessage: undefined,
          })
        }
        this.scheduleTimeout(relationship)
      } catch (error) {
        await this.runtime.stop(child.sessionFile).catch(() => {})
        await this.persist(
          {
            ...relationship,
            status: 'failed',
            error: error instanceof Error ? error.message : String(error),
            completedAt: this.now(),
          },
          { action: 'orchestration.prompt.failed' },
        )
      }
    }
  }

  async sendMessage(id: string, text: string): Promise<AgentRelationship> {
    return this.serialize(async () => {
      let relationship = await this.requiredRelationship(id)
      if (
        relationship.status === 'cancelled' ||
        relationship.status === 'failed'
      ) {
        throw new Error(`Cannot message a ${relationship.status} child agent`)
      }
      if (!relationship.childSessionFile) {
        relationship = await this.persist({
          ...relationship,
          pendingMessage: text.trim(),
        })
        return relationship
      }
      if (isTerminalOrchestrationStatus(relationship.status)) {
        const worker = await this.runtime.ensureSession(
          relationship.childSessionFile,
          relationship.childWorkspacePath,
        )
        if (!worker) {
          return this.persist({
            ...relationship,
            status: 'queued',
            pendingMessage: text.trim(),
            completedAt: undefined,
          })
        }
      }
      await this.runtime.message(relationship.childSessionFile, text.trim())
      relationship = await this.persist({
        ...relationship,
        status: 'running',
        requiresInput: false,
        pendingMessage: undefined,
        error: undefined,
        completedAt: undefined,
        startedAt: this.now(),
        lastWorkerEventSequence: 0,
      })
      this.scheduleTimeout(relationship)
      return relationship
    })
  }

  async cancelChild(id: string): Promise<AgentRelationship> {
    return this.serialize(() => this.cancelChildUnlocked(id))
  }

  private async cancelChildUnlocked(id: string): Promise<AgentRelationship> {
    const relationship = await this.requiredRelationship(id)
    if (isTerminalOrchestrationStatus(relationship.status)) return relationship
    const cancelled = await this.cancelRelationshipSetUnlocked([
      relationship,
      ...(await this.descendantsOf(relationship.childSessionFile)),
    ])
    await this.pumpQueueUnlocked()
    return cancelled.find((item) => item.id === id) ?? relationship
  }

  async cancelChildrenForParent(parentSessionFile: string): Promise<void> {
    await this.serialize(() =>
      this.cancelChildrenForParentUnlocked(parentSessionFile),
    )
  }

  private async cancelChildrenForParentUnlocked(
    parentSessionFile?: string,
  ): Promise<void> {
    if (!parentSessionFile) return
    const all = await this.repository.listRelationships()
    const direct = all.filter(
      (relationship) =>
        relationship.parentSessionFile === parentSessionFile &&
        !isTerminalOrchestrationStatus(relationship.status),
    )
    const targets = [...direct]
    const parentSessions = new Set(
      direct
        .map((relationship) => relationship.childSessionFile)
        .filter((value): value is string => !!value),
    )
    let changed = true
    while (changed) {
      changed = false
      for (const relationship of all) {
        if (
          parentSessions.has(relationship.parentSessionFile) &&
          !targets.some((target) => target.id === relationship.id) &&
          !isTerminalOrchestrationStatus(relationship.status)
        ) {
          targets.push(relationship)
          if (relationship.childSessionFile) {
            parentSessions.add(relationship.childSessionFile)
          }
          changed = true
        }
      }
    }
    await this.cancelRelationshipSetUnlocked(targets)
    await this.pumpQueueUnlocked()
  }

  private async descendantsOf(
    parentSessionFile?: string,
  ): Promise<AgentRelationship[]> {
    if (!parentSessionFile) return []
    const all = await this.repository.listRelationships()
    const sessions = new Set([parentSessionFile])
    const descendants: AgentRelationship[] = []
    let changed = true
    while (changed) {
      changed = false
      for (const relationship of all) {
        if (
          sessions.has(relationship.parentSessionFile) &&
          !descendants.some((item) => item.id === relationship.id)
        ) {
          descendants.push(relationship)
          if (relationship.childSessionFile) {
            sessions.add(relationship.childSessionFile)
          }
          changed = true
        }
      }
    }
    return descendants
  }

  private async cancelRelationshipSetUnlocked(
    relationships: AgentRelationship[],
  ): Promise<AgentRelationship[]> {
    const active = relationships.filter(
      (relationship) => !isTerminalOrchestrationStatus(relationship.status),
    )
    for (const relationship of active) {
      this.clearTimeoutTimer(relationship.id)
    }
    await Promise.all(
      active.map((relationship) =>
        relationship.childSessionFile
          ? this.runtime.stop(relationship.childSessionFile).catch(() => {})
          : Promise.resolve(),
      ),
    )
    const cancelled: AgentRelationship[] = []
    for (const relationship of active) {
      cancelled.push(
        await this.persist(
          {
            ...relationship,
            status: 'cancelled',
            requiresInput: false,
            error: undefined,
            completedAt: this.now(),
          },
          { action: 'orchestration.cancel' },
        ),
      )
    }
    return cancelled
  }

  async resumeChild(
    id: string,
    action: 'continue' | 'retry',
  ): Promise<AgentRelationship> {
    return this.serialize(async () => {
      let relationship = await this.requiredRelationship(id)
      if (
        relationship.status !== 'timed_out' &&
        relationship.status !== 'interrupted'
      ) {
        throw new Error('Only timed-out or interrupted child agents can resume')
      }
      if (!relationship.childSessionFile) {
        relationship = await this.persist({
          ...relationship,
          status: 'queued',
          completedAt: undefined,
          error: undefined,
        })
        await this.pumpQueueUnlocked()
        return (await this.repository.getRelationship(id)) ?? relationship
      }
      const worker = await this.runtime.ensureSession(
        relationship.childSessionFile,
        relationship.childWorkspacePath,
      )
      if (!worker) {
        return this.persist({
          ...relationship,
          status: 'queued',
          completedAt: undefined,
          error: undefined,
        })
      }
      await this.runtime.message(
        relationship.childSessionFile,
        action === 'retry'
          ? `Retry the original goal from the current workspace state. Re-run relevant verification.\n\nOriginal goal: ${relationship.goal}`
          : 'Continue the original goal from the current workspace state. Re-check what remains and verify the result.',
      )
      relationship = await this.persist(
        {
          ...relationship,
          childWorkerKey: worker.workerKey,
          status: 'running',
          requiresInput: false,
          completedAt: undefined,
          error: undefined,
          startedAt: this.now(),
          lastWorkerEventSequence: 0,
        },
        { action: `orchestration.${action}` },
      )
      this.scheduleTimeout(relationship)
      return relationship
    })
  }

  private async timeoutUnlocked(id: string): Promise<void> {
    const relationship = await this.repository.getRelationship(id)
    if (!relationship || relationship.status !== 'running') return
    if (relationship.childSessionFile) {
      await this.runtime.abort(relationship.childSessionFile).catch(() => {})
    }
    await this.persist(
      {
        ...relationship,
        status: 'timed_out',
        requiresInput: true,
        error: `Child task exceeded ${relationship.timeoutMs} ms`,
      },
      { action: 'orchestration.timeout' },
    )
  }

  async waitForChildren(
    parentSessionFile: string,
    relationshipIds?: string[],
    timeoutMs = 30_000,
  ): Promise<WaitForChildrenResult> {
    const select = async () => {
      const all = await this.repository.listRelationships({
        parentSessionFile,
      })
      if (!relationshipIds?.length) return all
      const requested = new Set(relationshipIds)
      return all.filter((relationship) => requested.has(relationship.id))
    }
    let relationships = await select()
    if (
      relationships.length === 0 ||
      relationships.every((relationship) =>
        ATTENTION_STATUSES.has(relationship.status),
      ) ||
      timeoutMs <= 0
    ) {
      return { relationships, timedOut: false }
    }
    const changed = await new Promise<boolean>((resolve) => {
      const wake = () => {
        clearTimeout(timer)
        this.waiters.delete(wake)
        resolve(true)
      }
      const timer = setTimeout(() => {
        this.waiters.delete(wake)
        resolve(false)
      }, Math.min(60_000, Math.max(0, timeoutMs)))
      this.waiters.add(wake)
    })
    relationships = await select()
    return { relationships, timedOut: !changed }
  }

  handleRuntimeNotification(notification: WorkerRuntimeNotification): void {
    void this.processRuntimeNotification(notification)
  }

  processRuntimeNotification(
    notification: WorkerRuntimeNotification,
  ): Promise<void> {
    return this.serialize(() => this.handleRuntimeUnlocked(notification))
  }

  private async handleRuntimeUnlocked(
    notification: WorkerRuntimeNotification,
  ): Promise<void> {
    if (!notification.sessionFile) return
    const relationship = await this.repository.getByChildSession(
      notification.sessionFile,
    )
    if (!relationship) return
    if (notification.type === 'slot-exit') {
      if (
        !notification.stopping &&
        !isTerminalOrchestrationStatus(relationship.status)
      ) {
        this.clearTimeoutTimer(relationship.id)
        await this.persist(
          {
            ...relationship,
            status: 'interrupted',
            error: `Child worker exited with code ${notification.code}`,
            completedAt: this.now(),
          },
          { action: 'orchestration.worker.interrupted' },
        )
        await this.pumpQueueUnlocked()
      }
      return
    }
    if (notification.type === 'extension-ui-request') {
      const request = notification.request as { method?: string; message?: string }
      if (request?.method && request.method !== 'notify') {
        await this.persist({
          ...relationship,
          status: 'waiting',
          requiresInput: true,
          lastSummary:
            concise(request.message) || 'Child agent is waiting for user input',
        })
      }
      return
    }
    const event = notification.event
    if (!('seq' in event)) return
    if (event.seq <= relationship.lastWorkerEventSequence) return
    let current = await this.persist(
      {
        ...relationship,
        lastWorkerEventSequence: event.seq,
      },
      { publish: false },
    )
    current = await this.captureEvidence(current, event)
    if (event.type === 'message' && event.role === 'assistant' && event.phase === 'end') {
      current = await this.persist({
        ...current,
        lastOutput: concise(event.text),
        lastSummary: concise(event.text, 600),
      })
    }
    if (event.type === 'agent_error') {
      current = await this.persist({
        ...current,
        error: event.text,
        lastSummary: concise(event.text, 600),
      })
      await this.addEvidence(current, {
        id: `${current.id}:error:${event.seq}`,
        kind: 'blocker',
        status: 'blocked',
        title: 'Agent runtime error',
        detail: event.text,
      })
    }
    if (event.type !== 'run') return
    if (event.phase === 'running' || event.phase === 'started') {
      if (
        current.status !== 'timed_out' &&
        current.status !== 'cancelled'
      ) {
        await this.persist({
          ...current,
          status: 'running',
          requiresInput: false,
          startedAt: current.startedAt ?? this.now(),
        })
      }
      return
    }
    if (event.phase === 'failed') {
      this.clearTimeoutTimer(current.id)
      await this.persist(
        {
          ...current,
          status: 'failed',
          completedAt: this.now(),
          error: current.error || 'Child agent run failed',
        },
        { action: 'orchestration.failed' },
      )
      await this.pumpQueueUnlocked()
      return
    }
    if (event.phase === 'cancelled') {
      if (current.status === 'timed_out') return
      this.clearTimeoutTimer(current.id)
      await this.persist(
        {
          ...current,
          status: 'cancelled',
          completedAt: this.now(),
        },
        { action: 'orchestration.cancelled' },
      )
      await this.pumpQueueUnlocked()
      return
    }
    if (
      event.phase === 'idle' &&
      current.startedAt &&
      current.status === 'running'
    ) {
      this.clearTimeoutTimer(current.id)
      await this.persist(
        {
          ...current,
          status: 'complete',
          completedAt: this.now(),
          requiresInput: false,
        },
        { action: 'orchestration.complete' },
      )
      await this.pumpQueueUnlocked()
    }
  }

  private async captureEvidence(
    relationship: AgentRelationship,
    event: AppEvent,
  ): Promise<AgentRelationship> {
    if (event.type === 'file') {
      await this.addEvidence(relationship, {
        id: `${relationship.id}:file:${event.seq}`,
        kind: 'change',
        status: 'reported',
        title: `${event.changeType}: ${event.path}`,
        detail: `Source: ${event.source}`,
        workspacePath: relationship.childWorkspacePath,
      })
      return relationship
    }
    if (event.type !== 'tool') return relationship
    let command = commandFromTool(event)
    if (!command && event.phase === 'end') {
      const prior = await this.repository.listEvidence(relationship.id)
      command = prior.find(
        (item) =>
          item.id ===
          `${relationship.id}:command:${event.toolCallId}:start`,
      )?.command
    }
    if (!command) return relationship
    if (event.phase === 'start') {
      await this.addEvidence(relationship, {
        id: `${relationship.id}:command:${event.toolCallId}:start`,
        kind: 'command',
        status: 'running',
        title: 'Command started',
        command,
        workspacePath: relationship.childWorkspacePath,
      })
      return relationship
    }
    if (event.phase !== 'end') return relationship
    const exitCode = exitCodeFromTool(event)
    const verification = isVerificationCommand(command)
    await this.addEvidence(relationship, {
      id: `${relationship.id}:command:${event.toolCallId}:end`,
      kind: verification ? 'acceptance' : 'command',
      status: exitCode === 0 ? (verification ? 'passed' : 'unverified') : 'failed',
      title: exitCode === 0 ? 'Command completed' : 'Command failed',
      detail: concise(event.output),
      command,
      exitCode,
      workspacePath: relationship.childWorkspacePath,
    })
    if (!verification) return relationship
    return this.persist({
      ...relationship,
      verificationStatus: exitCode === 0 ? 'passed' : 'failed',
    })
  }

  private async addEvidence(
    relationship: AgentRelationship,
    evidence: Omit<OrchestrationEvidence, 'relationshipId' | 'createdAt'>,
  ): Promise<void> {
    await this.repository.addEvidence({
      ...evidence,
      relationshipId: relationship.id,
      createdAt: this.now(),
    })
    this.publish(relationship)
  }

  private async requiredRelationship(id: string): Promise<AgentRelationship> {
    const relationship = await this.repository.getRelationship(id)
    if (!relationship) throw new Error('Child agent not found')
    return relationship
  }
}
