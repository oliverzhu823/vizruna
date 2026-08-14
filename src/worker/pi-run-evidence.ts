import type { AgentSession } from '@earendil-works/pi-coding-agent'
import type {
  RunContextSnapshot,
  RunResourceEvidence,
  RunResourceItem,
} from '@shared/app-events'
import { basename } from 'node:path'

type SourceInfo = {
  path?: string
  source?: string
}

function item(name: unknown, sourceInfo?: SourceInfo, explicitPath?: unknown): RunResourceItem | null {
  const value = String(name || '').trim()
  if (!value) return null
  const path = String(explicitPath || sourceInfo?.path || '').trim()
  const source = String(sourceInfo?.source || '').trim()
  return {
    name: value,
    ...(source ? { source } : {}),
    ...(path ? { path } : {}),
  }
}

function compact(items: Array<RunResourceItem | null>): RunResourceItem[] {
  const seen = new Set<string>()
  return items.filter((value): value is RunResourceItem => {
    if (!value) return false
    const key = `${value.name}\u0000${value.path || ''}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function captureRunContextSnapshot(
  session: AgentSession | null,
  capturedAt = Date.now(),
): RunContextSnapshot | undefined {
  if (!session) return undefined
  try {
    const usage = session.getContextUsage()
    if (!usage) return undefined
    return {
      tokens: usage.tokens,
      contextWindow: usage.contextWindow,
      percent: usage.percent,
      messageCount: session.messages.length,
      capturedAt,
    }
  } catch {
    return undefined
  }
}

export function captureRunResourceEvidence(
  session: AgentSession | null,
  capturedAt = Date.now(),
): RunResourceEvidence | undefined {
  if (!session) return undefined
  try {
    const loader = session.resourceLoader
    const allTools = new Map(session.getAllTools().map((tool) => [tool.name, tool]))
    const activeTools = compact(
      session.getActiveToolNames().map((name) => {
        const tool = allTools.get(name)
        return item(name, tool?.sourceInfo)
      }),
    )
    const skills = compact(
      loader.getSkills().skills.map((skill) => item(skill.name, skill.sourceInfo, skill.filePath)),
    )
    const promptTemplates = compact(
      loader
        .getPrompts()
        .prompts.map((prompt) => item(prompt.name, prompt.sourceInfo, prompt.filePath)),
    )
    const extensions = compact(
      loader.getExtensions().extensions.map((extension) => {
        const path = extension.resolvedPath || extension.path
        return item(basename(path || extension.sourceInfo.path || 'extension'), extension.sourceInfo, path)
      }),
    )
    const contextFiles = compact(
      loader
        .getAgentsFiles()
        .agentsFiles.map((file) => item(basename(file.path), { source: 'project-context' }, file.path)),
    )
    const systemPromptSource = loader.getSystemPromptSource()
    const systemPromptSources = compact([
      systemPromptSource
        ? item(
            basename(systemPromptSource.path),
            { source: 'system-prompt' },
            systemPromptSource.path,
          )
        : null,
      ...loader
        .getAppendSystemPromptSources()
        .map((source) => item(basename(source.path), { source: 'append-system-prompt' }, source.path)),
    ])
    return {
      capturedAt,
      activeTools,
      skills,
      promptTemplates,
      extensions,
      contextFiles,
      systemPromptSources,
    }
  } catch {
    return undefined
  }
}
