import { useCallback, useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Archive,
  Bot,
  Check,
  CircleAlert,
  Clock3,
  FlaskConical,
  FolderOpen,
  Gauge,
  GitCompareArrows,
  Loader2,
  MessageSquarePlus,
  Play,
  Plus,
  ShieldCheck,
  Sparkles,
  Wrench,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import type { AgentCase } from '@shared/agent-case'
import type {
  AgentEvaluationRun,
  AgentEvaluationScenario,
  AgentEvaluationSuite,
  AgentEvaluationSuiteBundle,
  AgentEvaluationVerdict,
} from '@shared/agent-evaluation'
import { summarizeAgentEvaluationRuns } from '@shared/agent-evaluation-metrics'
import type { AgentProfile } from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useUIStore } from '@renderer/stores/ui-store'
import { AgentEvaluationComparisonPanel } from './agent-evaluation-comparison-panel'
import { AgentEvaluationBatchPanel } from './agent-evaluation-batch-panel'

function DialogShell({
  title,
  description,
  children,
  onClose,
}: {
  title: string
  description?: string
  children: React.ReactNode
  onClose: () => void
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-6 backdrop-blur-[1px]">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-xl overflow-hidden rounded-2xl border border-border bg-background shadow-2xl"
      >
        <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
          <div>
            <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
            {description ? (
              <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">{description}</p>
            ) : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] font-medium text-foreground-secondary">{label}</span>
      {children}
    </label>
  )
}

const fieldClass =
  'w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-primary/60 focus:ring-2 focus:ring-primary/10'

