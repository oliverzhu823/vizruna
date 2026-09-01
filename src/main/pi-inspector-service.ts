import { basename } from 'node:path'
import { existsSync } from 'node:fs'
import type {
  PiInspectorContextSource,
  PiInspectorNamedResource,
  PiInspectorRequest,
  PiInspectorScope,
  PiInspectorSnapshot,
  PiPromptDocumentResponse,
  PiPromptManifestSection,
} from '@shared/pi-inspector'
import type { ConversationConfigBinding } from '@shared/system-prompt-preset'
import type { ProviderRoutingConfig } from '@shared/provider-routing'
import type {
  WorkerCommandInfo,
  WorkerPromptTemplate,
  WorkerResponsePayload,
  WorkerSkillInfo,
  WorkerState,
} from '@shared/worker-rpc-types'
import { configStore } from './config-store'
import { probeExtensions, type ExtensionProbeResult } from '../extension-compat/extension-probe'
import { getConversationConfigBinding } from './system-prompt-preset-service'
import { readPiInfo, type PiInfo } from './pi-info'
import { readPiAgentGlobalSettingsFromDisk } from './pi-agent-settings-read'
import { getProviderRoutingService } from './provider-routing/provider-routing-service'
import { workerManager } from './worker-manager'
import { listSkillsOnDisk, skillStorageKey } from './pi-resources-editor'
import { getDesktopSkillOverrides, isSkillEnabled } from './pi-skill-overrides'
import {
  listAgentsContextFiles,
  listPiBuiltinPromptFiles,
  type PromptCatalogItem,
} from './pi-prompt-catalog'

