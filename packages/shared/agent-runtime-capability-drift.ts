import type { RunResourceItem } from './app-events'
import type { AgentRunHistoryItem } from './agent-run-history'

export type AgentRuntimeCapabilityGroup = 'tools' | 'extensions' | 'skills' | 'prompts' | 'context'
export type AgentRuntimeCapabilityDriftStatus = 'exact' | 'drift' | 'partial' | 'no-evidence'

export interface AgentRuntimeCapabilityDriftGroup {
  group: AgentRuntimeCapabilityGroup
  tracked: boolean
  actual: string[]
  matched: string[]
  missing: string[]
  unexpected: string[]
}

export interface AgentRuntimeCapabilityDrift {
  status: AgentRuntimeCapabilityDriftStatus
  groups: AgentRuntimeCapabilityDriftGroup[]
  missingCount: number
  unexpectedCount: number
}

function key(value: string): string {
  return value.trim().toLocaleLowerCase()
}

function compare(group: AgentRuntimeCapabilityGroup, expected: string[], actual: RunResourceItem[], tracked = true): AgentRuntimeCapabilityDriftGroup {
  const expectedMap = new Map(expected.map((name) => [key(name), name]))
  const actualMap = new Map(actual.map((item) => [key(item.name), item.name]))
  return {
    group,
    tracked,
    actual: [...actualMap.values()],
    matched: tracked ? [...expectedMap].filter(([id]) => actualMap.has(id)).map(([, name]) => name) : [],
    missing: tracked ? [...expectedMap].filter(([id]) => !actualMap.has(id)).map(([, name]) => name) : [],
    unexpected: tracked ? [...actualMap].filter(([id]) => !expectedMap.has(id)).map(([, name]) => name) : [],
  }
}

export function buildAgentRuntimeCapabilityDrift(run: AgentRunHistoryItem): AgentRuntimeCapabilityDrift {
  const evidence = run.runtimeEvidence?.resourceEvidence
  if (!evidence) return { status: 'no-evidence', groups: [], missingCount: 0, unexpectedCount: 0 }
  const snapshot = run.capabilitySnapshot
  const resources = snapshot?.resourceSnapshot?.resources ?? []
  const groups: AgentRuntimeCapabilityDriftGroup[] = [
    compare('tools', [...(snapshot?.tools ?? []), ...(snapshot?.extensionTools ?? [])], evidence.activeTools, snapshot?.tools !== undefined && snapshot?.extensionTools !== undefined),
    compare('extensions', resources.filter((item) => item.kind === 'extensions').map((item) => item.name), evidence.extensions),
    compare('skills', resources.filter((item) => item.kind === 'skills').map((item) => item.name), evidence.skills),
    compare('prompts', resources.filter((item) => item.kind === 'prompts').map((item) => item.name), evidence.promptTemplates),
    compare('context', [], evidence.contextFiles, snapshot?.resourceSnapshot?.projectContext === 'none'),
  ]
  const tracked = groups.filter((group) => group.tracked)
  const missingCount = tracked.reduce((total, group) => total + group.missing.length, 0)
  const unexpectedCount = tracked.reduce((total, group) => total + group.unexpected.length, 0)
  return { status: missingCount || unexpectedCount ? 'drift' : tracked.length === groups.length ? 'exact' : 'partial', groups, missingCount, unexpectedCount }
}
