import { useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Boxes,
  CircleAlert,
  FileText,
  Layers3,
  Loader2,
  Package,
  Puzzle,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import type {
  AgentPiResourceKind,
  AgentPiResourceSelection,
  AgentProviderRequirements,
  AgentProfilePreviewResponse,
} from '@shared/agent-profile'
import type { AgentProviderRequirementIssue } from '@shared/agent-provider-requirements'
import type {
  PiResourceCenterItem,
  PiResourceCenterSnapshot,
} from '@shared/pi-resource-center'
import { cn } from '@renderer/lib/utils'

const RESOURCE_KINDS: AgentPiResourceKind[] = ['skills', 'extensions', 'prompts']

function toggleValue(values: string[], value: string): string[] {
  return values.includes(value)
    ? values.filter((item) => item !== value)
    : [...values, value]
}

function resourceIcon(kind: AgentPiResourceKind) {
  if (kind === 'skills') return <Sparkles className="h-3.5 w-3.5" />
  if (kind === 'extensions') return <Puzzle className="h-3.5 w-3.5" />
  return <FileText className="h-3.5 w-3.5" />
}

export function AgentProviderRequirementsEditor({
  requirements,
  onChange,
}: {
  requirements: AgentProviderRequirements
  onChange: (requirements: AgentProviderRequirements) => void
}) {
  const { t } = useTranslation('agents')
  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div>
        <h3 className="text-[12px] font-semibold text-foreground">
          {t('composer.providerRequirements')}
        </h3>
        <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
          {t('composer.providerRequirementsHint')}
        </p>
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {(['reasoning', 'imageInput'] as const).map((key) => (
          <label
            key={key}
            className={cn(
              'flex cursor-pointer items-start gap-2 rounded-lg border px-3 py-2.5 transition-colors',
              requirements[key]
                ? 'border-primary/40 bg-primary/5'
                : 'border-border/60 bg-background/60 hover:border-primary/25',
            )}
          >
            <input
              type="checkbox"
              className="mt-0.5"
              checked={requirements[key]}
              onChange={(event) => onChange({ ...requirements, [key]: event.target.checked })}
            />
            <span>
              <span className="block text-[11px] font-medium text-foreground">
                {t(`composer.requirement.${key}`)}
              </span>
              <span className="mt-0.5 block text-[9px] leading-relaxed text-muted-foreground">
                {t(`composer.requirement.${key}Hint`)}
              </span>
            </span>
          </label>
        ))}
      </div>
      <label className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-background/60 px-3 py-2.5">
        <span>
          <span className="block text-[11px] font-medium text-foreground">
            {t('composer.requirement.minContextWindow')}
          </span>
          <span className="mt-0.5 block text-[9px] text-muted-foreground">
            {t('composer.requirement.minContextWindowHint')}
          </span>
        </span>
        <input
          type="number"
          min={1}
          max={10_000_000}
          step={1_000}
          value={requirements.minContextWindow ?? ''}
          placeholder="128000"
          onChange={(event) => {
            const value = Number.parseInt(event.target.value, 10)
            onChange({
              ...requirements,
              minContextWindow: Number.isFinite(value) && value > 0 ? value : undefined,
            })
          }}
          className="w-28 rounded-md border border-border bg-background px-2 py-1.5 text-right font-mono text-[10px] outline-none focus:border-primary/60"
        />
      </label>
    </section>
  )
}

