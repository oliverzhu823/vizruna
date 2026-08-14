import type { AgentProviderRequirements } from './agent-profile'

export type AgentModelCapability = {
  id: string
  provider: string
  reasoning: boolean
  input: Array<'text' | 'image'>
  contextWindow: number
}

export type AgentProviderRequirementIssue =
  | 'model-required'
  | 'model-unavailable'
  | 'reasoning-required'
  | 'image-required'
  | 'context-window-required'

export function hasAgentProviderRequirements(
  requirements?: AgentProviderRequirements,
): boolean {
  return Boolean(
    requirements?.reasoning ||
      requirements?.imageInput ||
      (requirements?.minContextWindow ?? 0) > 0,
  )
}

export function evaluateAgentProviderRequirements(
  modelId: string | undefined,
  models: readonly AgentModelCapability[],
  requirements?: AgentProviderRequirements,
): AgentProviderRequirementIssue[] {
  if (!hasAgentProviderRequirements(requirements)) return []
  if (!modelId) return ['model-required']
  const model = models.find((candidate) => `${candidate.provider}/${candidate.id}` === modelId)
  if (!model) return ['model-unavailable']
  const issues: AgentProviderRequirementIssue[] = []
  if (requirements?.reasoning && !model.reasoning) issues.push('reasoning-required')
  if (requirements?.imageInput && !model.input.includes('image')) issues.push('image-required')
  if (
    (requirements?.minContextWindow ?? 0) > 0 &&
    model.contextWindow < (requirements?.minContextWindow ?? 0)
  ) {
    issues.push('context-window-required')
  }
  return issues
}
