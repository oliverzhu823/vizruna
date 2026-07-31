import { useState } from 'react'
import { Loader2, MessageSquareText, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentPromptMode } from '@shared/agent-profile'
import { cn } from '@renderer/lib/utils'

export type SystemPromptDraft = {
  name: string
  description: string
  systemPrompt: string
  promptMode: AgentPromptMode
}

export function SystemPromptEditorDialog({
  title,
  initialDraft,
  primaryLabel,
  secondaryLabel,
  onClose,
  onSubmit,
}: {
  title: string
  initialDraft?: Partial<SystemPromptDraft>
  primaryLabel: string
  secondaryLabel?: string
  onClose: () => void
  onSubmit: (draft: SystemPromptDraft, action: 'primary' | 'secondary') => Promise<void>
}) {
  const { t } = useTranslation('systemPrompts')
  const [draft, setDraft] = useState<SystemPromptDraft>({
    name: initialDraft?.name ?? '',
    description: initialDraft?.description ?? '',
    systemPrompt: initialDraft?.systemPrompt ?? '',
    promptMode: initialDraft?.promptMode ?? 'append',
  })
  const [savingAction, setSavingAction] = useState<'primary' | 'secondary' | null>(null)
  const valid = draft.name.trim().length > 0 && draft.systemPrompt.trim().length > 0

  const submit = async (action: 'primary' | 'secondary') => {
    if (!valid || savingAction) return
    setSavingAction(action)
    try {
      await onSubmit(
        {
          ...draft,
          name: draft.name.trim(),
          description: draft.description.trim(),
          systemPrompt: draft.systemPrompt.trim(),
        },
        action,
      )
    } finally {
      setSavingAction(null)
    }
  }

  return (
    <div
      className="fixed inset-0 z-[140] flex items-center justify-center bg-black/40 p-5 backdrop-blur-[2px]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !savingAction) onClose()
      }}
    >
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-border/80 bg-background shadow-2xl">
        <div className="flex items-center justify-between border-b border-border/60 px-5 py-4">
          <div className="flex items-center gap-2.5">
            <MessageSquareText className="h-5 w-5 text-primary" />
            <h2 className="text-[16px] font-semibold text-foreground">{title}</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={savingAction !== null}
            className="rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-[12px] font-medium text-foreground">{t('form.name')}</span>
              <input
                autoFocus
                value={draft.name}
                onChange={(event) => setDraft((value) => ({ ...value, name: event.target.value }))}
                placeholder={t('form.namePlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none transition-colors focus:border-primary/60"
              />
            </label>
            <label className="space-y-1.5">
              <span className="text-[12px] font-medium text-foreground">
                {t('form.description')}
              </span>
              <input
                value={draft.description}
                onChange={(event) =>
                  setDraft((value) => ({ ...value, description: event.target.value }))
                }
                placeholder={t('form.descriptionPlaceholder')}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-[13px] outline-none transition-colors focus:border-primary/60"
              />
            </label>
          </div>

          <label className="block space-y-1.5">
            <span className="text-[12px] font-medium text-foreground">
              {t('form.systemPrompt')}
            </span>
            <textarea
              value={draft.systemPrompt}
              onChange={(event) =>
                setDraft((value) => ({ ...value, systemPrompt: event.target.value }))
              }
              placeholder={t('form.systemPromptPlaceholder')}
              rows={14}
              className="w-full resize-y rounded-xl border border-border bg-background px-3 py-2.5 font-mono text-[12px] leading-relaxed outline-none transition-colors focus:border-primary/60"
            />
          </label>

          <fieldset className="space-y-2">
            <legend className="text-[12px] font-medium text-foreground">
              {t('form.promptMode')}
            </legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {(['append', 'replace'] as const).map((promptMode) => (
                <button
                  key={promptMode}
                  type="button"
                  onClick={() => setDraft((value) => ({ ...value, promptMode }))}
                  className={cn(
                    'rounded-xl border px-3 py-2.5 text-left transition-colors',
                    draft.promptMode === promptMode
                      ? 'border-primary/50 bg-primary/8'
                      : 'border-border hover:bg-accent/40',
                  )}
                >
                  <span className="block text-[12px] font-medium text-foreground">
                    {t(`form.${promptMode}`)}
                  </span>
                  <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground">
                    {t(`form.${promptMode}Hint`)}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border/60 px-5 py-4">
          <button
            type="button"
            onClick={onClose}
            disabled={savingAction !== null}
            className="rounded-lg px-3.5 py-2 text-[12px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
          >
            {t('form.cancel')}
          </button>
          {secondaryLabel && (
            <button
              type="button"
              disabled={!valid || savingAction !== null}
              onClick={() => void submit('secondary')}
              className="inline-flex items-center gap-2 rounded-lg border border-border px-3.5 py-2 text-[12px] font-medium text-foreground hover:bg-accent disabled:opacity-45"
            >
              {savingAction === 'secondary' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {savingAction === 'secondary' ? t('form.saving') : secondaryLabel}
            </button>
          )}
          <button
            type="button"
            disabled={!valid || savingAction !== null}
            onClick={() => void submit('primary')}
            className="inline-flex items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-45"
          >
            {savingAction === 'primary' && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
            {savingAction === 'primary' ? t('form.saving') : primaryLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
