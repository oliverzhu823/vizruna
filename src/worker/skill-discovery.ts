import { Type } from '@earendil-works/pi-ai'
import type { ResourceDiagnostic, Skill, ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { ConversationRuntimeSnapshot } from '@shared/system-prompt-preset'
import type { AgentResourceLoaderOverrides } from './agent-profile-runtime.js'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

export type SkillDiscoveryMode = 'on-demand' | 'fixed'

export interface SkillDiscoverySnapshot {
  mode: SkillDiscoveryMode
  indexedCount: number
  promptSkillCount: number
  searchableCount: number
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

  const skillsOverride = (base: SkillsResult): SkillsResult => {
    const filtered = { ...base, skills: enabledSkills(base.skills, options.agentDir) }
    const resolved = baseOverrides.skillsOverride
      ? baseOverrides.skillsOverride(filtered)
      : filtered
    indexedSkills = resolved.skills.slice()
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
      'Search the trusted local Skill index by task intent. Returns matching metadata and SKILL.md paths; read a chosen skill before following it.',
    promptSnippet: 'Search trusted local Skills by task intent before loading one.',
    promptGuidelines: [
      'Use skill_search only when specialized instructions may materially improve the task; do not search for routine work.',
      'After choosing a result, read its SKILL.md completely before acting and load referenced files only as needed.',
    ],
    executionMode: 'parallel',
    parameters: Type.Object({
      query: Type.String({ minLength: 1, maxLength: 500 }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 10 })),
    }),
    execute: async (_toolCallId, params) => {
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
          path: skill.filePath,
          scope: skill.sourceInfo.scope,
        }))
      const result = {
        query: value.query,
        matches,
        instruction: matches.length
          ? 'Read the chosen SKILL.md completely before using it.'
          : 'No matching enabled Skill was found. Continue without a Skill or refine the query.',
      }
      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
        details: result,
      }
    },
  }

  return {
    mode,
    resourceLoaderOptions: { ...baseOverrides, skillsOverride },
    customTools: mode === 'on-demand' ? [searchTool] : [],
    snapshot: (): SkillDiscoverySnapshot => ({
      mode,
      indexedCount: indexedSkills.length,
      promptSkillCount,
      searchableCount: indexedSkills.filter((skill) => !skill.disableModelInvocation).length,
    }),
  }
}