function SuiteCreateDialog({
  profiles,
  versions,
  workspacePath,
  onClose,
  onCreate,
  initialProfileId,
  initialVersionId,
}: {
  profiles: AgentProfile[]
  versions: AgentVersion[]
  workspacePath: string
  onClose: () => void
  onCreate: (request: { name: string; description?: string; profileId: string; versionId: string }) => Promise<void>
  initialProfileId?: string
  initialVersionId?: string
}) {
  const { t } = useTranslation('evaluations')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const selectedInitialProfileId = profiles.some((profile) => profile.id === initialProfileId)
    ? initialProfileId!
    : profiles[0]?.id || ''
  const [profileId, setProfileId] = useState(selectedInitialProfileId)
  const matchingVersions = versions.filter((version) => version.profileId === profileId)
  const [versionId, setVersionId] = useState(
    versions.some((version) => version.id === initialVersionId && version.profileId === selectedInitialProfileId)
      ? initialVersionId!
      : versions.find((version) => version.profileId === selectedInitialProfileId)?.id || '',
  )
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !profileId || !versionId) return
    setSaving(true)
    try {
      await onCreate({ name, description: description || undefined, profileId, versionId })
    } finally {
      setSaving(false)
    }
  }
  return (
    <DialogShell title={t('suite.title')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <div className="rounded-lg border border-border/70 bg-muted/25 px-3 py-2 text-[11px] text-muted-foreground">
          {workspacePath}
        </div>
        <Field label={t('suite.name')}>
          <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder={t('suite.namePlaceholder')} autoFocus />
        </Field>
        <Field label={t('suite.description')}>
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} className={cn(fieldClass, 'min-h-20 resize-y')} placeholder={t('suite.descriptionPlaceholder')} />
        </Field>
        <Field label={t('suite.agent')}>
          <select value={profileId} onChange={(event) => {
            const nextProfileId = event.target.value
            setProfileId(nextProfileId)
            setVersionId(versions.find((version) => version.profileId === nextProfileId)?.id || '')
          }} className={fieldClass}>
            {profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
          </select>
        </Field>
        <Field label={t('suite.version')}>
          <select value={versionId} onChange={(event) => setVersionId(event.target.value)} className={fieldClass}>
            {matchingVersions.map((version) => <option key={version.id} value={version.id}>v{version.number} · {t(`versionStatus.${version.status}`)} · {version.digest.slice(0, 8)}</option>)}
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-accent">{t('common:cancel')}</button>
          <button type="submit" disabled={saving || !name.trim() || !profileId || !versionId} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            {t('suite.submit')}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

function CloneVersionDialog({
  source,
  versions,
  onClose,
  onClone,
}: {
  source: AgentEvaluationSuiteBundle
  versions: AgentVersion[]
  onClose: () => void
  onClone: (targetVersionId: string, name: string) => Promise<void>
}) {
  const { t } = useTranslation('evaluations')
  const candidates = versions
    .filter((version) => (
      version.profileId === source.suite.profileId && version.id !== source.suite.versionId
    ))
    .sort((a, b) => b.number - a.number)
  const initial = candidates[0]
  const defaultName = (version?: AgentVersion) => t('clone.defaultName', {
    name: source.suite.name,
    version: version?.number ?? '?',
  })
  const [targetVersionId, setTargetVersionId] = useState(initial?.id || '')
  const [name, setName] = useState(() => defaultName(initial))
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!targetVersionId || !name.trim()) return
    setSaving(true)
    try {
      await onClone(targetVersionId, name.trim())
    } finally {
      setSaving(false)
    }
  }
  return (
    <DialogShell title={t('clone.title')} description={t('clone.description', { count: source.scenarios.length })} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 p-5">
        {candidates.length > 0 ? (
          <>
            <Field label={t('clone.targetVersion')}>
              <select
                value={targetVersionId}
                onChange={(event) => {
                  const nextId = event.target.value
                  setTargetVersionId(nextId)
                  setName(defaultName(candidates.find((version) => version.id === nextId)))
                }}
                className={fieldClass}
              >
                {candidates.map((version) => (
                  <option key={version.id} value={version.id}>
                    v{version.number} · {t(`versionStatus.${version.status}`)} · {version.digest.slice(0, 8)}
                  </option>
                ))}
              </select>
            </Field>
            <Field label={t('clone.name')}>
              <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} />
            </Field>
            <div className="rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3 text-[11px] leading-relaxed text-muted-foreground">
              {t('clone.guarantee')}
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-border px-5 py-8 text-center text-[12px] text-muted-foreground">
            {t('clone.noVersion')}
          </div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-accent">{t('common:cancel')}</button>
          <button type="submit" disabled={saving || !targetVersionId || !name.trim()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <GitCompareArrows className="h-3.5 w-3.5" />}
            {t('clone.submit')}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

function ScenarioCreateDialog({
  onClose,
  onCreate,
}: {
  onClose: () => void
  onCreate: (request: { name: string; prompt: string; expectedOutcome?: string; tags?: string[] }) => Promise<void>
}) {
  const { t } = useTranslation('evaluations')
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [expectedOutcome, setExpectedOutcome] = useState('')
  const [tags, setTags] = useState('')
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!name.trim() || !prompt.trim()) return
    setSaving(true)
    try {
      await onCreate({
        name,
        prompt,
        expectedOutcome: expectedOutcome || undefined,
        tags: tags.split(/[,，]/).map((tag) => tag.trim()).filter(Boolean),
      })
    } finally {
      setSaving(false)
    }
  }
  return (
    <DialogShell title={t('scenario.title')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <Field label={t('scenario.name')}>
          <input value={name} onChange={(event) => setName(event.target.value)} className={fieldClass} placeholder={t('scenario.namePlaceholder')} autoFocus />
        </Field>
        <Field label={t('scenario.prompt')}>
          <textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className={cn(fieldClass, 'min-h-28 resize-y font-mono text-[12px]')} placeholder={t('scenario.promptPlaceholder')} />
        </Field>
        <Field label={t('scenario.expected')}>
          <textarea value={expectedOutcome} onChange={(event) => setExpectedOutcome(event.target.value)} className={cn(fieldClass, 'min-h-24 resize-y')} placeholder={t('scenario.expectedPlaceholder')} />
        </Field>
        <Field label={t('scenario.tags')}>
          <input value={tags} onChange={(event) => setTags(event.target.value)} className={fieldClass} placeholder={t('scenario.tagsPlaceholder')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-accent">{t('common:cancel')}</button>
          <button type="submit" disabled={saving || !name.trim() || !prompt.trim()} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <MessageSquarePlus className="h-3.5 w-3.5" />}
            {t('scenario.submit')}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

function AttachCaseDialog({
  cases,
  onClose,
  onAttach,
}: {
  cases: AgentCase[]
  onClose: () => void
  onAttach: (caseId: string) => Promise<void>
}) {
  const { t } = useTranslation('evaluations')
  const [caseId, setCaseId] = useState(cases[0]?.id || '')
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    if (!caseId) return
    setSaving(true)
    try {
      await onAttach(caseId)
    } finally {
      setSaving(false)
    }
  }
  return (
    <DialogShell title={t('attach.title')} description={t('attach.description')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 p-5">
        {cases.length > 0 ? (
          <Field label={t('attach.case')}>
            <select value={caseId} onChange={(event) => setCaseId(event.target.value)} className={fieldClass}>
              {cases.map((agentCase) => <option key={agentCase.id} value={agentCase.id}>{agentCase.name}</option>)}
            </select>
          </Field>
        ) : (
          <div className="rounded-xl border border-dashed border-border p-5 text-center text-[12px] text-muted-foreground">{t('attach.none')}</div>
        )}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-accent">{t('common:cancel')}</button>
          <button type="submit" disabled={saving || !caseId} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ShieldCheck className="h-3.5 w-3.5" />}
            {t('attach.submit')}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

function AssessmentDialog({
  run,
  onClose,
  onSave,
}: {
  run: AgentEvaluationRun
  onClose: () => void
  onSave: (verdict: AgentEvaluationVerdict, notes?: string) => Promise<void>
}) {
  const { t } = useTranslation('evaluations')
  const [verdict, setVerdict] = useState(run.verdict)
  const [notes, setNotes] = useState(run.notes || '')
  const [saving, setSaving] = useState(false)
  const submit = async (event: React.FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSave(verdict, notes || undefined)
    } finally {
      setSaving(false)
    }
  }
  return (
    <DialogShell title={t('assessment.title')} description={t('assessment.description')} onClose={onClose}>
      <form onSubmit={submit} className="space-y-4 p-5">
        <Field label={t('assessment.verdict')}>
          <div className="grid grid-cols-3 gap-2">
            {(['pending', 'passed', 'failed'] as const).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => setVerdict(item)}
                className={cn(
                  'rounded-lg border px-3 py-2 text-[12px] transition-colors',
                  verdict === item ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:bg-accent',
                )}
              >
                {t(`assessment.${item}`)}
              </button>
            ))}
          </div>
        </Field>
        <Field label={t('assessment.notes')}>
          <textarea value={notes} onChange={(event) => setNotes(event.target.value)} className={cn(fieldClass, 'min-h-28 resize-y')} placeholder={t('assessment.notesPlaceholder')} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-2 text-[12px] text-muted-foreground hover:bg-accent">{t('common:cancel')}</button>
          <button type="submit" disabled={saving} className="inline-flex items-center gap-2 rounded-lg bg-primary px-3 py-2 text-[12px] font-medium text-primary-foreground disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}
            {t('assessment.submit')}
          </button>
        </div>
      </form>
    </DialogShell>
  )
}

function verdictClass(verdict: AgentEvaluationVerdict): string {
  if (verdict === 'passed') return 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
  if (verdict === 'failed') return 'border-destructive/30 bg-destructive/10 text-destructive'
  return 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300'
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 4 }).format(value)
}

