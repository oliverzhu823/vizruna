import type { ConversationRuntimeSnapshot } from '@shared/system-prompt-preset'
import type {
  LoadExtensionsResult,
  PromptTemplate,
  ResourceDiagnostic,
  Skill,
} from '@earendil-works/pi-coding-agent'

export type AgentPromptLoaderOverrides = {
  systemPromptOverride?: () => string
  appendSystemPromptOverride?: (base: string[]) => string[]
}

export type AgentResourceLoaderOverrides = {
  noContextFiles?: boolean
  extensionsOverride?: (base: LoadExtensionsResult) => LoadExtensionsResult
  skillsOverride?: (base: {
    skills: Skill[]
    diagnostics: ResourceDiagnostic[]
  }) => { skills: Skill[]; diagnostics: ResourceDiagnostic[] }
  promptsOverride?: (base: {
    prompts: PromptTemplate[]
    diagnostics: ResourceDiagnostic[]
  }) => { prompts: PromptTemplate[]; diagnostics: ResourceDiagnostic[] }
}

const normalizeResourcePath = (path: string): string =>
  path.replace(/\\/g, '/').replace(/\/+$/, '')

function pathMatchesSelection(path: string, allowedPaths: Set<string>): boolean {
  const candidate = normalizeResourcePath(path)
  for (const allowed of allowedPaths) {
    if (
      candidate === allowed ||
      candidate.startsWith(`${allowed}/`) ||
      allowed.startsWith(`${candidate}/`)
    ) return true
  }
  return false
}

/** Restrict Pi's already-resolved native resources to the immutable Agent snapshot. */
export function buildAgentResourceLoaderOverrides(
  profile: ConversationRuntimeSnapshot | null,
): AgentResourceLoaderOverrides {
  if (!profile || !('profileId' in profile) || !profile.resourceSnapshot) return {}
  const snapshot = profile.resourceSnapshot
  const contextOverride =
    snapshot.projectContext === 'none' ? { noContextFiles: true as const } : {}
  if (snapshot.mode === 'inherit') return contextOverride

  const paths = {
    extensions: new Set(
      snapshot.resources
        .filter((resource) => resource.kind === 'extensions')
        .map((resource) => normalizeResourcePath(resource.path)),
    ),
    skills: new Set(
      snapshot.resources
        .filter((resource) => resource.kind === 'skills')
        .map((resource) => normalizeResourcePath(resource.path)),
    ),
    prompts: new Set(
      snapshot.resources
        .filter((resource) => resource.kind === 'prompts')
        .map((resource) => normalizeResourcePath(resource.path)),
    ),
  }

  return {
    ...contextOverride,
    extensionsOverride: (base) => ({
      ...base,
      extensions: base.extensions.filter((extension) =>
        [extension.path, extension.resolvedPath, extension.sourceInfo.path].some((path) =>
          pathMatchesSelection(path, paths.extensions),
        ),
      ),
      errors: base.errors.filter((error) =>
        pathMatchesSelection(error.path, paths.extensions),
      ),
    }),
    skillsOverride: (base) => ({
      ...base,
      skills: base.skills.filter((skill) =>
        pathMatchesSelection(skill.filePath, paths.skills),
      ),
    }),
    promptsOverride: (base) => ({
      ...base,
      prompts: base.prompts.filter((prompt) =>
        pathMatchesSelection(prompt.filePath, paths.prompts),
      ),
    }),
  }
}

/**
 * Translate the persisted Agent snapshot into Pi's native prompt hooks.
 * Keeping this pure makes the two supported prompt modes independently testable.
 */
export function buildAgentPromptLoaderOverrides(
  profile: ConversationRuntimeSnapshot | null,
): AgentPromptLoaderOverrides {
  if (!profile) return {}
  if (profile.promptMode === 'replace') {
    return { systemPromptOverride: () => profile.systemPrompt }
  }
  return {
    appendSystemPromptOverride: (base) => [...base, profile.systemPrompt],
  }
}

export function buildAgentToolsOverride(
  profile: ConversationRuntimeSnapshot | null,
  selectedExtensionTools: string[] = [],
): { tools?: string[] } {
  if (!profile || !('tools' in profile) || profile.tools === undefined) return {}
  const includeSelectedExtensionTools =
    'profileId' in profile && profile.resourceSnapshot?.mode === 'selected'
  const permittedExtensionTools =
    includeSelectedExtensionTools && 'extensionTools' in profile && profile.extensionTools !== undefined
      ? selectedExtensionTools.filter((tool) => profile.extensionTools?.includes(tool))
      : selectedExtensionTools
  return {
    tools: [
      ...new Set([
        ...profile.tools,
        ...(includeSelectedExtensionTools ? permittedExtensionTools : []),
      ]),
    ],
  }
}