function ResourceRow({
  resource,
  selected,
  inheritedFromPackage,
  onToggle,
}: {
  resource: PiResourceCenterItem
  selected: boolean
  inheritedFromPackage: boolean
  onToggle: () => void
}) {
  const { t } = useTranslation('agents')
  const disabled = !resource.enabled || inheritedFromPackage
  return (
    <label
      className={cn(
        'flex min-w-0 items-start gap-2 rounded-lg border px-2.5 py-2 transition-colors',
        selected ? 'border-primary/35 bg-primary/5' : 'border-border/60 bg-background/60',
        disabled && 'cursor-not-allowed opacity-65',
        !disabled && 'cursor-pointer hover:border-primary/25',
      )}
    >
      <input
        type="checkbox"
        className="mt-0.5"
        checked={selected}
        disabled={disabled}
        onChange={onToggle}
      />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5 text-[11px] font-medium text-foreground">
          {resourceIcon(resource.kind as AgentPiResourceKind)}
          <span className="truncate">{resource.name}</span>
        </span>
        <span className="mt-0.5 block truncate font-mono text-[9px] text-muted-foreground">
          {resource.source}
        </span>
        {resource.kind === 'extensions' && resource.tools?.length ? (
          <span className="mt-0.5 block text-[9px] text-muted-foreground">
            {t('composer.registeredTools', { count: resource.tools.length })}
          </span>
        ) : null}
        {!resource.enabled ? (
          <span className="mt-0.5 block text-[9px] text-amber-600 dark:text-amber-400">
            {t('composer.disabledByPi')}
          </span>
        ) : inheritedFromPackage ? (
          <span className="mt-0.5 block text-[9px] text-primary">
            {t('composer.includedByPackage')}
          </span>
        ) : null}
      </span>
    </label>
  )
}

