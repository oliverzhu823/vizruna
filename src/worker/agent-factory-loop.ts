import type {
  AgentRelationship,
  OrchestrationTaskSnapshot,
  WaitForChildrenResult,
} from '@shared/orchestration'
import { requestOrchestration } from './orchestration-rpc.js'

export type FactoryStatus = 'continue' | 'complete' | 'blocked'

export interface FactoryRoundReport {
  status: FactoryStatus
  summary: string
  evidence: string[]
  nextSteps: string[]
  blocker?: string
}

export interface FactoryLoopResult {
  status: 'complete' | 'blocked' | 'max_rounds'
  rounds: Array<{
    round: number
    relationshipId: string
    relationshipStatus: AgentRelationship['status']
    verificationStatus: AgentRelationship['verificationStatus']
    report: FactoryRoundReport
  }>
}

const terminal = new Set<AgentRelationship['status']>([
  'complete', 'failed', 'cancelled', 'interrupted', 'timed_out',
])

function boundedStrings(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return []
  return value.slice(0, max).map((item) => String(item).trim().slice(0, 2_000)).filter(Boolean)
}

export function parseFactoryRoundReport(text: string): FactoryRoundReport {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]
  const candidates = [fenced, trimmed, trimmed.slice(trimmed.lastIndexOf('{'))].filter(Boolean) as string[]
  let parsed: Record<string, unknown> | undefined
  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate)
      if (value && typeof value === 'object' && !Array.isArray(value)) {
        parsed = value as Record<string, unknown>
        break
      }
    } catch { /* try the next bounded representation */ }
  }
  if (!parsed || !['continue', 'complete', 'blocked'].includes(String(parsed.status))) {
    throw new Error('FACTORY_REPORT_INVALID: child must finish with the required JSON report')
  }
  const summary = String(parsed.summary || '').trim().slice(0, 8_000)
  if (!summary) throw new Error('FACTORY_REPORT_INVALID: summary is required')
  return {
    status: parsed.status as FactoryStatus,
    summary,
    evidence: boundedStrings(parsed.evidence),
    nextSteps: boundedStrings(parsed.nextSteps),
    ...(parsed.blocker ? { blocker: String(parsed.blocker).trim().slice(0, 4_000) } : {}),
  }
}

function roundPrompt(input: {
  objective: string
  acceptanceCriteria: string[]
  round: number
  maxRounds: number
  previous?: FactoryRoundReport
}): string {
  return [
    'Vizruna Agent Factory round. Work in the shared local workspace; inspect existing work before changing it.',
    `Objective: ${input.objective}`,
    `Round: ${input.round}/${input.maxRounds}`,
    `Acceptance criteria:\n${input.acceptanceCriteria.map((item, index) => `${index + 1}. ${item}`).join('\n') || '1. Demonstrate the requested behavior with concrete evidence.'}`,
    input.previous
      ? `Previous handoff:\n${JSON.stringify(input.previous)}`
      : 'This is the first implementation round.',
    'Implement, inspect, or verify only what advances the objective. Run relevant checks and leave durable work in the workspace.',
    'Your final output MUST be only one JSON object with this schema:',
    '{"status":"continue|complete|blocked","summary":"...","evidence":["command/result or artifact"],"nextSteps":["..."],"blocker":"optional"}',
    'Use complete only when every acceptance criterion has concrete evidence. Use blocked only for a real external blocker. Otherwise use continue.',
  ].join('\n\n')
}

async function waitForTerminal(id: string, timeoutMs: number, signal?: AbortSignal): Promise<AgentRelationship> {
  const started = Date.now()
  for (;;) {
    if (signal?.aborted) throw new Error('Agent Factory aborted')
    const remaining = timeoutMs - (Date.now() - started)
    if (remaining <= 0) throw new Error(`FACTORY_ROUND_TIMEOUT:${id}`)
    const result = await requestOrchestration({
      method: 'waitChildren',
      relationshipIds: [id],
      timeoutMs: Math.min(60_000, remaining),
    }, signal) as WaitForChildrenResult
    const relationship = result.relationships.find((item) => item.id === id)
    if (relationship && terminal.has(relationship.status)) return relationship
  }
}

/** Pi-only, deterministic outer loop. Models produce bounded round reports; code owns control flow. */
export async function runAgentFactoryLoop(input: {
  objective: string
  acceptanceCriteria: string[]
  maxRounds: number
  roundTimeoutMs: number
  signal?: AbortSignal
}): Promise<FactoryLoopResult> {
  const rounds: FactoryLoopResult['rounds'] = []
  let previous: FactoryRoundReport | undefined
  for (let round = 1; round <= input.maxRounds; round += 1) {
    const created = await requestOrchestration({
      method: 'createChild',
      name: `factory-round-${round}`,
      environment: 'local',
      timeoutMs: input.roundTimeoutMs,
      goal: roundPrompt({ ...input, round, previous }),
    }, input.signal) as AgentRelationship
    const relationship = await waitForTerminal(created.id, input.roundTimeoutMs, input.signal)
    const snapshot = await requestOrchestration({
      method: 'readChild', relationshipId: created.id, includeEvidence: true,
    }, input.signal) as OrchestrationTaskSnapshot
    if (relationship.status !== 'complete') {
      const report: FactoryRoundReport = {
        status: 'blocked',
        summary: relationship.lastSummary || relationship.error || `Child ended as ${relationship.status}`,
        evidence: snapshot.evidence.map((item) => `${item.status}: ${item.title}`).slice(0, 20),
        nextSteps: [],
        blocker: relationship.error || `Child ended as ${relationship.status}`,
      }
      rounds.push({ round, relationshipId: created.id, relationshipStatus: relationship.status, verificationStatus: relationship.verificationStatus, report })
      return { status: 'blocked', rounds }
    }
    let report: FactoryRoundReport
    try {
      report = parseFactoryRoundReport(relationship.lastOutput || '')
    } catch (error) {
      report = {
        status: 'continue',
        summary: relationship.lastSummary || (error instanceof Error ? error.message : String(error)),
        evidence: snapshot.evidence.map((item) => `${item.status}: ${item.title}`).slice(0, 20),
        nextSteps: ['Produce a valid bounded Factory report and verify the acceptance criteria.'],
      }
    }
    rounds.push({ round, relationshipId: created.id, relationshipStatus: relationship.status, verificationStatus: relationship.verificationStatus, report })
    if (report.status === 'blocked') return { status: 'blocked', rounds }
    if (report.status === 'complete' && relationship.verificationStatus === 'passed') {
      return { status: 'complete', rounds }
    }
    previous = report.status === 'complete'
      ? { ...report, status: 'continue', nextSteps: ['Independently verify every acceptance criterion.'] }
      : report
  }
  return { status: 'max_rounds', rounds }
}
