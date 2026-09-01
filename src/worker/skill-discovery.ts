import { Type } from '@earendil-works/pi-ai'
import type { ResourceDiagnostic, Skill, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { ConversationRuntimeSnapshot } from '@shared/system-prompt-preset'
import type { AgentResourceLoaderOverrides } from './agent-profile-runtime.js'
import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

export type SkillDiscoveryMode = 'on-demand' | 'fixed'

export interface SkillDiscoverySnapshot {
  mode: SkillDiscoveryMode
  indexedCount: number
  promptSkillCount: number
  searchableCount: number
  catalogDigest: string
  searchCount: number
  loadCount: number
  loadedSkills: string[]
  conflicts: string[]
}

type SkillsResult = { skills: Skill[]; diagnostics: ResourceDiagnostic[] }

const normalize = (value: string): string =>
  value
    .normalize('NFKC')
    .toLocaleLowerCase()
    .replace(/[\s_./\\:]+/g, ' ')
    .replace(/[^\p{L}\p{N}\- ]/gu, '')
    .trim()

const tokens = (value: string): string[] => normalize(value).split(/\s+/).filter(Boolean)

const digest = (value: string): string =>
  `sha256:${createHash('sha256').update(value).digest('hex')}`

const stripFrontmatter = (content: string): string => {
  const normalized = content.replace(/^\uFEFF/, '')
  if (!normalized.startsWith('---')) return normalized
  const match = normalized.match(/^---\s*\r?\n[\s\S]*?\r?\n---\s*(?:\r?\n|$)/)
  return match ? normalized.slice(match[0].length) : normalized
}

const frontmatterName = (content: string): string | undefined => {
  const normalized = content.replace(/^\uFEFF/, '')
  const match = normalized.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/)
  const name = match?.[1].match(/^name:\s*["']?([^\r\n"']+)["']?\s*$/m)?.[1]?.trim()
  return name || undefined
}

const escapeAttribute = (value: string): string =>
  value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')

const catalogDigest = (skills: Skill[]): string => digest(JSON.stringify(
  skills
    .map((skill) => ({ name: skill.name, description: skill.description, path: skill.filePath }))
    .sort((a, b) => a.name.localeCompare(b.name) || a.path.localeCompare(b.path)),
))

function scoreSkill(skill: Skill, query: string): number {
  const needle = normalize(query)
  if (!needle) return 0
  const name = normalize(skill.name)
  const description = normalize(skill.description)
  let score = 0
  if (name === needle) score += 1_000
  if (name.startsWith(needle)) score += 400
  if (name.includes(needle)) score += 240
  if (description.includes(needle)) score += 120
  if (needle.includes(name)) score += 200
  for (const token of tokens(needle)) {
    if (name === token) score += 160
    else if (name.includes(token)) score += 80
    if (description.includes(token)) score += 35
  }
  return score
}

function enabledSkills(skills: Skill[], agentDir?: string): Skill[] {
  if (!agentDir) return skills
  let overrides: Record<string, boolean> = {}
  try {
    const settings = JSON.parse(readFileSync(join(agentDir, 'settings.json'), 'utf8')) as {
      desktopSkillOverrides?: Record<string, boolean>
    }
    overrides = settings.desktopSkillOverrides || {}
  } catch {
    return skills
  }
  return skills.filter((skill) => {
    const paths = new Set([skill.filePath, skill.filePath.replace(/\\/g, '/')])
    if (overrides[`name:${skill.name}`] === false) return false
    for (const path of paths) {
      if (overrides[`path:${path}`] === false) return false
    }
    return true
  })
}

function isFixedAgent(profile: ConversationRuntimeSnapshot | null): boolean {
  return !!(
    profile &&
    'profileId' in profile &&
    profile.resourceSnapshot?.mode === 'selected'
  )
}

/** Preserve Pi's native /skill:name commands while keeping the full catalogue
 * out of general system prompts. Selected Agent snapshots remain deterministic. */
