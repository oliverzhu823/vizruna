import { useEffect, useState } from 'react'
import { Archive, Copy, Loader2, MessageSquareText, Pencil, Play, Plus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import type { SystemPromptPreset } from '@shared/system-prompt-preset'
import { ipcClient } from '@renderer/lib/ipc-client'
import { useAgentProfileStore } from '@renderer/stores/agent-profile-store'
import {
  SystemPromptEditorDialog,
  type SystemPromptDraft,
} from './system-prompt-editor-dialog'

type DialogState =
  | { mode: 'create' }
  | { mode: 'edit' | 'duplicate'; preset: SystemPromptPreset }

function draftFromPreset(preset: SystemPromptPreset, duplicate: boolean): SystemPromptDraft {
  return {
    name: duplicate ? `${preset.name} Copy` : preset.name,
    description: preset.description ?? '',
    systemPrompt: preset.systemPrompt,
    promptMode: preset.promptMode,
  }
}

export function SystemPromptPresetsPanel() {
  const { t, i18n } = useTranslation('systemPrompts')
  const presets = useAgentProfileStore((state) => state.promptPresets)
  const loading = useAgentProfileStore((state) => state.promptPresetsLoading)
  const loadPromptPresets = useAgentProfileStore((state) => state.loadPromptPresets)
  const selectPromptPreset = useAgentProfileStore((state) => state.selectPromptPreset)
  const [dialog, setDialog] = useState<DialogState | null>(null)

  useEffect(() => {
    void loadPromptPresets().catch((error) => {
      toast.error(t('messages.loadFailed'), { description: String(error) })
    })
  }, [loadPromptPresets, t])

  const save = async (draft: SystemPromptDraft) => {
    try {
      if (dialog?.mode === 'edit') {
        await ipcClient.invoke('systemPromptPreset.update', {
          id: dialog.preset.id,
          name: draft.name,
          description: draft.description,
          systemPrompt: draft.systemPrompt,
          promptMode: draft.promptMode,
        })
        toast.success(t('messages.updated'))
      } else {
        await ipcClient.invoke('systemPromptPreset.create', {
          name: draft.name,
          description: draft.description || undefined,
          systemPrompt: draft.systemPrompt,
          promptMode: draft.promptMode,
        })
        toast.success(t('messages.created'))
      }
      await loadPromptPresets(true)
      setDialog(null)
    } catch (error) {
      toast.error(t('messages.saveFailed'), { description: String(error) })
      throw error
    }
  }

  const archive = async (preset: SystemPromptPreset) => {
    if (!window.confirm(t('messages.archiveConfirm', { name: preset.name }))) return
    try {
      await ipcClient.invoke('systemPromptPreset.archive', { id: preset.id })
      if (useAgentProfileStore.getState().selectedPromptPresetId === preset.id) {
        useAgentProfileStore.getState().selectGeneral()
      }
      await loadPromptPresets(true)
      toast.success(t('messages.archived'))
    } catch (error) {
      toast.error(t('messages.archiveFailed'), { description: String(error) })
    }
  }

  const activatePreset = (presetId: string) => {
    selectPromptPreset(presetId)
    window.dispatchEvent(
      new CustomEvent('vizruna:use-system-prompt', { detail: { presetId } }),
    )
  }

  return (
    <div className="w-full">
      <div className="flex items-start justify-between gap-5">
        <div>
          <div className="flex items-center gap-2">
            <MessageSquareText className="h-5 w-5 text-primary" />
            <h3 className="text-[15px] font-semibold text-foreground">{t('title')}</h3>
          </div>
          <p className="mt-1.5 max-w-3xl text-[11px] leading-relaxed text-muted-foreground">
            {t('description')}
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDialog({ mode: 'create' })}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-primary px-3.5 py-2 text-[12px] font-medium text-primary-foreground hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          {t('new')}
        </button>
      </div>

      <div className="mt-5 border-b border-border/60 pb-3 text-[11px] text-muted-foreground">
        {t('count', { count: presets.length })}
      </div>

      {loading && presets.length === 0 ? (
        <div className="flex min-h-64 items-center justify-center text-[12px] text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          {t('loading')}
        </div>
      ) : presets.length === 0 ? (
        <div className="mt-5 flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-border/80 bg-muted/15 px-6 text-center">
          <MessageSquareText className="h-8 w-8 text-muted-foreground/45" />
          <h4 className="mt-3 text-[13px] font-semibold text-foreground">{t('empty.title')}</h4>
          <p className="mt-1 max-w-md text-[11px] leading-relaxed text-muted-foreground">
            {t('empty.description')}
          </p>
        </div>
      ) : (
        <div className="mt-4 grid gap-3 xl:grid-cols-2">
          {presets.map((preset) => (
            <article
              key={preset.id}
              className="flex min-h-48 flex-col rounded-xl border border-border/70 bg-card/50 p-4 shadow-sm"
            >
              <div className="flex items-start gap-3">
                <div className="rounded-lg bg-primary/10 p-2 text-primary">
                  <MessageSquareText className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <h4 className="truncate text-[13px] font-semibold text-foreground">
                    {preset.name}
                  </h4>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-muted-foreground">
                    {preset.description || t(`form.${preset.promptMode}Hint`)}
                  </p>
                </div>
              </div>
              <p className="mt-3 line-clamp-3 whitespace-pre-wrap rounded-lg bg-muted/35 px-3 py-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                {preset.systemPrompt}
              </p>
              <div className="mt-3 flex items-center justify-between gap-3 text-[10px] text-muted-foreground">
                <span>{t(`form.${preset.promptMode}`)}</span>
                <time>
                  {new Intl.DateTimeFormat(i18n.language, {
                    year: 'numeric',
                    month: 'short',
                    day: 'numeric',
                  }).format(preset.updatedAt)}
                </time>
              </div>
              <div className="mt-auto flex flex-wrap items-center gap-1 border-t border-border/50 pt-3">
                <button
                  type="button"
                  onClick={() => activatePreset(preset.id)}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-medium text-primary-foreground hover:bg-primary/90"
                >
                  <Play className="h-3.5 w-3.5" />
                  {t('use')}
                </button>
                <button
                  type="button"
                  onClick={() => setDialog({ mode: 'edit', preset })}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Pencil className="h-3.5 w-3.5" />
                  {t('edit')}
                </button>
                <button
                  type="button"
                  onClick={() => setDialog({ mode: 'duplicate', preset })}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <Copy className="h-3.5 w-3.5" />
                  {t('duplicate')}
                </button>
                <button
                  type="button"
                  onClick={() => void archive(preset)}
                  className="ml-auto inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[11px] text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                >
                  <Archive className="h-3.5 w-3.5" />
                  {t('archive')}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}

      {dialog && (
        <SystemPromptEditorDialog
          title={t(
            dialog.mode === 'edit'
              ? 'form.editTitle'
              : dialog.mode === 'duplicate'
                ? 'form.duplicateTitle'
                : 'form.createTitle',
          )}
          initialDraft={
            'preset' in dialog
              ? draftFromPreset(dialog.preset, dialog.mode === 'duplicate')
              : undefined
          }
          primaryLabel={t('form.save')}
          onClose={() => setDialog(null)}
          onSubmit={save}
        />
      )}
    </div>
  )
}
