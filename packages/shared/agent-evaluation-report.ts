import type {
  AgentEvaluationScenario,
  AgentEvaluationSuiteBundle,
  AgentEvaluationVersionComparison,
} from './agent-evaluation'
import type { AgentProfile } from './agent-profile'
import { diffAgentVersions, type AgentVersion } from './agent-version'

type ReportInput = {
  baseline: AgentEvaluationSuiteBundle
  candidate: AgentEvaluationSuiteBundle
  comparison: AgentEvaluationVersionComparison
  profile: AgentProfile
  baselineVersion: AgentVersion
  candidateVersion: AgentVersion
  locale: 'zh' | 'en'
  includeContent: boolean
  generatedAt?: number
}

const labels = {
  zh: {
    title: 'Agent 版本回归报告', summary: '结论摘要', evidence: '证据规则', config: '配置变化', metrics: '运行指标变化', tasks: '固定任务结果', details: '任务证据', privacy: '隐私说明', baseline: '基线版本', candidate: '候选版本', outcome: '整体结论', generated: '生成时间', agent: 'Agent', suite: '评测集', paired: '可比较运行', field: '变化字段', noConfig: '两个版本的作者配置没有字段变化。', task: '任务', verdict: '人工结论（基线 → 候选）', result: '结果', model: '模型（基线 / 候选）', duration: '耗时变化', cost: '成本变化', reason: '证据说明', input: '固定输入', criteria: '人工验收标准', baselineOutput: '基线输出', candidateOutput: '候选输出', excluded: '本报告默认不包含 System Prompt、任务输入全文、模型输出全文、会话文件路径、凭据或隐藏思考。', included: '本报告包含用户显式授权的任务输入、人工验收标准和模型输出；仍不包含 System Prompt、会话文件路径、凭据或隐藏思考。', evidenceRule: '质量结论来自固定任务的最新真实 Pi 运行和人工验收；耗时、Token、成本与工具失败仅作为辅助信号。', unknown: '—', passRate: '通过率', tokens: 'Token（输入 / 输出）', failures: '工具失败', counts: '进步 {{improved}}，持平 {{equivalent}}，退化 {{regressed}}，证据不足 {{insufficient}}', promptIntegrity: '输入一致性', matched: '一致', drifted: '发生漂移', outputOmitted: '未在可分享摘要中包含', noOutput: '无输出', status: { improved: '新版进步', equivalent: '质量持平', regressed: '新版退化', mixed: '有进步也有退化', insufficient: '证据不足', passed: '通过', failed: '不通过', pending: '待复核', 'scenario-missing': '两边任务不一致', 'run-missing': '缺少真实运行', 'review-pending': '等待人工复核', 'prompt-drifted': '实际输入发生漂移' },
  },
  en: {
    title: 'Agent Version Regression Report', summary: 'Executive summary', evidence: 'Evidence rules', config: 'Configuration changes', metrics: 'Runtime metric changes', tasks: 'Fixed-task results', details: 'Task evidence', privacy: 'Privacy notice', baseline: 'Baseline version', candidate: 'Candidate version', outcome: 'Overall outcome', generated: 'Generated at', agent: 'Agent', suite: 'Evaluation suite', paired: 'Comparable runs', field: 'Changed field', noConfig: 'The authored configuration has no changed fields between these versions.', task: 'Task', verdict: 'Human verdict (baseline → candidate)', result: 'Outcome', model: 'Model (baseline / candidate)', duration: 'Duration change', cost: 'Cost change', reason: 'Evidence note', input: 'Fixed input', criteria: 'Human acceptance criteria', baselineOutput: 'Baseline output', candidateOutput: 'Candidate output', excluded: 'By default this report excludes the System Prompt, full task inputs, full model outputs, session file paths, credentials, and hidden reasoning.', included: 'This report includes task inputs, acceptance criteria, and model outputs by explicit user choice. It still excludes the System Prompt, session file paths, credentials, and hidden reasoning.', evidenceRule: 'Quality uses the latest real Pi run and human verdict for each fixed task. Duration, tokens, cost, and tool failures are supporting signals only.', unknown: '—', passRate: 'Pass rate', tokens: 'Tokens (input / output)', failures: 'Tool failures', counts: 'Improved {{improved}}, equal {{equivalent}}, regressed {{regressed}}, insufficient {{insufficient}}', promptIntegrity: 'Prompt integrity', matched: 'Matched', drifted: 'Drifted', outputOmitted: 'Excluded from the shareable summary', noOutput: 'No output', status: { improved: 'Candidate improved', equivalent: 'Quality unchanged', regressed: 'Candidate regressed', mixed: 'Mixed improvement and regression', insufficient: 'Insufficient evidence', passed: 'Passed', failed: 'Failed', pending: 'Needs review', 'scenario-missing': 'Tasks do not match', 'run-missing': 'Real run missing', 'review-pending': 'Human review pending', 'prompt-drifted': 'Actual input drifted' },
  },
} as const

function cell(value: unknown): string {
  return String(value ?? '—').replaceAll('|', '\\|').replaceAll('\n', '<br>')
}

function signed(value: number | null, unit = ''): string {
  if (value == null) return '—'
  const prefix = value > 0 ? '+' : ''
  return `${prefix}${value.toLocaleString(undefined, { maximumFractionDigits: 4 })}${unit}`
}

