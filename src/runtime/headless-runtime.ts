import { randomBytes, randomUUID } from 'node:crypto'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { basename, extname } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AgentSession, AgentSessionEvent, ResolvedPaths } from '@earendil-works/pi-coding-agent'
import * as pi from '@earendil-works/pi-coding-agent'
import type { AgentProfile, AgentProfileSnapshot } from '@shared/agent-profile'
import type { AgentEvaluationSuite } from '@shared/agent-evaluation'
import type {
  RuntimeCapabilityManifest,
  RuntimeEvaluationRecordV1,
  RuntimeEventEnvelopeV1,
  RuntimeEvidenceBundleV1,
  RuntimeRunRecord,
  RuntimeRunStartRequest,
} from '@shared/runtime-rpc-v1'
import { VIZRUNA_RUNTIME_RPC_VERSION } from '@shared/runtime-rpc-v1'
import { extractTextFromPiMessage, piUsageTotals, type PiSessionMessage } from '@shared/worker-message'
import { resolveAgentPiResourceSnapshot } from '@shared/agent-composer'
import type { PiResourceCenterSnapshot } from '@shared/pi-resource-center'
import { sqliteIndex } from '../main/sqlite-index'
import { ensureAgentVersion, profileAtAgentVersion, requireAgentVersion } from '../main/agent-version-service'
import {
  buildAgentPromptLoaderOverrides,
  buildAgentResourceLoaderOverrides,
  buildAgentToolsOverride,
} from '../worker/agent-profile-runtime'
import { createSkillDiscoveryRuntime } from '../worker/skill-discovery'
import { createContextGovernor } from '../worker/context-governor'
import { buildPromptContract, createPromptContractObserver } from '../worker/prompt-manifest'
import { getRuntimeVersion } from './runtime-paths'
import { resolveRuntimePermission } from './permission-policy'
import { RuntimeStore } from './runtime-store'

type ActiveRun = { session: AgentSession; cancelled: boolean }
type RuntimeEventListener = (event: RuntimeEventEnvelopeV1) => void

const EMPTY_METRICS = {
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: 0,
  toolCalls: 0,
  failedToolCalls: 0,
}

function piVersion(): string {
  try {
    const root = new URL('../../node_modules/@earendil-works/pi-coding-agent/package.json', import.meta.url)
    const path = fileURLToPath(root)
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as { version?: string }
    return manifest.version || '0.84.4'
  } catch {
    return '0.84.4'
  }
}

function splitModelKey(value: string): { provider: string; modelId: string } {
  const separator = value.indexOf('/')
  if (separator <= 0 || separator === value.length - 1) throw new Error(`INVALID_MODEL_ID:${value}`)
  return { provider: value.slice(0, separator), modelId: value.slice(separator + 1) }
}

function normalizedTools(values: readonly string[] | undefined): string[] | undefined {
  if (values === undefined) return undefined
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))]
}

function profileSnapshot(profile: AgentProfile, versionId?: string): AgentProfileSnapshot {
  const version = versionId
    ? requireAgentVersion(versionId, profile.id)
    : ensureAgentVersion(profile)
  const resolved = profileAtAgentVersion(profile, version)
  return {
    profileId: resolved.id,
    versionId: version.id,
    versionNumber: version.number,
    versionDigest: version.digest,
    name: resolved.name,
    description: resolved.description,
    systemPrompt: resolved.systemPrompt,
    promptMode: resolved.promptMode,
    modelId: resolved.modelId,
    thinkingLevel: resolved.thinkingLevel,
    tools: resolved.tools,
    extensionTools: resolved.extensionTools,
    providerRequirements: resolved.providerRequirements,
    capturedAt: Date.now(),
  }
}

function resourceName(kind: string, path: string): string {
  const leaf = basename(path)
  if (kind === 'skills' && leaf.toLowerCase() === 'skill.md') {
    const parts = path.replace(/\\/g, '/').split('/')
    return parts.at(-2) || leaf
  }
  return extname(leaf) ? basename(leaf, extname(leaf)) : leaf
}

