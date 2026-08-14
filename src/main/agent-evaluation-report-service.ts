import type {
  AgentEvaluationReportExportRequest,
  AgentEvaluationReportExportResponse,
  AgentEvaluationSuiteBundle,
} from '@shared/agent-evaluation'
import { compareAgentEvaluationSuites } from '@shared/agent-evaluation-comparison'
import { buildAgentEvaluationMarkdownReport } from '@shared/agent-evaluation-report'
import { auditRepository } from './audit/audit-repository'
import { requireAgentVersion } from './agent-version-service'
import { sqliteIndex } from './sqlite-index'

const MAX_REPORT_BYTES = 16 * 1024 * 1024

function requireBundle(id: string): AgentEvaluationSuiteBundle {
  const suite = sqliteIndex.getAgentEvaluationSuite(id)
  if (!suite) throw new Error('Agent evaluation suite not found')
  return {
    suite,
    scenarios: sqliteIndex.listAgentEvaluationScenarios(id),
    runs: sqliteIndex.listAgentEvaluationRuns(id),
  }
}

function filenamePart(value: string): string {
  return value
    .normalize('NFKC')
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60) || 'agent'
}

export function exportAgentEvaluationReport(
  request: AgentEvaluationReportExportRequest,
): AgentEvaluationReportExportResponse {
  const baseline = requireBundle(request.baselineSuiteId)
  const candidate = requireBundle(request.candidateSuiteId)
  if (baseline.suite.workspacePath !== candidate.suite.workspacePath) {
    throw new Error('Evaluation suites must belong to the same workspace')
  }
  if (baseline.suite.profileId !== candidate.suite.profileId) {
    throw new Error('Evaluation suites must belong to the same Agent configuration')
  }
  if (!baseline.suite.versionId || !candidate.suite.versionId) {
    throw new Error('Both evaluation suites require immutable Agent versions')
  }
  const profile = sqliteIndex.getAgentProfile(candidate.suite.profileId)
  if (!profile) throw new Error('Agent configuration not found')
  const baselineVersion = requireAgentVersion(baseline.suite.versionId, profile.id)
  const candidateVersion = requireAgentVersion(candidate.suite.versionId, profile.id)
  const comparison = compareAgentEvaluationSuites(baseline, candidate)
  const markdown = buildAgentEvaluationMarkdownReport({
    baseline,
    candidate,
    comparison,
    profile,
    baselineVersion,
    candidateVersion,
    locale: request.locale,
    includeContent: request.includeContent === true,
  })
  const bytes = Buffer.byteLength(markdown)
  if (bytes > MAX_REPORT_BYTES) throw new Error('Agent evaluation report exceeds 16 MB')
  const timestamp = new Date().toISOString().slice(0, 10)
  const filename = `${filenamePart(profile.name)}-v${baselineVersion.number}-to-v${candidateVersion.number}-${timestamp}.md`
  auditRepository.write({
    category: 'operation',
    action: 'agent-evaluation.report.export',
    outcome: 'success',
    workspaceId: candidate.suite.workspacePath,
    details: {
      baselineSuiteId: baseline.suite.id,
      candidateSuiteId: candidate.suite.id,
      baselineVersionId: baselineVersion.id,
      candidateVersionId: candidateVersion.id,
      outcome: comparison.outcome,
      includeContent: request.includeContent === true,
      bytes,
    },
  })
  return {
    bytes,
    outcome: comparison.outcome,
    download: {
      filename,
      mimeType: 'text/markdown;charset=utf-8',
      base64: Buffer.from(markdown, 'utf8').toString('base64'),
    },
  }
}
