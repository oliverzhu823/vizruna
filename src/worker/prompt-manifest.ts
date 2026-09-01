import type { PiPromptManifestSection, PiPromptOwner } from '@shared/pi-inspector'
import type { ConversationRuntimeSnapshot } from '@shared/system-prompt-preset'
import type { SkillDiscoverySnapshot } from './skill-discovery.js'

type SectionSeed = Omit<PiPromptManifestSection, 'charCount' | 'estimatedTokens'> & {
  priority: number
  ranges: Array<[number, number]>
}

const estimateTokens = (chars: number): number => Math.ceil(chars / 4)

function allRanges(text: string, needle: string): Array<[number, number]> {
  if (!needle) return []
  const ranges: Array<[number, number]> = []
  let offset = 0
  while (offset < text.length) {
    const start = text.indexOf(needle, offset)
    if (start < 0) break
    ranges.push([start, start + needle.length])
    offset = start + Math.max(needle.length, 1)
  }
  return ranges
}

function markerRange(text: string, startMarker: string, endMarker: string): Array<[number, number]> {
  const start = text.indexOf(startMarker)
  if (start < 0) return []
  const endStart = text.indexOf(endMarker, start)
  if (endStart < 0) return [[start, text.length]]
  return [[start, endStart + endMarker.length]]
}

function seed(
  id: string,
  label: string,
  owner: PiPromptOwner,
  order: number,
  activation: string,
  priority: number,
  ranges: Array<[number, number]>,
  details?: string[],
): SectionSeed {
  return { id, label, owner, order, enabled: ranges.length > 0, activation, priority, ranges, details }
}

export function buildPromptManifest(input: {
  text: string
  appendParts: string[]
  activeTools: string[]
  profile: ConversationRuntimeSnapshot | null
  skillDiscovery?: SkillDiscoverySnapshot
}): PiPromptManifestSection[] {
  const { text, appendParts, activeTools, profile, skillDiscovery } = input
  const toolRanges = markerRange(text, 'Available tools:\n', '\n\nPi documentation')
  const projectRanges = markerRange(text, '<project_context>', '</project_context>')
  const skillRanges = markerRange(
    text,
    'The following skills provide specialized instructions',
    '</available_skills>',
  )
  const cwdStart = text.lastIndexOf('\nCurrent working directory:')
  const cwdRanges: Array<[number, number]> = cwdStart >= 0 ? [[cwdStart, text.length]] : []
  const configRanges = profile ? allRanges(text, profile.systemPrompt) : []
  const appendRanges = appendParts
    .filter((part) => !profile || part !== profile.systemPrompt)
    .flatMap((part) => allRanges(text, part))
  const routerRanges = [
    ...allRanges(text, '- skill_search:'),
    ...allRanges(text, 'Use skill_search only when specialized instructions may materially improve the task; do not search for routine work.'),
    ...allRanges(text, 'After choosing a result, read its SKILL.md completely before acting and load referenced files only as needed.'),
  ]

  const seeds: SectionSeed[] = [
    seed('pi-core', 'Pi core contract', 'pi-runtime', 10, 'Always active for the current Pi session.', 1, [[0, text.length]]),
    seed('runtime-tools', 'Active tool contract', 'runtime-tools', 20, 'Compiled from tools that are actually enabled.', 20, toolRanges, activeTools),
    seed('append-prompt', 'User append prompt', 'user-prompt', 30, 'Active when SYSTEM/APPEND_SYSTEM or a prompt preset appends instructions.', 35, appendRanges),
    seed('agent-config', profile && 'profileId' in profile ? profile.name : 'Conversation prompt', 'agent-config', 40, 'Frozen when the conversation is created; never changed mid-conversation.', 50, configRanges, profile ? [profile.promptMode] : undefined),
    seed('project-context', 'Project context', 'project-context', 50, 'Active only for trusted project context files.', 40, projectRanges),
    seed('skill-router', 'On-demand Skill router', 'skill-router', 60, 'Active in general/inherited sessions; searches locally before a Skill is read.', 60, routerRanges, skillDiscovery ? [`mode:${skillDiscovery.mode}`, `indexed:${skillDiscovery.indexedCount}`] : undefined),
    seed('skill-catalog', 'Fixed Skill catalogue', 'skill-catalog', 70, 'Active only for a fixed Agent Skill selection.', 45, skillRanges, skillDiscovery ? [`prompt:${skillDiscovery.promptSkillCount}`, `searchable:${skillDiscovery.searchableCount}`] : undefined),
    seed('workspace', 'Working directory', 'workspace', 80, 'Active for the current workspace.', 30, cwdRanges),
  ]

  // Assign every character to the highest-priority owner so section totals are
  // exact and add up to the final prompt length, even where logical sources overlap.
  const owners = new Int16Array(text.length)
  const priorities = new Int16Array(text.length)
  seeds.forEach((section, index) => {
    for (const [rawStart, rawEnd] of section.ranges) {
      const start = Math.max(0, rawStart)
      const end = Math.min(text.length, rawEnd)
      for (let cursor = start; cursor < end; cursor += 1) {
        if (section.priority >= priorities[cursor]) {
          priorities[cursor] = section.priority
          owners[cursor] = index
        }
      }
    }
  })
  const counts = new Array(seeds.length).fill(0) as number[]
  for (const owner of owners) counts[owner] += 1

  return seeds.map(({ priority: _priority, ranges: _ranges, ...section }, index) => ({
    ...section,
    enabled: section.enabled && counts[index] > 0,
    charCount: counts[index],
    estimatedTokens: estimateTokens(counts[index]),
  }))
}