function fence(value: string): string {
  const longest = Math.max(3, ...[...value.matchAll(/`+/g)].map((match) => match[0].length + 1))
  const marker = '`'.repeat(longest)
  return `${marker}\n${value || '—'}\n${marker}`
}

function latestScenario(bundle: AgentEvaluationSuiteBundle, id?: string): AgentEvaluationScenario | undefined {
  return id ? bundle.scenarios.find((scenario) => scenario.id === id) : undefined
}

export function buildAgentEvaluationMarkdownReport(input: ReportInput): string {
  const l = labels[input.locale]
  const status = (key: string | undefined) => key ? (l.status as Record<string, string>)[key] ?? key : l.unknown
  const generatedAt = new Date(input.generatedAt ?? Date.now()).toISOString()
  const comparison = input.comparison
  const configDiff = diffAgentVersions(input.baselineVersion.config, input.candidateVersion.config)
  const countText = l.counts
    .replace('{{improved}}', String(comparison.counts.improved))
    .replace('{{equivalent}}', String(comparison.counts.equivalent))
    .replace('{{regressed}}', String(comparison.counts.regressed))
    .replace('{{insufficient}}', String(comparison.counts.insufficient))
  const lines = [
    `# ${l.title}`,
    '',
    `## ${l.summary}`,
    '',
    `| ${l.agent} | ${cell(input.profile.name)} |`,
    '| --- | --- |',
    `| ${l.suite} | ${cell(input.baseline.suite.name)} → ${cell(input.candidate.suite.name)} |`,
    `| ${l.baseline} | v${input.baselineVersion.number} · \`${input.baselineVersion.digest.slice(0, 12)}\` |`,
    `| ${l.candidate} | v${input.candidateVersion.number} · \`${input.candidateVersion.digest.slice(0, 12)}\` |`,
    `| ${l.outcome} | **${status(comparison.outcome)}** |`,
    `| ${l.paired} | ${comparison.pairedRuns} |`,
    `| ${l.generated} | ${generatedAt} |`,
    '',
    `${countText}.`,
    '',
    `> ${l.evidenceRule}`,
    '',
    `## ${l.config}`,
    '',
  ]
  if (configDiff.length === 0) lines.push(l.noConfig, '')
  else {
    lines.push(`| ${l.field} |`, '| --- |')
    for (const diff of configDiff) lines.push(`| ${cell(diff.field)} |`)
    lines.push('')
  }
  lines.push(
    `## ${l.metrics}`,
    '',
    `| ${l.passRate} | ${l.duration} | ${l.tokens} | ${l.cost} | ${l.failures} |`,
    '| --- | --- | --- | --- | --- |',
    `| ${signed(comparison.delta.passRatePoints, ' pp')} | ${signed(comparison.delta.averageDurationMs, ' ms')} | ${signed(comparison.delta.inputTokens)} / ${signed(comparison.delta.outputTokens)} | ${signed(comparison.delta.cost)} | ${signed(comparison.delta.failedToolCalls)} |`,
    '',
    `## ${l.tasks}`,
    '',
    `| ${l.task} | ${l.verdict} | ${l.result} | ${l.model} | ${l.duration} | ${l.cost} | ${l.reason} |`,
    '| --- | --- | --- | --- | --- | --- | --- |',
  )
  for (const scenario of comparison.scenarios) {
    const baselineVerdict = status(scenario.baselineRun?.verdict)
    const candidateVerdict = status(scenario.candidateRun?.verdict)
    const durationDelta = scenario.baselineRun?.metrics.durationMs != null && scenario.candidateRun?.metrics.durationMs != null
      ? scenario.candidateRun.metrics.durationMs - scenario.baselineRun.metrics.durationMs
      : null
    const costDelta = (scenario.candidateRun?.metrics.cost ?? 0) - (scenario.baselineRun?.metrics.cost ?? 0)
    lines.push(`| ${cell(scenario.name)} | ${cell(`${baselineVerdict} → ${candidateVerdict}`)} | ${cell(status(scenario.outcome))} | ${cell(`${scenario.baselineRun?.modelId ?? '—'} / ${scenario.candidateRun?.modelId ?? '—'}`)} | ${cell(signed(durationDelta, ' ms'))} | ${cell(signed(costDelta))} | ${cell(scenario.reasons.map(status).join(', ') || '—')} |`)
  }
  lines.push('', `## ${l.details}`, '')
  for (const item of comparison.scenarios) {
    const baselineScenario = latestScenario(input.baseline, item.baselineScenarioId)
    const candidateScenario = latestScenario(input.candidate, item.candidateScenarioId)
    const authored = candidateScenario ?? baselineScenario
    const baselineRun = item.baselineRun ? input.baseline.runs.find((run) => run.id === item.baselineRun?.id) : undefined
    const candidateRun = item.candidateRun ? input.candidate.runs.find((run) => run.id === item.candidateRun?.id) : undefined
    lines.push(`### ${item.name}`, '')
    lines.push(`- ${l.result}: **${status(item.outcome)}**`)
    lines.push(`- ${l.promptIntegrity}: ${item.reasons.includes('prompt-drifted') ? l.drifted : l.matched}`)
    if (item.reasons.length) lines.push(`- ${l.reason}: ${item.reasons.map(status).join(', ')}`)
    lines.push('')
    if (input.includeContent) {
      lines.push(`**${l.input}**`, '', fence(authored?.prompt ?? ''), '')
      lines.push(`**${l.criteria}**`, '', fence(authored?.expectedOutcome ?? ''), '')
      lines.push(`**${l.baselineOutput}**`, '', fence(baselineRun?.evidence.outputText || l.noOutput), '')
      lines.push(`**${l.candidateOutput}**`, '', fence(candidateRun?.evidence.outputText || l.noOutput), '')
    } else {
      lines.push(`_${l.outputOmitted}_`, '')
    }
  }
  lines.push(`## ${l.privacy}`, '', input.includeContent ? l.included : l.excluded, '')
  return `${lines.join('\n').trim()}\n`
}
