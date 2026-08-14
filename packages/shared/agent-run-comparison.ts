import type { AgentRunHistoryItem } from './agent-run-history'

export type AgentRunComparisonSignal =
  | 'version-changed'
  | 'model-changed'
  | 'thinking-changed'
  | 'capabilities-changed'
  | 'context-pressure-up'
  | 'tool-failures-up'
  | 'cost-up'
  | 'tokens-up'
  | 'incomplete-evidence'

export type AgentRunComparisonMetricKey =
  | 'messages'
  | 'files'
  | 'inputTokens'
  | 'outputTokens'
  | 'cost'
  | 'toolCalls'
  | 'toolFailures'
  | 'contextPercent'
  | 'contextDelta'
  | 'compactions'

export interface AgentRunComparisonMetric {
  key: AgentRunComparisonMetricKey
  current: number | null
  baseline: number | null
  delta: number | null
}

export interface AgentRunComparison {
  status: 'stable' | 'changed' | 'attention' | 'unknown'
  signals: AgentRunComparisonSignal[]
  configuration: {
    versionChanged: boolean | null
    modelChanged: boolean | null
    thinkingChanged: boolean | null
  }
  capabilities: {
    comparable: boolean
    added: string[]
    removed: string[]
  }
  metrics: AgentRunComparisonMetric[]
}

function capabilityNames(run: AgentRunHistoryItem): string[] | null {
  const evidence = run.runtimeEvidence?.resourceEvidence
  if (!evidence) return null
  return [
    ...evidence.activeTools.map((item) => `tool:${item.name}`),
    ...evidence.extensions.map((item) => `extension:${item.name}`),
    ...evidence.skills.map((item) => `skill:${item.name}`),
    ...evidence.promptTemplates.map((item) => `prompt:${item.name}`),
    ...evidence.contextFiles.map((item) => `context:${item.name}`),
  ].sort()
}

const changed = (current: unknown, baseline: unknown): boolean | null => current == null || baseline == null ? null : current !== baseline
const metric = (key: AgentRunComparisonMetricKey, current: number | null, baseline: number | null): AgentRunComparisonMetric => ({ key, current, baseline, delta: current == null || baseline == null ? null : current - baseline })

export function buildAgentRunComparison(current: AgentRunHistoryItem, baseline: AgentRunHistoryItem): AgentRunComparison {
  const currentCapabilities = capabilityNames(current)
  const baselineCapabilities = capabilityNames(baseline)
  const capabilityComparable = currentCapabilities != null && baselineCapabilities != null
  const currentSet = new Set(currentCapabilities || [])
  const baselineSet = new Set(baselineCapabilities || [])
  const added = capabilityComparable ? [...currentSet].filter((item) => !baselineSet.has(item)) : []
  const removed = capabilityComparable ? [...baselineSet].filter((item) => !currentSet.has(item)) : []
  const configuration = {
    versionChanged: changed(current.versionId, baseline.versionId),
    modelChanged: changed(current.modelId, baseline.modelId),
    thinkingChanged: changed(current.thinkingLevel, baseline.thinkingLevel),
  }
  const co = current.observability
  const bo = baseline.observability
  const metrics = [
    metric('messages', current.messageCount, baseline.messageCount),
    metric('files', current.artifacts.filter((item) => item.kind === 'file').length, baseline.artifacts.filter((item) => item.kind === 'file').length),
    metric('inputTokens', co?.usage.inputTokens ?? null, bo?.usage.inputTokens ?? null),
    metric('outputTokens', co?.usage.outputTokens ?? null, bo?.usage.outputTokens ?? null),
    metric('cost', co?.usage.cost ?? null, bo?.usage.cost ?? null),
    metric('toolCalls', co?.tools.totalCalls ?? null, bo?.tools.totalCalls ?? null),
    metric('toolFailures', co?.tools.failedCalls ?? null, bo?.tools.failedCalls ?? null),
    metric('contextPercent', co?.context?.percent ?? null, bo?.context?.percent ?? null),
    metric('contextDelta', co?.context?.deltaTokens ?? null, bo?.context?.deltaTokens ?? null),
    metric('compactions', co?.compactions ?? null, bo?.compactions ?? null),
  ]
  const byKey = new Map(metrics.map((item) => [item.key, item]))
  const signals: AgentRunComparisonSignal[] = []
  if (configuration.versionChanged) signals.push('version-changed')
  if (configuration.modelChanged) signals.push('model-changed')
  if (configuration.thinkingChanged) signals.push('thinking-changed')
  if (added.length || removed.length) signals.push('capabilities-changed')
  if ((byKey.get('contextPercent')?.delta ?? 0) >= 5) signals.push('context-pressure-up')
  if ((byKey.get('toolFailures')?.delta ?? 0) > 0) signals.push('tool-failures-up')
  const baselineCost = byKey.get('cost')?.baseline
  const costDelta = byKey.get('cost')?.delta
  if (baselineCost != null && costDelta != null && costDelta > 0 && (baselineCost === 0 || costDelta / baselineCost >= 0.2)) signals.push('cost-up')
  const baselineTokens = (byKey.get('inputTokens')?.baseline ?? 0) + (byKey.get('outputTokens')?.baseline ?? 0)
  const tokenDelta = (byKey.get('inputTokens')?.delta ?? 0) + (byKey.get('outputTokens')?.delta ?? 0)
  if (baselineTokens > 0 && tokenDelta / baselineTokens >= 0.2) signals.push('tokens-up')
  if (!capabilityComparable || !co || !bo || !co.completeTimeline || !bo.completeTimeline) signals.push('incomplete-evidence')
  const attention = signals.some((signal) => ['context-pressure-up', 'tool-failures-up', 'cost-up', 'tokens-up'].includes(signal))
  const known = metrics.some((item) => item.delta != null) || capabilityComparable
  return {
    status: !known ? 'unknown' : attention ? 'attention' : signals.some((signal) => signal !== 'incomplete-evidence') ? 'changed' : 'stable',
    signals,
    configuration,
    capabilities: { comparable: capabilityComparable, added, removed },
    metrics,
  }
}