async function resolveHeadlessResourceSnapshot(
  snapshot: AgentProfileSnapshot,
  workspacePath: string,
  services: pi.AgentSessionServices,
): Promise<AgentProfileSnapshot> {
  const selection = sqliteIndex.getAgentProfile(snapshot.profileId)?.resourceSelection
  if (!selection) return snapshot
  const manager = new pi.DefaultPackageManager({
    cwd: workspacePath,
    agentDir: services.agentDir,
    settingsManager: services.settingsManager,
  })
  const packages = manager.listConfiguredPackages()
  let resolved: ResolvedPaths = { extensions: [], skills: [], prompts: [], themes: [] }
  try { resolved = await manager.resolve(async () => 'skip') } catch { /* diagnostics surface later */ }
  const rows = (['extensions', 'skills', 'prompts', 'themes'] as const).flatMap((kind) =>
    resolved[kind].map((row) => ({
      id: `${kind}:${row.metadata.scope}:${row.path}`,
      kind,
      name: resourceName(kind, row.path),
      path: row.path,
      source: row.metadata.source,
      scope: row.metadata.scope,
      origin: row.metadata.origin,
      enabled: row.enabled,
      packageId: row.metadata.origin === 'package'
        ? `${row.metadata.scope}:${row.metadata.source}`
        : undefined,
      configurable: false,
    })),
  )
  const catalog: PiResourceCenterSnapshot = {
    generatedAt: Date.now(),
    workspacePath,
    runtime: { sdkVersion: piVersion(), workerLoaded: false, projectTrusted: services.settingsManager.isProjectTrusted() },
    summary: {
      packages: packages.length,
      installedPackages: packages.filter((pkg) => !!pkg.installedPath).length,
      extensions: resolved.extensions.length,
      skills: resolved.skills.length,
      prompts: resolved.prompts.length,
      themes: resolved.themes.length,
      enabledResources: rows.filter((row) => row.enabled).length,
      projectResources: rows.filter((row) => row.scope === 'project').length,
    },
    packages: packages.map((pkg) => ({
      id: `${pkg.scope}:${pkg.source}`,
      source: pkg.source,
      name: pkg.source,
      scope: pkg.scope,
      type: pkg.source.startsWith('npm:') ? 'npm' : pkg.source.includes('git') ? 'git' : 'local',
      pinned: false,
      filtered: pkg.filtered,
      installed: !!pkg.installedPath,
      installedPath: pkg.installedPath,
      resources: { extensions: 0, skills: 0, prompts: 0, themes: 0 },
    })),
    resources: {
      extensions: rows.filter((row) => row.kind === 'extensions'),
      skills: rows.filter((row) => row.kind === 'skills'),
      prompts: rows.filter((row) => row.kind === 'prompts'),
      themes: rows.filter((row) => row.kind === 'themes'),
    },
    warnings: [],
  }
  const { resourceSnapshot, warnings } = resolveAgentPiResourceSnapshot(selection, catalog)
  const hard = warnings.filter((warning) =>
    warning.code === 'package-missing' || warning.code === 'resource-missing' || warning.code === 'resource-disabled')
  if (hard.length) throw new Error(`AGENT_PI_RESOURCES_UNMET:${hard.map((warning) => warning.code).join(',')}`)
  return { ...snapshot, resourceSnapshot }
}

export class VizrunaHeadlessRuntime {
  readonly store: RuntimeStore
  private readonly active = new Map<string, ActiveRun>()
  private readonly listeners = new Set<RuntimeEventListener>()
  private readonly compactionTransactions = new Map<string, { id: string; startedAt: number }>()
  private eventId: number

  constructor(store = new RuntimeStore()) {
    this.store = store
    this.eventId = store.nextEventId()
  }

  capabilities(): RuntimeCapabilityManifest {
    return {
      rpcVersion: VIZRUNA_RUNTIME_RPC_VERSION,
      productVersion: getRuntimeVersion(),
      piRuntimeVersion: piVersion(),
      permissionModes: ['observe', 'collaborate', 'autonomous'],
      capabilities: [
        'agent.list', 'run.start', 'run.list', 'run.status', 'run.stop',
        'run.events.resume', 'permission.explain', 'evidence.export', 'evaluation.run', 'evaluation.status',
        'pi.skills', 'pi.extensions', 'pi.prompts', 'pi.packages',
      ],
    }
  }

  listAgents(includeArchived = false): AgentProfile[] {
    return sqliteIndex.listAgentProfiles({ includeArchived })
  }

