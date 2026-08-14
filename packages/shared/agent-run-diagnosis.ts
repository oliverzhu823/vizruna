import type { AgentRunHistoryItem } from './agent-run-history'
import { buildAgentRuntimeCapabilityDrift } from './agent-runtime-capability-drift'

export type AgentRunDiagnosisAction = 'open-run' | 'rerun' | 'manage-resources' | 'edit-agent'
export type AgentRunDiagnosisCode =
  | 'run-failed'
  | 'capability-missing'
  | 'capability-unexpected'
  | 'context-critical'
  | 'context-high'
  | 'tool-failures'
  | 'compacted'
  | 'sampled-evidence'
  | 'legacy-evidence'

export interface AgentRunDiagnosisIssue {
  code: AgentRunDiagnosisCode
  severity: 'critical' | 'warning' | 'info'
  action: AgentRunDiagnosisAction
  facts: Record<string, string | number>
}

export interface AgentRunDiagnosis {
  status: 'healthy' | 'attention' | 'blocked' | 'unknown'
  issues: AgentRunDiagnosisIssue[]
  primaryAction: AgentRunDiagnosisAction | null
}

const priorities: AgentRunDiagnosisCode[] = ['run-failed', 'capability-missing', 'context-critical', 'tool-failures', 'context-high', 'capability-unexpected', 'compacted', 'sampled-evidence', 'legacy-evidence']

export function buildAgentRunDiagnosis(run: AgentRunHistoryItem): AgentRunDiagnosis {
  const issues: AgentRunDiagnosisIssue[] = []
  if (run.status === 'failed') issues.push({ code: 'run-failed', severity: 'critical', action: 'open-run', facts: { reason: run.failureReason || '' } })
  const drift = buildAgentRuntimeCapabilityDrift(run)
  if (drift.status === 'no-evidence') {
    issues.push({ code: 'legacy-evidence', severity: 'info', action: 'rerun', facts: {} })
  } else {
    const comparable = drift.groups.filter((group) => group.group === 'tools'
      ? run.capabilitySnapshot?.tools !== undefined && run.capabilitySnapshot?.extensionTools !== undefined
      : run.capabilitySnapshot?.resourceSnapshot !== undefined)
    const missing = comparable.flatMap((group) => group.missing)
    const unexpected = comparable.flatMap((group) => group.unexpected)
    if (missing.length) issues.push({ code: 'capability-missing', severity: 'critical', action: 'manage-resources', facts: { names: missing.join(', '), count: missing.length } })
    if (unexpected.length) issues.push({ code: 'capability-unexpected', severity: 'warning', action: 'edit-agent', facts: { names: unexpected.join(', '), count: unexpected.length } })
  }
  const health = run.observability
  if (health?.signals.includes('context-critical')) issues.push({ code: 'context-critical', severity: 'critical', action: 'open-run', facts: { percent: health.context?.percent ?? 0 } })
  else if (health?.signals.includes('context-high')) issues.push({ code: 'context-high', severity: 'warning', action: 'open-run', facts: { percent: health.context?.percent ?? 0 } })
  if (health?.tools.failedCalls) issues.push({ code: 'tool-failures', severity: 'warning', action: 'open-run', facts: { count: health.tools.failedCalls } })
  if (health?.compactions) issues.push({ code: 'compacted', severity: 'info', action: 'open-run', facts: { count: health.compactions } })
  if (health && !health.completeTimeline) issues.push({ code: 'sampled-evidence', severity: 'info', action: 'open-run', facts: { count: health.analyzedItems } })
  issues.sort((a, b) => priorities.indexOf(a.code) - priorities.indexOf(b.code))
  const hasCritical = issues.some((issue) => issue.severity === 'critical')
  const hasWarning = issues.some((issue) => issue.severity === 'warning')
  const onlyUnknown = issues.length > 0 && issues.every((issue) => ['legacy-evidence', 'sampled-evidence'].includes(issue.code))
  return {
    status: hasCritical ? 'blocked' : hasWarning ? 'attention' : onlyUnknown ? 'unknown' : 'healthy',
    issues,
    primaryAction: issues[0]?.action ?? null,
  }
}