export type InspectorFacts = {
  generatedAt: number
  workspacePath: string
  request: PiInspectorRequest
  piInfo: PiInfo
  runtimeState: WorkerState
  persistedSession?: {
    model?: string
    thinkingLevel?: string
    messageCount?: number
  }
  contextPrompts: WorkerResponsePayload
  skills: PiInspectorNamedResource[]
  prompts: WorkerPromptTemplate[]
  extensions: ExtensionProbeResult[]
  commands: WorkerCommandInfo[]
  packages: PiInspectorNamedResource[]
  routeConfig: ProviderRoutingConfig
  binding: ConversationConfigBinding | null
  contextCatalog: PromptCatalogItem[]
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function nonEmpty(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : ''
  return text || undefined
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.map(nonEmpty).filter((item): item is string => !!item)
}

function sourceScope(value: unknown): PiInspectorScope {
  const source = String(value || '').toLowerCase()
  if (source.includes('global') || source.includes('.pi/agent')) return 'global'
  if (source.includes('project') || source.includes('.pi/')) return 'project'
  if (source.includes('package') || source.includes('npm:') || source.includes('git:')) {
    return 'package'
  }
  if (source.includes('runtime') || source.includes('worker')) return 'runtime'
  return 'unknown'
}

function contextSources(
  catalog: PromptCatalogItem[],
  binding: ConversationConfigBinding | null,
): PiInspectorContextSource[] {
  const sources: PiInspectorContextSource[] = catalog
    .filter((item) => item.inSystemContext && (item.readOnly || (!!item.path && existsSync(item.path))))
    .map((item) => ({
      kind:
        item.category === 'agents_context'
          ? 'agents'
          : item.id.includes(':append:')
            ? 'append'
            : 'system',
      label: item.path ? basename(item.path) : item.name,
      path: item.path || undefined,
      mode: item.id.includes(':append:') ? 'append' : undefined,
    }))

  if (binding) {
    const snapshot = binding.snapshot
    sources.push({
      kind: binding.kind === 'agent' ? 'agent-profile' : 'prompt-preset',
      label: snapshot.name,
      mode: snapshot.promptMode,
      charCount: snapshot.systemPrompt.length,
    })
  }
  return sources
}

function packagesFromSettings(settings: Record<string, unknown> | null): PiInspectorNamedResource[] {
  if (!Array.isArray(settings?.packages)) return []
  const seen = new Set<string>()
  const rows: PiInspectorNamedResource[] = []
  for (const entry of settings.packages) {
    const value = typeof entry === 'string' ? entry : nonEmpty(record(entry).source)
    if (!value || seen.has(value)) continue
    seen.add(value)
    const name = value
      .replace(/^(npm:|git:)/, '')
      .replace(/@[^/@]+$/, '')
      .replace(/\.git$/, '')
      .split('/')
      .filter(Boolean)
      .at(-1) || value
    rows.push({
      id: value,
      name,
      description: value,
      source: 'package',
      enabled: true,
      // A package entry proves configuration, not that the current Worker
      // successfully loaded every resource from it. Runtime resources below
      // carry their own observed loaded state.
      loaded: false,
    })
  }
  return rows
}

function effectiveSkills(
  workspacePath: string,
  workerSkills: WorkerSkillInfo[],
): PiInspectorNamedResource[] {
  const overrides = getDesktopSkillOverrides()
  const rows = new Map<string, PiInspectorNamedResource>()
  for (const skill of listSkillsOnDisk(workspacePath)) {
    const key = skillStorageKey(skill.name, skill.path)
    rows.set(key, {
      id: key,
      name: skill.name,
      description: skill.description,
      source: sourceScope(skill.source),
      path: skill.path,
      enabled: isSkillEnabled(skill.name, skill.path, overrides),
      loaded: false,
      commands: [`/skill:${skill.name}`],
    })
  }
  for (const skill of workerSkills) {
    const path = nonEmpty(skill.path)
    const key = skillStorageKey(skill.name, path)
    const existing = rows.get(key)
    rows.set(key, {
      id: key,
      name: skill.name,
      description: skill.description || existing?.description,
      source: sourceScope(skill.source || existing?.source),
      path: path || existing?.path,
      enabled: true,
      loaded: true,
      commands: [`/skill:${skill.name}`],
    })
  }
  return [...rows.values()]
}

export function buildPiInspectorSnapshot(facts: InspectorFacts): PiInspectorSnapshot {
  const runtime = record(facts.runtimeState)
  const sessionId = nonEmpty(runtime.sessionId) || facts.request.sessionId
  const sessionFile = nonEmpty(runtime.sessionFile) || facts.request.sessionFile
  const model = nonEmpty(runtime.model) || nonEmpty(facts.persistedSession?.model)
  const provider = model?.includes('/') ? model.slice(0, model.indexOf('/')) : undefined
  const runtimeTools = Array.isArray(runtime.tools) ? runtime.tools.map(record) : []
  const loaded = !!nonEmpty(runtime.sessionId)
  const toolNames = new Set(runtimeTools.map((tool) => nonEmpty(tool.name)).filter(Boolean) as string[])
  const commandNames = new Set(
    facts.commands
      .map((command) => nonEmpty(command.name)?.replace(/^\//, ''))
      .filter(Boolean) as string[],
  )

  const extensions = facts.extensions.map<PiInspectorNamedResource>((extension) => {
    const enabled = extension.piEnabled ?? extension.enabled
    const registeredToolLoaded = extension.registeredTools.some((tool) => toolNames.has(tool))
    const registeredCommandLoaded = extension.registeredCommands.some((command) =>
      commandNames.has(command.replace(/^\//, '')),
    )
    const hasRuntimeSignature =
      extension.registeredTools.length > 0 || extension.registeredCommands.length > 0
    return {
      id: extension.id,
      name: extension.name,
      description: extension.description,
      source: sourceScope(extension.source),
      path: extension.mainFilePath || extension.packageRoot,
      version: extension.version,
      enabled,
      loaded:
        loaded &&
        enabled &&
        (registeredToolLoaded ||
          registeredCommandLoaded ||
          (!hasRuntimeSignature && extension.inSettingsPackages === true)),
      tools: extension.registeredTools,
      commands: extension.registeredCommands.map((command) => `/${command.replace(/^\//, '')}`),
      error: extension.loadError || extension.workerLoadHint,
    }
  })

  const prompts = facts.prompts.map<PiInspectorNamedResource>((prompt) => ({
    id: nonEmpty(prompt.path) || prompt.name,
    name: prompt.name,
    description: prompt.description,
    source: sourceScope(record(prompt.sourceInfo).source || prompt.source),
    path: nonEmpty(prompt.path),
    enabled: true,
    loaded: true,
    commands: [`/${prompt.name}`],
  }))

  const binding = facts.binding
  const configuration: PiInspectorSnapshot['configuration'] = binding
    ? {
        kind: binding.kind,
        name: binding.snapshot.name,
        description: binding.snapshot.description,
        mode: binding.snapshot.promptMode,
        capturedAt: binding.snapshot.capturedAt,
        toolsMode:
          binding.kind === 'agent'
            ? binding.snapshot.tools === undefined
              ? 'inherited'
              : 'custom'
            : 'runtime',
        extensionToolsMode:
          binding.kind === 'agent' && binding.snapshot.tools !== undefined
            ? binding.snapshot.extensionTools === undefined
              ? 'all-selected'
              : 'custom'
            : 'runtime',
        extensionToolCount:
          binding.kind === 'agent' && binding.snapshot.extensionTools !== undefined
            ? binding.snapshot.extensionTools.length
            : undefined,
        resourceMode:
          binding.kind === 'agent'
            ? binding.snapshot.resourceSnapshot?.mode ?? 'inherit'
            : 'runtime',
        projectContextMode:
          binding.kind === 'agent'
            ? binding.snapshot.resourceSnapshot?.projectContext ?? 'inherit'
            : 'runtime',
        resolvedResourceCount:
          binding.kind === 'agent'
            ? binding.snapshot.resourceSnapshot?.resources.length
            : undefined,
        providerRequirements:
          binding.kind === 'agent' && binding.snapshot.providerRequirements
            ? { ...binding.snapshot.providerRequirements }
            : undefined,
      }
    : {
        kind: 'general',
        name: 'General Pi',
        toolsMode: 'runtime',
        extensionToolsMode: 'runtime',
        resourceMode: 'runtime',
        projectContextMode: 'runtime',
      }

  const authProvider = provider
    ? facts.piInfo.authProviders.find((item) => item.provider === provider)
    : undefined
  const route = provider
    ? facts.routeConfig.routes.find((item) => item.provider === provider)
    : undefined
  const routeProfile = route?.profileId
    ? facts.routeConfig.profiles.find((profile) => profile.id === route.profileId)
    : undefined
  const systemPromptChars = Number(facts.contextPrompts.builtSystemChars) || 0
  const estimatedTokens = Number(facts.contextPrompts.builtSystemEstimatedTokens) || Math.ceil(systemPromptChars / 4)
  const sections = Array.isArray(facts.contextPrompts.promptManifest)
    ? facts.contextPrompts.promptManifest as PiPromptManifestSection[]
    : []
  const skillDiscovery = record(facts.contextPrompts.skillDiscovery) as PiInspectorSnapshot['context']['skillDiscovery']
  const warnings: PiInspectorSnapshot['warnings'] = []
  if (!loaded) {
    warnings.push({
      code: sessionFile ? 'session-not-loaded' : 'runtime-offline',
      message: sessionFile ? 'The selected session is not loaded in a Pi worker.' : 'Pi runtime is not active.',
    })
  }
  if (loaded && !model) {
    warnings.push({ code: 'model-unselected', message: 'No effective model is selected.' })
  }
  if (authProvider && !authProvider.configured) {
    warnings.push({
      code: 'auth-missing',
      message: `No configured credential was found for ${provider}.`,
      resourceId: provider,
    })
  }
  if (facts.contextPrompts.projectTrusted === false) {
    warnings.push({
      code: 'project-untrusted',
      message: 'Project-local Pi resources are blocked until this project is trusted.',
    })
  }
  for (const extension of extensions) {
    if (extension.error && facts.extensions.find((item) => item.id === extension.id)?.loadError) {
      warnings.push({
        code: 'extension-load-error',
        message: `${extension.name}: ${extension.error}`,
        resourceId: extension.id,
      })
    } else if (extension.enabled && !extension.loaded && extension.error) {
      warnings.push({
        code: 'package-not-loaded',
        message: `${extension.name}: ${extension.error}`,
        resourceId: extension.id,
      })
    }
  }

  return {
    generatedAt: facts.generatedAt,
    workspacePath: facts.workspacePath,
    session: {
      id: sessionId,
      file: sessionFile,
      name: nonEmpty(runtime.sessionName),
      loaded,
      running: runtime.isStreaming === true,
      messageCount: Number.isFinite(Number(runtime.messageCount))
        ? Number(runtime.messageCount)
        : facts.persistedSession?.messageCount || 0,
    },
    runtime: {
      sdkVersion: facts.piInfo.sdkVersion,
      model,
      provider,
      thinkingLevel:
        nonEmpty(runtime.thinkingLevel) || nonEmpty(facts.persistedSession?.thinkingLevel),
      projectTrusted: facts.contextPrompts.projectTrusted !== false,
      auth: authProvider
        ? { configured: authProvider.configured, type: authProvider.type }
        : undefined,
      route: route
        ? {
            mode: route.mode,
            label: route.mode === 'profile' ? routeProfile?.name || 'Missing profile' : route.mode,
          }
        : provider
          ? { mode: 'system', label: 'system' }
          : undefined,
    },
    configuration,
    context: {
      sources: contextSources(facts.contextCatalog, binding),
      systemPromptChars,
      estimatedTokens,
      sections,
      skillDiscovery: skillDiscovery?.mode ? skillDiscovery : undefined,
    },
    resources: {
      tools: runtimeTools
        .map<PiInspectorNamedResource>((tool) => ({
          id: nonEmpty(tool.name) || 'unknown-tool',
          name: nonEmpty(tool.name) || 'Unknown tool',
          description: nonEmpty(tool.description),
          source: 'runtime',
          enabled: true,
          loaded: true,
        }))
        .filter((tool, index, all) => all.findIndex((row) => row.id === tool.id) === index),
      skills: facts.skills,
      extensions,
      prompts,
      packages: facts.packages,
    },
    warnings,
  }
}

export async function collectPiPromptDocument(
  request: PiInspectorRequest,
): Promise<PiPromptDocumentResponse> {
  const raw = await workerManager.getSystemPromptDocument(nonEmpty(request.sessionFile))
  return {
    text: typeof raw.text === 'string' ? raw.text : '',
    charCount: Number(raw.charCount) || 0,
    estimatedTokens: Number(raw.estimatedTokens) || 0,
    sections: Array.isArray(raw.sections)
      ? raw.sections as PiPromptManifestSection[]
      : [],
  }
}

export async function collectPiInspectorSnapshot(
  request: PiInspectorRequest,
): Promise<PiInspectorSnapshot> {
  const workspacePath =
    nonEmpty(request.workspaceId) || workerManager.cwd || configStore.get('currentProject') || process.cwd()
  const sessionFile = nonEmpty(request.sessionFile)
  const [
    runtimeState,
    rawContextPrompts,
    workerSkills,
    prompts,
    commandResult,
    routeConfig,
    persistedSession,
  ] = await Promise.all([
      workerManager.getState(sessionFile).catch(() => ({})),
      workerManager.getContextPrompts(sessionFile).catch(() => ({})),
      workerManager.getSkillsList(sessionFile).catch(() => []),
      workerManager.getPromptTemplatesList(sessionFile).catch(() => []),
      workerManager.getCommands(sessionFile).catch(() => ({ commands: [], hasSession: false })),
      getProviderRoutingService().getConfig(),
      sessionFile
        ? import('./session-messages-from-disk')
            .then(({ getSessionMessagesFromDisk }) =>
              getSessionMessagesFromDisk(sessionFile, 0, 1),
            )
            .then((page) => ({
              model: page.sessionMeta?.model,
              thinkingLevel: page.sessionMeta?.thinkingLevel,
              messageCount: page.totalCount,
            }))
            .catch(() => undefined)
        : Promise.resolve(undefined),
    ])
  const contextPrompts = rawContextPrompts as WorkerResponsePayload

  return buildPiInspectorSnapshot({
    generatedAt: Date.now(),
    workspacePath,
    request,
    piInfo: readPiInfo(),
    runtimeState,
    persistedSession,
    contextPrompts,
    skills: effectiveSkills(workspacePath, workerSkills),
    prompts,
    extensions: probeExtensions(workspacePath),
    commands: commandResult.commands,
    packages: packagesFromSettings(readPiAgentGlobalSettingsFromDisk()),
    routeConfig,
    binding: getConversationConfigBinding({
      sessionId: nonEmpty(request.sessionId),
      sessionFile,
    }),
    contextCatalog: [
      ...listAgentsContextFiles(
        workspacePath,
        contextPrompts.projectTrusted !== false,
      ),
      ...listPiBuiltinPromptFiles(
        workspacePath,
        contextPrompts.projectTrusted !== false,
      ),
    ],
  })
}