  subscribe(listener: RuntimeEventListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(type: string, data: Record<string, unknown>, runId?: string): RuntimeEventEnvelopeV1 {
    const event: RuntimeEventEnvelopeV1 = {
      id: this.eventId++, timestamp: Date.now(), type, ...(runId ? { runId } : {}), data,
    }
    this.store.appendEvent(event)
    for (const listener of this.listeners) listener(event)
    return event
  }

  private save(run: RuntimeRunRecord, patch: Partial<RuntimeRunRecord>): RuntimeRunRecord {
    return this.store.saveRun({ ...run, ...patch, updatedAt: Date.now() })
  }

  startRun(request: RuntimeRunStartRequest): RuntimeRunRecord {
    const workspacePath = request.workspacePath?.trim()
    const prompt = request.prompt?.trim()
    if (!workspacePath || !existsSync(workspacePath) || !statSync(workspacePath).isDirectory()) {
      throw new Error('WORKSPACE_NOT_FOUND')
    }
    if (!prompt) throw new Error('PROMPT_REQUIRED')
    const profile = request.agentId ? sqliteIndex.getAgentProfile(request.agentId) : null
    if (request.agentId && !profile) throw new Error('AGENT_NOT_FOUND')
    if (profile?.status === 'archived') throw new Error('AGENT_ARCHIVED')
    const snapshot = profile ? profileSnapshot(profile, request.agentVersionId) : undefined
    const permission = resolveRuntimePermission({
      mode: request.permissionMode,
      requestedTools: normalizedTools(snapshot?.tools),
      approvedTools: request.approvedTools,
    })
    const now = Date.now()
    const run: RuntimeRunRecord = {
      id: randomUUID(), workspacePath, prompt,
      agentId: snapshot?.profileId, agentVersionId: snapshot?.versionId, agentName: snapshot?.name,
      modelId: request.modelId || snapshot?.modelId,
      thinkingLevel: request.thinkingLevel || snapshot?.thinkingLevel,
      piRuntimeVersion: piVersion(), status: 'queued', permission,
      createdAt: now, updatedAt: now,
      metrics: { ...EMPTY_METRICS }, tools: [], artifacts: [],
    }
    this.store.saveRun(run)
    this.store.audit({ action: 'run.start', outcome: 'accepted', runId: run.id, workspacePath, permission })
    this.emit('run.queued', { status: run.status, permission }, run.id)
    void this.execute(run, snapshot)
    return run
  }

  private async execute(initial: RuntimeRunRecord, initialSnapshot?: AgentProfileSnapshot): Promise<void> {
    let run = this.save(initial, { status: 'starting', startedAt: Date.now() })
    this.emit('run.starting', { status: run.status }, run.id)
    let session: AgentSession | null = null
    let unsubscribe: (() => void) | undefined
    try {
      const baseServices = await pi.createAgentSessionServices({ cwd: run.workspacePath })
      const snapshot = initialSnapshot
        ? await resolveHeadlessResourceSnapshot(initialSnapshot, run.workspacePath, baseServices)
        : undefined
      const skillDiscovery = createSkillDiscoveryRuntime(
        snapshot || null,
        buildAgentResourceLoaderOverrides(snapshot || null),
        { agentDir: baseServices.agentDir },
      )
      const contextGovernor = createContextGovernor(baseServices.agentDir)
      let compiledSystemPrompt: string | undefined
      const promptObserver = createPromptContractObserver((systemPrompt) => {
        compiledSystemPrompt = systemPrompt
      })
      const services = snapshot
        ? await pi.createAgentSessionServices({
            cwd: run.workspacePath,
            agentDir: baseServices.agentDir,
            modelRuntime: baseServices.modelRuntime,
            settingsManager: baseServices.settingsManager,
            resourceLoaderOptions: {
              extensionFactories: [contextGovernor.extension, promptObserver],
              ...skillDiscovery.resourceLoaderOptions,
              ...buildAgentPromptLoaderOverrides(snapshot),
            },
          })
        : await pi.createAgentSessionServices({
            cwd: run.workspacePath,
            agentDir: baseServices.agentDir,
            modelRuntime: baseServices.modelRuntime,
            settingsManager: baseServices.settingsManager,
            resourceLoaderOptions: {
              extensionFactories: [contextGovernor.extension, promptObserver],
              ...skillDiscovery.resourceLoaderOptions,
            },
          })
      let model
      if (run.modelId) {
        const key = splitModelKey(run.modelId)
        model = services.modelRuntime.getModel(key.provider, key.modelId)
        if (!model) throw new Error(`MODEL_NOT_FOUND:${run.modelId}`)
      }
      const selectedExtensionTools = services.resourceLoader.getExtensions().extensions
        .flatMap((extension) => [...extension.tools.keys()])
      const profileTools = buildAgentToolsOverride(snapshot || null, selectedExtensionTools).tools
      const requestedTools = profileTools ?? run.permission.requestedTools
      const permission = resolveRuntimePermission({
        mode: run.permission.mode,
        requestedTools,
        approvedTools: run.permission.approvedTools,
      })
      const created = await pi.createAgentSessionFromServices({
        services,
        sessionManager: pi.SessionManager.create(run.workspacePath),
        model,
        thinkingLevel: run.thinkingLevel as Parameters<typeof pi.createAgentSession>[0] extends { thinkingLevel?: infer T } ? T : never,
        tools: skillDiscovery.mode === 'on-demand'
          ? [...new Set([...permission.allowedTools, 'skill_search', 'skill_load'])]
          : permission.allowedTools,
        customTools: skillDiscovery.customTools,
      })
      session = created.session
      this.active.set(run.id, { session, cancelled: false })
      run = this.save(run, {
        status: 'running', permission,
        sessionId: session.sessionId, sessionFile: session.sessionFile,
        modelId: session.model ? `${session.model.provider}/${session.model.id}` : run.modelId,
        thinkingLevel: session.thinkingLevel,
        promptContract: buildPromptContract({
          text: session.systemPrompt || '',
          appendParts: session.resourceLoader.getAppendSystemPrompt(),
          activeTools: session.getActiveToolNames(),
          profile: snapshot || null,
          skillDiscovery: skillDiscovery.snapshot(),
        }),
        skillRuntime: (() => {
          const value = skillDiscovery.snapshot()
          return {
            mode: value.mode,
            catalogDigest: value.catalogDigest,
            indexedCount: value.indexedCount,
            searchCount: value.searchCount,
            loadCount: value.loadCount,
            loadedSkills: value.loadedSkills,
          }
        })(),
        contextGovernor: contextGovernor.snapshot(),
      })
      this.emit('run.running', {
        status: run.status, sessionId: run.sessionId, sessionFile: run.sessionFile,
        modelId: run.modelId, thinkingLevel: run.thinkingLevel,
        activeTools: session.getActiveToolNames(),
      }, run.id)
      unsubscribe = session.subscribe((event) => this.consumePiEvent(run.id, event))
      await session.prompt(run.prompt)
      if (compiledSystemPrompt) {
        const current = this.store.getRun(run.id) || run
        run = this.save(current, {
          promptContract: buildPromptContract({
            text: compiledSystemPrompt,
            appendParts: session.resourceLoader.getAppendSystemPrompt(),
            activeTools: session.getActiveToolNames(),
            profile: snapshot || null,
            skillDiscovery: skillDiscovery.snapshot(),
          }),
        })
      }
      await session.waitForIdle()
      const active = this.active.get(run.id)
      if (active?.cancelled) {
        run = this.save(this.store.getRun(run.id) || run, { status: 'cancelled', completedAt: Date.now() })
        this.emit('run.cancelled', { status: run.status }, run.id)
      } else {
        const lastAssistant = [...session.messages].reverse().find((message) => message.role === 'assistant') as PiSessionMessage | undefined
        const outputText = lastAssistant ? extractTextFromPiMessage(lastAssistant) : ''
        run = this.save(this.store.getRun(run.id) || run, {
          status: 'completed', outputText, completedAt: Date.now(),
          skillRuntime: (() => {
            const value = skillDiscovery.snapshot()
            return {
              mode: value.mode,
              catalogDigest: value.catalogDigest,
              indexedCount: value.indexedCount,
              searchCount: value.searchCount,
              loadCount: value.loadCount,
              loadedSkills: value.loadedSkills,
            }
          })(),
          contextGovernor: contextGovernor.snapshot(),
        })
        this.emit('run.completed', { status: run.status, outputText }, run.id)
        this.store.audit({ action: 'run.finish', outcome: 'success', runId: run.id })
      }
    } catch (error) {
      const active = this.active.get(run.id)
      const cancelled = active?.cancelled === true
      run = this.save(this.store.getRun(run.id) || run, {
        status: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? undefined : error instanceof Error ? error.message : String(error),
        completedAt: Date.now(),
      })
      this.emit(cancelled ? 'run.cancelled' : 'run.failed', {
        status: run.status, ...(run.error ? { error: run.error } : {}),
      }, run.id)
      this.store.audit({ action: 'run.finish', outcome: cancelled ? 'cancelled' : 'failed', runId: run.id, error: run.error })
    } finally {
      unsubscribe?.()
      this.active.delete(run.id)
      try { session?.dispose() } catch { /* already disposed */ }
    }
  }

  private consumePiEvent(runId: string, event: AgentSessionEvent): void {
    const raw = event as unknown as Record<string, unknown>
    if (event.type === 'message_update' || event.type === 'message_end') {
      const message = raw.message as PiSessionMessage | undefined
      if (message?.role === 'assistant') {
        const text = extractTextFromPiMessage(message)
        if (text) this.emit('assistant.output', { phase: event.type === 'message_end' ? 'end' : 'delta', text }, runId)
      }
    }
    if (event.type === 'turn_end') {
      const totals = piUsageTotals(
        raw.message
          ? (raw.message as PiSessionMessage).usage as Parameters<typeof piUsageTotals>[0]
          : undefined,
      )
      if (totals) {
        const current = this.store.getRun(runId)
        if (!current) return
        this.store.saveRun({
          ...current,
          metrics: {
            ...current.metrics,
            inputTokens: current.metrics.inputTokens + totals.input,
            outputTokens: current.metrics.outputTokens + totals.output,
            cacheReadTokens: current.metrics.cacheReadTokens + totals.cacheRead,
            cacheWriteTokens: current.metrics.cacheWriteTokens + totals.cacheWrite,
            cost: current.metrics.cost + totals.cost,
          },
          updatedAt: Date.now(),
        })
      }
    }
    if (event.type === 'tool_execution_start') {
      const current = this.store.getRun(runId)
      if (!current) return
      const tool = {
        id: String(raw.toolCallId || randomUUID()), name: String(raw.toolName || 'unknown'),
        status: 'running' as const, startedAt: Date.now(),
      }
      this.store.saveRun({
        ...current,
        metrics: { ...current.metrics, toolCalls: current.metrics.toolCalls + 1 },
        tools: [...current.tools, tool], updatedAt: Date.now(),
      })
      this.emit('tool.start', { toolCallId: tool.id, toolName: tool.name }, runId)
    }
    if (event.type === 'tool_execution_end') {
      const current = this.store.getRun(runId)
      if (!current) return
      const id = String(raw.toolCallId || '')
      const isError = raw.isError === true
      const args = raw.args as { path?: unknown } | undefined
      const path = typeof args?.path === 'string' ? args.path : undefined
      this.store.saveRun({
        ...current,
        metrics: {
          ...current.metrics,
          failedToolCalls: current.metrics.failedToolCalls + (isError ? 1 : 0),
        },
        tools: current.tools.map((tool) => tool.id === id
          ? { ...tool, status: isError ? 'failed' : 'completed', completedAt: Date.now() }
          : tool),
        artifacts: path ? [...new Set([...current.artifacts, path])] : current.artifacts,
        updatedAt: Date.now(),
      })
      this.emit('tool.end', { toolCallId: id, toolName: String(raw.toolName || ''), isError, ...(path ? { path } : {}) }, runId)
    }
    if (event.type === 'compaction_start') {
      const transaction = { id: randomUUID(), startedAt: Date.now() }
      this.compactionTransactions.set(runId, transaction)
      this.emit('context.compaction_start', transaction, runId)
    }
    if (event.type === 'compaction_end') {
      const transaction = this.compactionTransactions.get(runId)
      const completedAt = Date.now()
      const error = typeof raw.errorMessage === 'string' ? raw.errorMessage : undefined
      const status = raw.aborted === true ? 'aborted' : error ? 'failed' : 'completed'
      const data = {
        transactionId: transaction?.id,
        startedAt: transaction?.startedAt,
        completedAt,
        status,
        ...(error ? { error } : {}),
      }
      try {
        this.active.get(runId)?.session.sessionManager.appendCustomEntry('vizruna.context.compaction', data)
      } catch { /* the runtime event store remains authoritative */ }
      this.compactionTransactions.delete(runId)
      this.emit('context.compaction_end', data, runId)
    }
  }

  getRun(id: string): RuntimeRunRecord {
    const run = this.store.getRun(id)
    if (!run) throw new Error('RUN_NOT_FOUND')
    return run
  }

  listRuns(limit = 50): RuntimeRunRecord[] {
    return this.store.listRuns(limit)
  }

  async stopRun(id: string): Promise<RuntimeRunRecord> {
    const run = this.getRun(id)
    const active = this.active.get(id)
    if (!active) return run
    active.cancelled = true
    await active.session.abort()
    this.store.audit({ action: 'run.stop', outcome: 'accepted', runId: id })
    return this.getRun(id)
  }

  async waitForRun(id: string, timeoutMs = 30 * 60_000): Promise<RuntimeRunRecord> {
    const started = Date.now()
    for (;;) {
      const run = this.getRun(id)
      if (['completed', 'failed', 'cancelled'].includes(run.status)) return run
      if (Date.now() - started > timeoutMs) throw new Error('RUN_WAIT_TIMEOUT')
      await new Promise((resolve) => setTimeout(resolve, 100))
    }
  }

  exportEvidence(id: string, includeContent = false): RuntimeEvidenceBundleV1 {
    const run = this.getRun(id)
    const { prompt: _prompt, outputText: _output, ...safe } = run
    return {
      schemaVersion: 1,
      exportedAt: Date.now(),
      run: includeContent ? run : safe,
      events: this.store.listEvents({ runId: id, limit: 5_000 }),
      redactions: includeContent ? ['credentials', 'hidden_reasoning'] : ['prompt', 'outputText', 'credentials', 'hidden_reasoning'],
    }
  }

  startEvaluation(suiteId: string, permissionMode: RuntimeRunStartRequest['permissionMode'] = 'collaborate'): RuntimeEvaluationRecordV1 {
    const suite = sqliteIndex.getAgentEvaluationSuite(suiteId)
    if (!suite) throw new Error('EVALUATION_SUITE_NOT_FOUND')
    const scenarios = sqliteIndex.listAgentEvaluationScenarios(suite.id)
    if (!scenarios.length) throw new Error('EVALUATION_SUITE_EMPTY')
    const now = Date.now()
    const evaluation: RuntimeEvaluationRecordV1 = {
      id: randomUUID(), suiteId: suite.id, suiteName: suite.name,
      agentId: suite.profileId, agentVersionId: suite.versionId,
      workspacePath: suite.workspacePath, status: 'queued',
      items: scenarios.map((scenario) => ({
        scenarioId: scenario.id, scenarioName: scenario.name, status: 'queued',
      })),
      createdAt: now,
    }
    this.store.saveEvaluation(evaluation)
    void this.executeEvaluation(evaluation, suite, permissionMode)
    return evaluation
  }

  private async executeEvaluation(
    initial: RuntimeEvaluationRecordV1,
    suite: AgentEvaluationSuite,
    permissionMode: RuntimeRunStartRequest['permissionMode'],
  ): Promise<void> {
    let evaluation = this.store.saveEvaluation({ ...initial, status: 'running', startedAt: Date.now() })
    this.emit('evaluation.running', { evaluationId: evaluation.id, suiteId: suite.id })
    for (const scenario of sqliteIndex.listAgentEvaluationScenarios(suite.id)) {
      try {
        const run = this.startRun({
          workspacePath: suite.workspacePath,
          prompt: scenario.prompt,
          agentId: suite.profileId,
          agentVersionId: suite.versionId,
          permissionMode,
        })
        evaluation = this.store.saveEvaluation({
          ...evaluation,
          items: evaluation.items.map((item) => item.scenarioId === scenario.id
            ? { ...item, runId: run.id, status: 'running' }
            : item),
        })
        const completed = await this.waitForRun(run.id)
        evaluation = this.store.saveEvaluation({
          ...evaluation,
          items: evaluation.items.map((item) => item.scenarioId === scenario.id
            ? { ...item, status: completed.status, error: completed.error }
            : item),
        })
      } catch (error) {
        evaluation = this.store.saveEvaluation({
          ...evaluation,
          items: evaluation.items.map((item) => item.scenarioId === scenario.id
            ? { ...item, status: 'failed', error: error instanceof Error ? error.message : String(error) }
            : item),
        })
      }
    }
    const failed = evaluation.items.some((item) => item.status === 'failed')
    evaluation = this.store.saveEvaluation({
      ...evaluation, status: failed ? 'failed' : 'completed', completedAt: Date.now(),
    })
    this.emit('evaluation.completed', { evaluationId: evaluation.id, status: evaluation.status })
  }

  getEvaluation(id: string): RuntimeEvaluationRecordV1 {
    const value = this.store.getEvaluation(id)
    if (!value) throw new Error('EVALUATION_NOT_FOUND')
    return value
  }

  createServerToken(): string {
    return randomBytes(32).toString('base64url')
  }
}
