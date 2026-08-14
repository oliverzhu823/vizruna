import type {
  AgentPiResourceSelection,
  AgentProfile,
  AgentProviderRequirements,
  AgentPromptMode,
} from './agent-profile'
import type { AgentEvaluationComparisonOutcome } from './agent-evaluation'

export type AgentVersionStatus = 'candidate' | 'validated' | 'released'

/** Immutable author-authored configuration. Runtime resolution is captured separately per session. */
export interface AgentVersionConfig {
  name: string
  description?: string
  systemPrompt: string
  promptMode: AgentPromptMode
  modelId?: string
  thinkingLevel?: string
  tools?: string[]
  extensionTools?: string[]
  resourceSelection?: AgentPiResourceSelection
  providerRequirements?: AgentProviderRequirements
}

export interface AgentVersionValidation {
  suiteId: string
  runIds: string[]
  validatedAt: number
  baselineVersionId?: string
  baselineSuiteId?: string
  comparisonOutcome?: Extract<AgentEvaluationComparisonOutcome, 'improved' | 'equivalent'>
}

/** The config and digest never change; only lifecycle evidence may advance. */
export interface AgentVersion {
  id: string
  profileId: string
  number: number
  digest: string
  config: AgentVersionConfig
  status: AgentVersionStatus
  validation?: AgentVersionValidation
  releasedAt?: number
  createdAt: number
}

export type AgentVersionDiffField =
  | 'name'
  | 'description'
  | 'systemPrompt'
  | 'promptMode'
  | 'modelId'
  | 'thinkingLevel'
  | 'tools'
  | 'extensionTools'
  | 'resourceSelection'
  | 'providerRequirements'

export interface AgentVersionDiff {
  field: AgentVersionDiffField
  before?: string
  after?: string
}

export interface AgentVersionGateScenario {
  scenarioId: string
  scenarioName: string
  runId?: string
  verdict?: 'pending' | 'passed' | 'failed'
  promptMatched?: boolean
}

export type AgentVersionGateBlocker =
  | 'no-scenarios'
  | 'run-missing'
  | 'review-pending'
  | 'task-failed'
  | 'prompt-drifted'
  | 'baseline-required'
  | 'baseline-suite-missing'
  | 'baseline-version-mismatch'
  | 'comparison-insufficient'
  | 'comparison-regressed'
  | 'comparison-mixed'

export interface AgentVersionValidationGate {
  eligible: boolean
  suiteId: string
  versionId: string
  scenarios: AgentVersionGateScenario[]
  blockers: AgentVersionGateBlocker[]
  baselineRequired: boolean
  baselineVersionId?: string
  baselineSuiteId?: string
  comparisonOutcome?: AgentEvaluationComparisonOutcome
}

export interface AgentVersionListRequest {
  profileId?: string
}

export interface AgentVersionListResponse {
  versions: AgentVersion[]
}

export interface AgentVersionValidateRequest {
  versionId: string
  suiteId: string
}

export interface AgentVersionValidateResponse {
  version: AgentVersion
  gate: AgentVersionValidationGate
}

export type AgentVersionReadinessRequest = AgentVersionValidateRequest

export interface AgentVersionReadinessResponse {
  gate: AgentVersionValidationGate
}

function sorted(values?: string[]): string[] | undefined {
  return values ? [...new Set(values)].sort((a, b) => a.localeCompare(b)) : undefined
}

/** Normalize semantically unordered selectors before hashing or comparing versions. */
export function agentVersionConfigFromProfile(profile: AgentProfile): AgentVersionConfig {
  return {
    name: profile.name,
    description: profile.description,
    systemPrompt: profile.systemPrompt,
    promptMode: profile.promptMode,
    modelId: profile.modelId,
    thinkingLevel: profile.thinkingLevel,
    tools: sorted(profile.tools),
    extensionTools: sorted(profile.extensionTools),
    resourceSelection: profile.resourceSelection
      ? {
          mode: profile.resourceSelection.mode,
          packageIds: sorted(profile.resourceSelection.packageIds) ?? [],
          resourceIds: sorted(profile.resourceSelection.resourceIds) ?? [],
          projectContext: profile.resourceSelection.projectContext,
        }
      : undefined,
    providerRequirements: profile.providerRequirements
      ? {
          reasoning: profile.providerRequirements.reasoning,
          imageInput: profile.providerRequirements.imageInput,
          minContextWindow: profile.providerRequirements.minContextWindow,
        }
      : undefined,
  }
}

/** Field order is deliberate so the Main process can hash this string deterministically. */
export function serializeAgentVersionConfig(config: AgentVersionConfig): string {
  return JSON.stringify(config)
}

function comparable(value: unknown): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'string' ? value : JSON.stringify(value)
}

export function diffAgentVersions(
  before: AgentVersionConfig,
  after: AgentVersionConfig,
): AgentVersionDiff[] {
  const fields: AgentVersionDiffField[] = [
    'name',
    'description',
    'systemPrompt',
    'promptMode',
    'modelId',
    'thinkingLevel',
    'tools',
    'extensionTools',
    'resourceSelection',
    'providerRequirements',
  ]
  return fields.flatMap((field) => {
    const previous = comparable(before[field])
    const next = comparable(after[field])
    return previous === next ? [] : [{ field, before: previous, after: next }]
  })
}