export function createSkillDiscoveryRuntime(
  profile: ConversationRuntimeSnapshot | null,
  baseOverrides: AgentResourceLoaderOverrides,
  options: { agentDir?: string } = {},
) {
  const mode: SkillDiscoveryMode = isFixedAgent(profile) ? 'fixed' : 'on-demand'
  let indexedSkills: Skill[] = []
  let promptSkillCount = 0
  let searchCount = 0
  let loadCount = 0
  let conflicts: string[] = []
  const loadedSkills = new Set<string>()

  const skillsOverride = (base: SkillsResult): SkillsResult => {
    const filtered = { ...base, skills: enabledSkills(base.skills, options.agentDir) }
    const resolved = baseOverrides.skillsOverride
      ? baseOverrides.skillsOverride(filtered)
      : filtered
    indexedSkills = resolved.skills.slice()
    conflicts = resolved.diagnostics.map((diagnostic) =>
      String((diagnostic as { message?: unknown }).message || (diagnostic as { path?: unknown }).path || 'Skill diagnostic'),
    )
    if (mode === 'fixed') {
      promptSkillCount = resolved.skills.filter((skill) => !skill.disableModelInvocation).length
      return resolved
    }
    promptSkillCount = 0
    return {
      ...resolved,
      skills: resolved.skills.map((skill) => ({ ...skill, disableModelInvocation: true })),
    }
  }

  const searchTool: ToolDefinition = {
    name: 'skill_search',
    label: 'Search skills',
    description:
      'Search the trusted local Skill index by task intent. Returns compact metadata only; use skill_load with an exact name before following a result.',
    promptSnippet: 'Search trusted local Skills by task intent, then load exactly one when needed.',
    promptGuidelines: [
      'Use skill_search only when specialized instructions may materially improve the task; do not search for routine work.',
      'After choosing a result, call skill_load with its exact name before acting and load referenced files only as needed.',
    ],
    executionMode: 'parallel',
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 500 }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
    }),
    execute: async (_toolCallId, params) => {
      searchCount += 1
      const value = params as { query: string; limit?: number }
      const limit = Math.min(10, Math.max(1, Math.floor(value.limit ?? 5)))
      const matches = indexedSkills
        .filter((skill) => !skill.disableModelInvocation)
        .map((skill) => ({ skill, score: scoreSkill(skill, value.query) }))
        .filter((entry) => entry.score > 0)
        .sort((a, b) => b.score - a.score || a.skill.name.localeCompare(b.skill.name))
        .slice(0, limit)
        .map(({ skill }) => ({
          name: skill.name,
          description: skill.description,
          scope: skill.sourceInfo.scope,
        }))
      const result = {
        query: value.query,
        matches,
        instruction: matches.length
          ? 'Call skill_load with the exact chosen name before using it.'
          : 'No matching enabled Skill was found. Continue without a Skill or refine the query.',
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      }
    },
  }

  const loadTool: ToolDefinition = {
    name: 'skill_load',
    label: 'Load skill',
    description:
      'Load one enabled trusted Skill by exact name. Re-reads SKILL.md from disk on every call and returns its complete instructions with an explicit resource base.',
    promptSnippet: 'Load one selected Skill by exact name after skill_search.',
    promptGuidelines: [
      'Load a Skill only when its instructions are relevant to the current task.',
      'Treat relative references in the loaded Skill as relative to its resource base.',
    ],
    executionMode: 'parallel',
    parameters: Type.Object({
      name: Type.String({ minLength: 1, maxLength: 200 }),
    }),
    execute: async (_toolCallId, params) => {
      const requested = (params as { name: string }).name.trim()
      const skill = indexedSkills.find((candidate) => candidate.name === requested)
      if (!skill || skill.disableModelInvocation || !enabledSkills([skill], options.agentDir).length) {
        throw new Error(`SKILL_NOT_AVAILABLE:${requested}`)
      }
      const resolvedPath = realpathSync(skill.filePath)
      const size = statSync(resolvedPath).size
      if (size > 512_000) throw new Error(`SKILL_TOO_LARGE:${requested}:${size}`)
      const content = readFileSync(resolvedPath, 'utf8')
      const declaredName = frontmatterName(content)
      if (declaredName && declaredName !== skill.name) {
        throw new Error(`SKILL_IDENTITY_CHANGED:${skill.name}:${declaredName}`)
      }
      const body = stripFrontmatter(content).trim()
      if (!body) throw new Error(`SKILL_EMPTY:${requested}`)
      loadCount += 1
      loadedSkills.add(skill.name)
      const baseDir = realpathSync(skill.baseDir || dirname(resolvedPath))
      const wrapped = [
        `<skill name="${escapeAttribute(skill.name)}">`,
        `Resource base: ${baseDir}`,
        '',
        body,
        '</skill>',
      ].join('\n')
      const details = {
        name: skill.name,
        description: skill.description,
        scope: skill.sourceInfo.scope,
        digest: digest(body),
        charCount: body.length,
      }
      return {
        content: [{ type: 'text' as const, text: wrapped }],
        details,
      }
    },
  }

  return {
    mode,
    resourceLoaderOptions: { ...baseOverrides, skillsOverride },
    customTools: mode === 'on-demand' ? [searchTool, loadTool] : [],
    snapshot: (): SkillDiscoverySnapshot => ({
      mode,
      indexedCount: indexedSkills.length,
      promptSkillCount,
      searchableCount: indexedSkills.filter((skill) => !skill.disableModelInvocation).length,
      catalogDigest: catalogDigest(indexedSkills),
      searchCount,
      loadCount,
      loadedSkills: [...loadedSkills].sort(),
      conflicts: [...conflicts],
    }),
  }
}