function EvaluationRunCard({
  run,
  readOnly,
  onReview,
  onOpenSource,
}: {
  run: AgentEvaluationRun
  readOnly: boolean
  onReview: () => void
  onOpenSource: () => void
}) {
  const { t } = useTranslation('evaluations')
  const metrics = run.evidence.metrics
  const version = run.evidence.agent?.snapshotDigest.slice(0, 8)
  return (
    <article className="min-w-0 rounded-xl border border-border bg-background p-4 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-semibold text-foreground">
            {version ? t('metrics.versionShort', { value: version }) : t('metrics.generalPi')}
          </div>
          <div className="mt-1 truncate font-mono text-[10px] text-muted-foreground">{run.evidence.modelId || '—'}</div>
        </div>
        <span className={cn('rounded-full border px-2 py-0.5 text-[10px] font-medium', verdictClass(run.verdict))}>
          {t(`assessment.${run.verdict}`)}
        </span>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 text-[11px]">
        <div className="flex items-center gap-1.5 text-muted-foreground"><Clock3 className="h-3 w-3" />{metrics.durationMs == null ? '—' : t('metrics.seconds', { value: (metrics.durationMs / 1000).toFixed(1) })}</div>
        <div className="flex items-center gap-1.5 text-muted-foreground"><Gauge className="h-3 w-3" />{formatNumber(metrics.inputTokens)} / {formatNumber(metrics.outputTokens)}</div>
        <div className="flex items-center gap-1.5 text-muted-foreground"><Wrench className="h-3 w-3" />{metrics.toolCalls} / {metrics.failedToolCalls}</div>
        <div className="truncate text-muted-foreground">${formatNumber(metrics.cost)}</div>
      </div>
      <div className={cn('mt-3 flex items-start gap-2 rounded-lg px-2.5 py-2 text-[10px] leading-relaxed', run.evidence.promptMatched ? 'bg-emerald-500/8 text-emerald-700 dark:text-emerald-300' : 'bg-amber-500/10 text-amber-700 dark:text-amber-300')}>
        {run.evidence.promptMatched ? <Check className="mt-0.5 h-3 w-3 shrink-0" /> : <CircleAlert className="mt-0.5 h-3 w-3 shrink-0" />}
        {t(run.evidence.promptMatched ? 'metrics.promptMatched' : 'metrics.promptDrifted')}
      </div>
      <details className="mt-3 rounded-lg border border-border/70 bg-muted/15 px-3 py-2">
        <summary className="cursor-pointer text-[11px] font-medium text-foreground-secondary">{t('metrics.output')}</summary>
        <div className="mt-2 max-h-52 overflow-y-auto whitespace-pre-wrap text-[11px] leading-relaxed text-foreground-secondary">{run.evidence.outputText || '—'}</div>
      </details>
      {run.notes ? <p className="mt-3 text-[10px] leading-relaxed text-muted-foreground">{run.notes}</p> : null}
      <div className="mt-3 flex gap-2 border-t border-border/50 pt-3">
        <button type="button" disabled={readOnly} onClick={onReview} className="rounded-md px-2 py-1 text-[10px] text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40">{t('review')}</button>
        <button type="button" onClick={onOpenSource} className="ml-auto inline-flex items-center gap-1 rounded-md px-2 py-1 text-[10px] text-muted-foreground hover:bg-accent hover:text-foreground"><FolderOpen className="h-3 w-3" />{t('openSource')}</button>
      </div>
    </article>
  )
}

