export const OPEN_AGENT_EVALUATIONS_EVENT = 'vizruna:open-agent-evaluations'

export type AgentEvaluationOpenRequest = {
  profileId: string
  versionId: string
  suiteId?: string
  createSuite?: boolean
}

export function openAgentEvaluationSetup(request: AgentEvaluationOpenRequest): void {
  window.dispatchEvent(new CustomEvent<AgentEvaluationOpenRequest>(OPEN_AGENT_EVALUATIONS_EVENT, {
    detail: request,
  }))
}
