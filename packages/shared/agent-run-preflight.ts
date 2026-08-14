import type { AgentProfile, AgentProfilePreviewResponse } from './agent-profile'
import {
  evaluateAgentProviderRequirements,
  type AgentModelCapability,
  type AgentProviderRequirementIssue,
} from './agent-provider-requirements'

export type AgentRunPreflightCheckCode = 'runtime' | 'model' | 'provider' | 'resources' | 'context' | 'tools'
export type AgentRunPreflightCheckStatus = 'ready' | 'action' | 'blocked'

export interface AgentRunPreflightCheck {
  code: AgentRunPreflightCheckCode
  status: AgentRunPreflightCheckStatus
  detail?: string
  count?: number
}

export interface AgentRunPreflight {
  status: 'ready' | 'needs-setup' | 'blocked'
  checks: AgentRunPreflightCheck[]
  providerIssues: AgentProviderRequirementIssue[]
  canRun: boolean
}

export function buildAgentRunPreflight(input: {
  profile: AgentProfile
  preview: AgentProfilePreviewResponse
  availableModels: readonly AgentModelCapability[]
}): AgentRunPreflight {
  const { profile, preview, availableModels } = input
  const providerIssues = evaluateAgentProviderRequirements(profile.modelId, availableModels, profile.providerRequirements)
  const explicitModelAvailable = !profile.modelId || availableModels.some((model) => `${model.provider}/${model.id}` === profile.modelId)
  const hardResourceWarnings = preview.warnings.filter((warning) => (
    warning.code === 'package-missing' || warning.code === 'resource-missing' || warning.code === 'resource-disabled'
  ))
  const projectUntrusted = preview.warnings.some((warning) => warning.code === 'project-untrusted')
  const inheritedResources = profile.resourceSelection?.mode !== 'selected'
  const inheritedTools = profile.tools === undefined
  const checks: AgentRunPreflightCheck[] = [
    { code: 'runtime', status: preview.resourceSnapshot.sdkVersion ? 'ready' : 'blocked', detail: preview.resourceSnapshot.sdkVersion },
    { code: 'model', status: explicitModelAvailable ? (profile.modelId ? 'ready' : 'action') : 'blocked', detail: profile.modelId },
    { code: 'provider', status: providerIssues.length ? 'blocked' : 'ready', count: providerIssues.length },
    { code: 'resources', status: hardResourceWarnings.length ? 'blocked' : inheritedResources ? 'action' : 'ready', count: preview.resourceSnapshot.resources.length },
    { code: 'context', status: projectUntrusted ? 'blocked' : profile.resourceSelection?.projectContext === 'none' ? 'ready' : 'action' },
    { code: 'tools', status: inheritedTools ? 'action' : 'ready', count: profile.tools?.length },
  ]
  const status = checks.some((check) => check.status === 'blocked')
    ? 'blocked'
    : checks.some((check) => check.status === 'action')
      ? 'needs-setup'
      : 'ready'
  return { status, checks, providerIssues, canRun: status !== 'blocked' }
}