function ScenarioCard({
  scenario,
  runs,
  availableCases,
  canMutate,
  canRun,
  onRun,
  onAttach,
  onAssess,
  onOpenSource,
}: {
  scenario: AgentEvaluationScenario
  runs: AgentEvaluationRun[]
  availableCases: AgentCase[]
  canMutate: boolean
  canRun: boolean
  onRun: () => void
  onAttach: (caseId: string) => Promise<void>
  onAssess: (run: AgentEvaluationRun, verdict: AgentEvaluationVerdict, notes?: string) => Promise<void>
  onOpenSource: (run: AgentEvaluationRun) => void
}) {
  const { t } = useTranslation('evaluations')
  const [attachOpen, setAttachOpen] = useState(false)
  const [assessmentRun, setAssessmentRun] = useState<AgentEvaluationRun | null>(null)
  return (
    <section className="rounded-2xl border border-border bg-muted/10 p-5">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="text-[14px] font-semibold text-foreground">{scenario.name}</h3>
            {scenario.tags.map((tag) => <span key={tag} className="rounded-full bg-muted px-2 py-0.5 text-[9px] text-muted-foreground">{tag}</span>)}
          </div>
          <p className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground-secondary">{scenario.prompt}</p>
          {scenario.expectedOutcome ? (
            <div className="mt-3 rounded-lg border-l-2 border-primary/50 bg-primary/5 px-3 py-2 text-[11px] leading-relaxed text-muted-foreground">{scenario.expectedOutcome}</div>
          ) : null}
        </div>
        <div className="flex shrink-0 gap-2">
          <button type="button" disabled={!canRun} onClick={onRun} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"><Play className="h-3.5 w-3.5" />{t('runScenario')}</button>
          <button type="button" disabled={!canMutate} onClick={() => setAttachOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-1.5 text-[11px] text-foreground-secondary hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3.5 w-3.5" />{t('attachCase')}</button>
        </div>
      </div>
      {runs.length > 0 ? (
        <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-2 2xl:grid-cols-3">
          {runs.map((run) => (
            <EvaluationRunCard key={run.id} run={run} readOnly={!canMutate} onReview={() => setAssessmentRun(run)} onOpenSource={() => onOpenSource(run)} />
          ))}
        </div>
      ) : (
        <div className="mt-5 rounded-xl border border-dashed border-border px-4 py-7 text-center text-[11px] text-muted-foreground">{t('empty.run')}</div>
      )}
      {attachOpen ? <AttachCaseDialog cases={availableCases} onClose={() => setAttachOpen(false)} onAttach={async (caseId) => { await onAttach(caseId); setAttachOpen(false) }} /> : null}
      {assessmentRun ? <AssessmentDialog run={assessmentRun} onClose={() => setAssessmentRun(null)} onSave={async (verdict, notes) => { await onAssess(assessmentRun, verdict, notes); setAssessmentRun(null) }} /> : null}
    </section>
  )
}

export function AgentEvaluationsPage({
  onRunScenario,
  onOpenSource,
  initialOpenRequest,
  onInitialOpenRequestConsumed,
}: {
  onRunScenario: (workspacePath: string, profileId: string, versionId: string, prompt: string) => Promise<void>
  onOpenSource: (workspacePath: string, sessionId: string, sessionFile: string) => Promise<void>
  initialOpenRequest?: { profileId: string; versionId: string; suiteId?: string; createSuite?: boolean } | null
  onInitialOpenRequestConsumed?: () => void
}) {
  const { t } = useTranslation('evaluations')
  const currentWorkspace = useUIStore((state) => state.currentWorkspace)
  const [bundles, setBundles] = useState<AgentEvaluationSuiteBundle[]>([])
  const [profiles, setProfiles] = useState<AgentProfile[]>([])
  const [versions, setVersions] = useState<AgentVersion[]>([])
  const [cases, setCases] = useState<AgentCase[]>([])
  const [selectedSuiteId, setSelectedSuiteId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [includeArchived, setIncludeArchived] = useState(false)
  const [suiteCreateOpen, setSuiteCreateOpen] = useState(false)
  const [scenarioCreateOpen, setScenarioCreateOpen] = useState(false)
  const [cloneVersionOpen, setCloneVersionOpen] = useState(false)

  const load = useCallback(async (showArchived: boolean) => {
    setLoading(true)
    try {
      const [evaluationResponse, profileResponse, versionResponse, caseResponse] = await Promise.all([
        ipcClient.invoke('agentEvaluation.list', { includeArchived: showArchived }),
        ipcClient.invoke('agentProfile.list', { includeArchived: false }),
        ipcClient.invoke('agentVersion.list', {}),
        ipcClient.invoke('agentCase.list', { includeArchived: false }),
      ])
      const nextBundles = evaluationResponse?.suites ?? []
      setBundles(nextBundles)
      setProfiles(profileResponse?.profiles ?? [])
      setVersions(versionResponse?.versions ?? [])
      setCases(caseResponse?.cases ?? [])
      setSelectedSuiteId((previous) => nextBundles.some((item: AgentEvaluationSuiteBundle) => item.suite.id === previous) ? previous : nextBundles[0]?.suite.id || null)
    } catch (error) {
      toast.error(t('messages.loadFailed'), { description: String(error) })
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => { void load(false) }, [load])

  useEffect(() => {
    if (loading || !initialOpenRequest) return
    if (initialOpenRequest.suiteId && bundles.some((bundle) => bundle.suite.id === initialOpenRequest.suiteId)) {
      setSelectedSuiteId(initialOpenRequest.suiteId)
      onInitialOpenRequestConsumed?.()
      return
    }
    if (!initialOpenRequest.createSuite) return
    if (!profiles.some((profile) => profile.id === initialOpenRequest.profileId)) return
    if (!versions.some((version) => version.id === initialOpenRequest.versionId)) return
    setSuiteCreateOpen(true)
    onInitialOpenRequestConsumed?.()
  }, [bundles, initialOpenRequest, loading, onInitialOpenRequestConsumed, profiles, versions])

  const selected = useMemo(
    () => bundles.find((item) => item.suite.id === selectedSuiteId) || null,
    [bundles, selectedSuiteId],
  )
  const profileMap = useMemo(() => new Map(profiles.map((profile) => [profile.id, profile])), [profiles])
  const versionMap = useMemo(() => new Map(versions.map((version) => [version.id, version])), [versions])
  const summary = useMemo(() => selected ? summarizeAgentEvaluationRuns(selected.runs) : null, [selected])
  const canMutateSelected = !!selected && selected.suite.status === 'active' && currentWorkspace === selected.suite.workspacePath
  const selectedVersion = selected?.suite.versionId
    ? versionMap.get(selected.suite.versionId)
    : undefined
  const baselineOptions = useMemo(() => {
    if (!selected || !selectedVersion) return []
    return bundles.filter((item) => {
      if (item.suite.id === selected.suite.id) return false
      if (item.suite.profileId !== selected.suite.profileId) return false
      if (item.suite.workspacePath !== selected.suite.workspacePath) return false
      if (!item.suite.versionId || item.suite.versionId === selected.suite.versionId) return false
      if (item.suite.id === selected.suite.baselineSuiteId) return true
      const version = versionMap.get(item.suite.versionId)
      return version != null && version.number < selectedVersion.number
    })
  }, [bundles, selected, selectedVersion, versionMap])
  const canCloneSelected = !!selected
    && currentWorkspace === selected.suite.workspacePath
    && selected.scenarios.length > 0
    && versions.some((version) => (
      version.profileId === selected.suite.profileId && version.id !== selected.suite.versionId
    ))

  const createSuite = async (request: { name: string; description?: string; profileId: string; versionId: string }) => {
    if (!currentWorkspace) return
    try {
      const response = await ipcClient.invoke('agentEvaluation.suite.create', { ...request, workspacePath: currentWorkspace })
      const next: AgentEvaluationSuiteBundle = { suite: response.suite, scenarios: [], runs: [] }
      setBundles((previous) => [next, ...previous])
      setSelectedSuiteId(response.suite.id)
      setSuiteCreateOpen(false)
      toast.success(t('messages.suiteCreated'))
    } catch (error) {
      toast.error(t('messages.suiteCreateFailed'), { description: String(error) })
      throw error
    }
  }

  const createScenario = async (request: { name: string; prompt: string; expectedOutcome?: string; tags?: string[] }) => {
    if (!selected) return
    try {
      const response = await ipcClient.invoke('agentEvaluation.scenario.create', { ...request, suiteId: selected.suite.id })
      setBundles((previous) => previous.map((item) => item.suite.id === selected.suite.id ? { ...item, scenarios: [...item.scenarios, response.scenario] } : item))
      setScenarioCreateOpen(false)
      toast.success(t('messages.scenarioCreated'))
    } catch (error) {
      toast.error(t('messages.scenarioCreateFailed'), { description: String(error) })
      throw error
    }
  }

  const cloneForVersion = async (targetVersionId: string, name: string) => {
    if (!selected) return
    try {
      const response = await ipcClient.invoke('agentEvaluation.suite.cloneVersion', {
        sourceSuiteId: selected.suite.id,
        targetVersionId,
        name,
      })
      setBundles((previous) => [response.bundle, ...previous])
      setSelectedSuiteId(response.bundle.suite.id)
      setCloneVersionOpen(false)
      toast.success(t('messages.cloned'))
    } catch (error) {
      toast.error(t('messages.cloneFailed'), { description: String(error) })
      throw error
    }
  }

  const attachCase = async (scenario: AgentEvaluationScenario, caseId: string) => {
    if (!selected) return
    try {
      const response = await ipcClient.invoke('agentEvaluation.attachCase', { suiteId: selected.suite.id, scenarioId: scenario.id, caseId })
      setBundles((previous) => previous.map((item) => item.suite.id === selected.suite.id ? { ...item, runs: [response.run, ...item.runs] } : item))
      toast.success(t('messages.caseAttached'))
    } catch (error) {
      toast.error(t('messages.caseAttachFailed'), { description: String(error) })
      throw error
    }
  }

  const assess = async (run: AgentEvaluationRun, verdict: AgentEvaluationVerdict, notes?: string) => {
    try {
      const response = await ipcClient.invoke('agentEvaluation.assess', { runId: run.id, verdict, notes })
      setBundles((previous) => previous.map((item) => item.suite.id === run.suiteId ? { ...item, runs: item.runs.map((candidate) => candidate.id === run.id ? response.run : candidate) } : item))
      toast.success(t('messages.assessed'))
    } catch (error) {
      toast.error(t('messages.assessFailed'), { description: String(error) })
      throw error
    }
  }

  const archive = async (suite: AgentEvaluationSuite) => {
    try {
      const response = await ipcClient.invoke('agentEvaluation.archive', { suiteId: suite.id })
      setBundles((previous) => includeArchived ? previous.map((item) => item.suite.id === suite.id ? { ...item, suite: response.suite } : item) : previous.filter((item) => item.suite.id !== suite.id))
      if (!includeArchived) setSelectedSuiteId((previous) => previous === suite.id ? null : previous)
      toast.success(t('messages.archived'))
    } catch (error) {
      toast.error(t('messages.archiveFailed'), { description: String(error) })
    }
  }

  const toggleArchived = () => {
    const next = !includeArchived
    setIncludeArchived(next)
    void load(next)
  }
  const refreshAfterBatch = useCallback(() => {
    void load(includeArchived)
  }, [includeArchived, load])

  return (
    <div className="flex min-h-0 flex-1 overflow-hidden bg-background">
      <aside className="flex w-72 shrink-0 flex-col border-r border-border bg-muted/15">
        <div className="border-b border-border px-4 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-[12px] font-semibold text-foreground">{t('sidebarTitle')}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{t('count', { count: bundles.length })}</div>
            </div>
            <button type="button" aria-label={t('newSuite')} disabled={!currentWorkspace || profiles.length === 0} onClick={() => setSuiteCreateOpen(true)} title={!currentWorkspace ? t('suite.workspaceRequired') : t('newSuite')} className="rounded-lg bg-primary p-2 text-primary-foreground disabled:opacity-40"><Plus className="h-4 w-4" /></button>
          </div>
          <button type="button" onClick={toggleArchived} className="mt-3 text-[10px] text-muted-foreground hover:text-foreground">{includeArchived ? t('hideArchived') : t('showArchived')}</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-2">
          {loading ? <div className="flex justify-center py-10"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div> : bundles.map((item) => (
            <button key={item.suite.id} type="button" onClick={() => setSelectedSuiteId(item.suite.id)} className={cn('mb-1 w-full rounded-xl border px-3 py-3 text-left transition-colors', selectedSuiteId === item.suite.id ? 'border-primary/30 bg-primary/10' : 'border-transparent hover:bg-accent')}>
              <div className="flex items-start gap-2">
                <FlaskConical className={cn('mt-0.5 h-4 w-4 shrink-0', selectedSuiteId === item.suite.id ? 'text-primary' : 'text-muted-foreground')} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-medium text-foreground">{item.suite.name}</div>
                  <div className="mt-1 truncate text-[10px] text-muted-foreground">{profileMap.get(item.suite.profileId)?.name || item.suite.profileId}</div>
                  <div className="mt-2 flex gap-3 text-[9px] text-muted-foreground"><span>{item.scenarios.length} {t('summary.scenarios')}</span><span>{item.runs.length} {t('summary.runs')}</span></div>
                </div>
              </div>
            </button>
          ))}
        </div>
      </aside>

      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        {!selected ? (
          <div className="flex min-h-full flex-col items-center justify-center px-8 text-center">
            <FlaskConical className="h-10 w-10 text-muted-foreground/40" />
            <h1 className="mt-4 text-[18px] font-semibold text-foreground">{bundles.length === 0 ? t('empty.title') : t('empty.select')}</h1>
            <p className="mt-2 max-w-lg text-[12px] leading-relaxed text-muted-foreground">{t('empty.description')}</p>
          </div>
        ) : (
          <div className="mx-auto w-full max-w-7xl px-7 py-7">
            <header className="flex flex-wrap items-start justify-between gap-5">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-primary"><Sparkles className="h-4 w-4" /><span className="text-[10px] font-semibold uppercase tracking-[0.16em]">{t('eyebrow')}</span></div>
                <h1 className="mt-2 text-[23px] font-semibold tracking-tight text-foreground">{selected.suite.name}</h1>
                {selected.suite.description ? <p className="mt-2 max-w-3xl text-[12px] leading-relaxed text-muted-foreground">{selected.suite.description}</p> : null}
                <div className="mt-3 flex flex-wrap gap-2"><span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground"><Bot className="h-3 w-3" />{profileMap.get(selected.suite.profileId)?.name || selected.suite.profileId}</span>{selected.suite.versionId ? <span className="rounded-full border border-primary/20 bg-primary/[0.05] px-3 py-1 font-mono text-[10px] text-primary">v{versionMap.get(selected.suite.versionId)?.number ?? '?'} · {versionMap.get(selected.suite.versionId)?.digest.slice(0, 8) ?? selected.suite.versionId.slice(0, 8)}</span> : null}</div>
              </div>
              <div className="flex gap-2">
                <button type="button" disabled={!canCloneSelected} onClick={() => setCloneVersionOpen(true)} title={selected.scenarios.length === 0 ? t('clone.taskRequired') : t('clone.action')} className="inline-flex items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/[0.04] px-3 py-2 text-[11px] text-primary hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-40"><GitCompareArrows className="h-3.5 w-3.5" />{t('clone.action')}</button>
                {selected.suite.status === 'active' ? <button type="button" disabled={!canMutateSelected} onClick={() => setScenarioCreateOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-[11px] font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-40"><Plus className="h-3.5 w-3.5" />{t('newScenario')}</button> : null}
                {selected.suite.status === 'active' ? <button type="button" disabled={!canMutateSelected} onClick={() => void archive(selected.suite)} className="inline-flex items-center gap-1.5 rounded-lg border border-border px-3 py-2 text-[11px] text-muted-foreground hover:bg-accent disabled:cursor-not-allowed disabled:opacity-40"><Archive className="h-3.5 w-3.5" />{t('archive')}</button> : <span className="rounded-full bg-muted px-3 py-1 text-[10px] text-muted-foreground">{t('suite.archived')}</span>}
              </div>
            </header>

            {summary ? <div className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
              {[
                [t('summary.scenarios'), selected.scenarios.length],
                [t('summary.runs'), summary.total],
                [t('summary.passRate'), summary.passRate == null ? t('summary.notAvailable') : `${Math.round(summary.passRate * 100)}%`],
                [t('summary.pending'), summary.pending],
              ].map(([label, value]) => <div key={String(label)} className="rounded-xl border border-border bg-muted/15 px-4 py-3"><div className="text-[10px] text-muted-foreground">{label}</div><div className="mt-1 text-[20px] font-semibold text-foreground">{value}</div></div>)}
            </div> : null}

            <AgentEvaluationBatchPanel
              key={`batch:${selected.suite.id}`}
              bundle={selected}
              canRun={canMutateSelected && !!selected.suite.versionId}
              onRunsChanged={refreshAfterBatch}
            />

            {baselineOptions.length > 0 ? (
              <AgentEvaluationComparisonPanel
                key={selected.suite.id}
                candidate={selected}
                baselineOptions={baselineOptions}
                versions={versions}
              />
            ) : null}

            <div className="mt-6 space-y-4">
              {selected.scenarios.length === 0 ? <div className="rounded-2xl border border-dashed border-border px-6 py-16 text-center text-[12px] text-muted-foreground">{t('empty.scenario')}</div> : selected.scenarios.map((scenario) => {
                const runs = selected.runs.filter((run) => run.scenarioId === scenario.id)
                const attachedCaseIds = new Set(runs.map((run) => run.sourceCaseId))
                const availableCases = cases.filter((agentCase) => agentCase.workspacePath === selected.suite.workspacePath && agentCase.provenance?.agent?.profileId === selected.suite.profileId && agentCase.provenance?.agent?.versionId === selected.suite.versionId && !attachedCaseIds.has(agentCase.id))
                return <ScenarioCard key={scenario.id} scenario={scenario} runs={runs} availableCases={availableCases} canMutate={canMutateSelected} canRun={profileMap.has(selected.suite.profileId) && !!selected.suite.versionId} onRun={() => { if (!selected.suite.versionId) return; void onRunScenario(selected.suite.workspacePath, selected.suite.profileId, selected.suite.versionId, scenario.prompt).catch((error) => toast.error(t('messages.runFailed'), { description: String(error) })) }} onAttach={(caseId) => attachCase(scenario, caseId)} onAssess={assess} onOpenSource={(run) => void onOpenSource(selected.suite.workspacePath, run.evidence.sourceSessionId, run.evidence.sourceSessionFile)} />
              })}
            </div>
          </div>
        )}
      </main>

      {suiteCreateOpen && currentWorkspace ? <SuiteCreateDialog profiles={profiles} versions={versions} workspacePath={currentWorkspace} onClose={() => setSuiteCreateOpen(false)} onCreate={createSuite} initialProfileId={initialOpenRequest?.profileId} initialVersionId={initialOpenRequest?.versionId} /> : null}
      {scenarioCreateOpen ? <ScenarioCreateDialog onClose={() => setScenarioCreateOpen(false)} onCreate={createScenario} /> : null}
      {cloneVersionOpen && selected ? <CloneVersionDialog source={selected} versions={versions} onClose={() => setCloneVersionOpen(false)} onClone={cloneForVersion} /> : null}
    </div>
  )
}