export function AgentPiResourcesEditor({
  selection,
  catalog,
  loading,
  onChange,
}: {
  selection: AgentPiResourceSelection
  catalog?: PiResourceCenterSnapshot
  loading: boolean
  onChange: (selection: AgentPiResourceSelection) => void
}) {
  const { t } = useTranslation('agents')
  const selectedPackages = useMemo(() => new Set(selection.packageIds), [selection.packageIds])
  const selectedResources = useMemo(() => new Set(selection.resourceIds), [selection.resourceIds])

  return (
    <section className="space-y-3 rounded-xl border border-border/70 bg-muted/10 p-4">
      <div className="flex items-start gap-2.5">
        <Boxes className="mt-0.5 h-4 w-4 text-primary" />
        <div>
          <h3 className="text-[12px] font-semibold text-foreground">
            {t('composer.piResources')}
          </h3>
          <p className="mt-0.5 text-[10px] leading-relaxed text-muted-foreground">
            {t('composer.piResourcesHint')}
          </p>
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        {(['inherit', 'selected'] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => onChange({ ...selection, mode })}
            className={cn(
              'rounded-lg border px-3 py-2 text-left transition-colors',
              selection.mode === mode
                ? 'border-primary/45 bg-primary/8'
                : 'border-border/70 hover:bg-accent/40',
            )}
          >
            <span className="block text-[11px] font-medium text-foreground">
              {t(`composer.mode.${mode}`)}
            </span>
            <span className="mt-0.5 block text-[9px] leading-relaxed text-muted-foreground">
              {t(`composer.mode.${mode}Hint`)}
            </span>
          </button>
        ))}
      </div>

      <label className="flex items-center justify-between gap-4 rounded-lg border border-border/60 bg-background/60 px-3 py-2">
        <span>
          <span className="block text-[11px] font-medium text-foreground">
            {t('composer.projectContext')}
          </span>
          <span className="mt-0.5 block text-[9px] text-muted-foreground">
            {t('composer.projectContextHint')}
          </span>
        </span>
        <select
          value={selection.projectContext}
          onChange={(event) =>
            onChange({
              ...selection,
              projectContext: event.target.value as AgentPiResourceSelection['projectContext'],
            })
          }
          className="rounded-md border border-border bg-background px-2 py-1.5 text-[10px]"
        >
          <option value="inherit">{t('composer.context.inherit')}</option>
          <option value="none">{t('composer.context.none')}</option>
        </select>
      </label>

      {selection.mode === 'selected' ? (
        loading && !catalog ? (
          <div className="flex items-center justify-center py-8 text-[11px] text-muted-foreground">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            {t('composer.loadingResources')}
          </div>
        ) : catalog ? (
          <div className="space-y-4">
            <div>
              <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-foreground">
                <Package className="h-3.5 w-3.5" />
                {t('composer.packages')}
              </div>
              {catalog.packages.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border/70 px-3 py-3 text-[10px] text-muted-foreground">
                  {t('composer.noPackages')}
                </p>
              ) : (
                <div className="grid gap-2 sm:grid-cols-2">
                  {catalog.packages.map((pkg) => {
                    const checked = selectedPackages.has(pkg.id)
                    return (
                      <label
                        key={pkg.id}
                        className={cn(
                          'flex cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2',
                          checked
                            ? 'border-primary/35 bg-primary/5'
                            : 'border-border/60 bg-background/60',
                          !pkg.installed && 'cursor-not-allowed opacity-60',
                        )}
                      >
                        <input
                          type="checkbox"
                          className="mt-0.5"
                          checked={checked}
                          disabled={!pkg.installed}
                          onChange={() =>
                            onChange({
                              ...selection,
                              packageIds: toggleValue(selection.packageIds, pkg.id),
                            })
                          }
                        />
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] font-medium text-foreground">
                            {pkg.name}
                          </span>
                          <span className="mt-0.5 block text-[9px] text-muted-foreground">
                            {t('composer.packageResources', {
                              count:
                                pkg.resources.extensions +
                                pkg.resources.skills +
                                pkg.resources.prompts,
                            })}
                          </span>
                        </span>
                      </label>
                    )
                  })}
                </div>
              )}
            </div>

            {RESOURCE_KINDS.map((kind) => {
              const rows = catalog.resources[kind]
              return (
                <div key={kind}>
                  <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold text-foreground">
                    {resourceIcon(kind)}
                    {t(`composer.kind.${kind}`)}
                    <span className="font-normal text-muted-foreground">{rows.length}</span>
                  </div>
                  {rows.length === 0 ? (
                    <p className="text-[10px] text-muted-foreground">
                      {t('composer.noResources')}
                    </p>
                  ) : (
                    <div className="grid gap-2 sm:grid-cols-2">
                      {rows.map((resource) => {
                        const inheritedFromPackage = Boolean(
                          resource.packageId && selectedPackages.has(resource.packageId),
                        )
                        const selected =
                          inheritedFromPackage || selectedResources.has(resource.id)
                        return (
                          <ResourceRow
                            key={resource.id}
                            resource={resource}
                            selected={selected}
                            inheritedFromPackage={inheritedFromPackage}
                            onToggle={() =>
                              onChange({
                                ...selection,
                                resourceIds: toggleValue(selection.resourceIds, resource.id),
                              })
                            }
                          />
                        )
                      })}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        ) : (
          <p className="text-[10px] text-destructive">{t('composer.previewFailed')}</p>
        )
      ) : null}
    </section>
  )
}

export function AgentEffectiveConfigPreview({
  preview,
  loading,
  model,
  thinking,
  promptMode,
  tools,
  extensionTools,
  providerRequirements,
  providerIssues,
}: {
  preview?: AgentProfilePreviewResponse
  loading: boolean
  model: string
  thinking: string
  promptMode: 'append' | 'replace'
  tools?: string[]
  extensionTools?: string[]
  providerRequirements: AgentProviderRequirements
  providerIssues: AgentProviderRequirementIssue[]
}) {
  const { t } = useTranslation('agents')
  const resourceCounts = useMemo(() => {
    const counts: Record<AgentPiResourceKind, number> = {
      extensions: 0,
      skills: 0,
      prompts: 0,
    }
    for (const resource of preview?.resourceSnapshot.resources ?? []) {
      counts[resource.kind] += 1
    }
    return counts
  }, [preview])

  return (
    <aside className="space-y-4 lg:sticky lg:top-0">
      <div className="flex items-center gap-2">
        <Layers3 className="h-4 w-4 text-primary" />
        <h3 className="text-[12px] font-semibold text-foreground">
          {t('composer.previewTitle')}
        </h3>
        {loading ? <Loader2 className="ml-auto h-3.5 w-3.5 animate-spin text-muted-foreground" /> : null}
      </div>
      <p className="text-[10px] leading-relaxed text-muted-foreground">
        {t('composer.previewHint')}
      </p>

      <dl className="space-y-2 rounded-xl border border-border/70 bg-background/70 p-3 text-[10px]">
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t('model')}</dt>
          <dd className="truncate font-mono text-foreground">{model || t('inherits')}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t('thinking')}</dt>
          <dd className="text-foreground">{thinking || t('inherits')}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">System Prompt</dt>
          <dd className="text-foreground">{t(`promptMode.${promptMode}`)}</dd>
        </div>
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">{t('tools')}</dt>
          <dd className="text-foreground">{tools === undefined ? t('inherits') : tools.length}</dd>
        </div>
        {tools !== undefined ? (
          <div className="flex items-center justify-between gap-3">
            <dt className="text-muted-foreground">{t('composer.extensionTools')}</dt>
            <dd className="text-foreground">
              {extensionTools === undefined ? t('composer.allSelectedExtensionTools') : extensionTools.length}
            </dd>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <dt className="text-muted-foreground">Pi Runtime</dt>
          <dd className="font-mono text-foreground">
            {preview?.resourceSnapshot.sdkVersion || '—'}
          </dd>
        </div>
      </dl>

      <div className="grid grid-cols-3 gap-2">
        {RESOURCE_KINDS.map((kind) => (
          <div key={kind} className="rounded-lg border border-border/60 bg-background/70 p-2 text-center">
            <div className="mx-auto flex justify-center text-primary">{resourceIcon(kind)}</div>
            <div className="mt-1 text-[15px] font-semibold text-foreground">
              {resourceCounts[kind]}
            </div>
            <div className="mt-0.5 text-[8px] text-muted-foreground">
              {t(`composer.kind.${kind}`)}
            </div>
          </div>
        ))}
      </div>

      <div className="rounded-xl border border-border/70 bg-background/70 p-3">
        <div className="flex items-center gap-2 text-[10px] font-medium text-foreground">
          {preview?.resourceSnapshot.projectContext === 'none' ? (
            <CircleAlert className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <ShieldCheck className="h-3.5 w-3.5 text-primary" />
          )}
          {t('composer.projectContext')}
        </div>
        <p className="mt-1 text-[9px] leading-relaxed text-muted-foreground">
          {t(
            preview?.resourceSnapshot.projectContext === 'none'
              ? 'composer.context.nonePreview'
              : 'composer.context.inheritPreview',
          )}
        </p>
      </div>

      {(providerRequirements.reasoning ||
        providerRequirements.imageInput ||
        providerRequirements.minContextWindow) && (
        <div className="rounded-xl border border-border/70 bg-background/70 p-3">
          <div className="text-[10px] font-medium text-foreground">
            {t('composer.providerRequirements')}
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[9px] text-muted-foreground">
            {providerRequirements.reasoning ? (
              <span className="rounded-md bg-muted/60 px-2 py-1">
                {t('composer.requirement.reasoning')}
              </span>
            ) : null}
            {providerRequirements.imageInput ? (
              <span className="rounded-md bg-muted/60 px-2 py-1">
                {t('composer.requirement.imageInput')}
              </span>
            ) : null}
            {providerRequirements.minContextWindow ? (
              <span className="rounded-md bg-muted/60 px-2 py-1 font-mono">
                ≥ {providerRequirements.minContextWindow.toLocaleString()} tokens
              </span>
            ) : null}
          </div>
        </div>
      )}

      {providerIssues.length > 0 ? (
        <div className="space-y-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3">
          {providerIssues.map((issue) => (
            <div key={issue} className="flex gap-2">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" />
              <p className="text-[9px] leading-relaxed text-destructive">
                {t(`composer.providerIssue.${issue}`)}
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {preview?.warnings.length ? (
        <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
          {preview.warnings.map((warning) => (
            <div key={`${warning.code}:${warning.ids?.join(',')}`} className="flex gap-2">
              <CircleAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
              <p className="text-[9px] leading-relaxed text-amber-800 dark:text-amber-200">
                {t(`composer.warning.${warning.code}`, { count: warning.ids?.length ?? 0 })}
              </p>
            </div>
          ))}
        </div>
      ) : preview && providerIssues.length === 0 ? (
        <div className="flex items-center gap-2 rounded-xl border border-primary/20 bg-primary/5 p-3 text-[10px] text-primary">
          <ShieldCheck className="h-3.5 w-3.5" />
          {t('composer.ready')}
        </div>
      ) : null}
    </aside>
  )
}
