import { useEffect, useRef, useState } from 'react'
import {
  Bot,
  Check,
  ChevronDown,
  MessageSquareText,
  Plus,
  Settings2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { ipcClient } from '@renderer/lib/ipc-client'
import { cn } from '@renderer/lib/utils'
import { useAgentProfileStore } from '@renderer/stores/agent-profile-store'
import {
  SystemPromptEditorDialog,
  type SystemPromptDraft,
} from '@renderer/features/system-prompts/system-prompt-editor-dialog'

export function ComposerAgentStrip({ editable }: { editable: boolean }) {
  const { t } = useTranslation('systemPrompts')
  const { t: tAgents } = useTranslation('agents')
  const profiles = useAgentProfileStore((state) => state.profiles)
  const promptPresets = useAgentProfileStore((state) => state.promptPresets)
  const selectedProfileId = useAgentProfileStore((state) => state.selectedProfileId)
  const selectedPromptPresetId = useAgentProfileStore((state) => state.selectedPromptPresetId)
  const temporaryPrompt = useAgentProfileStore((state) => state.temporaryPrompt)
  const activeBinding = useAgentProfileStore((state) => state.activeBinding)
  const bindingLoading = useAgentProfileStore((state) => state.bindingLoading)
  const selectProfile = useAgentProfileStore((state) => state.selectProfile)
  const selectPromptPreset = useAgentProfileStore((state) => state.selectPromptPreset)
  const selectTemporaryPrompt = useAgentProfileStore((state) => state.selectTemporaryPrompt)
  const selectGeneral = useAgentProfileStore((state) => state.selectGeneral)
  const loadProfiles = useAgentProfileStore((state) => state.loadProfiles)
  const loadPromptPresets = useAgentProfileStore((state) => state.loadPromptPresets)
  const [open, setOpen] = useState(false)
  const [temporaryDialogOpen, setTemporaryDialogOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!editable) return
    void Promise.all([loadProfiles(), loadPromptPresets()]).catch(() => {})
  }, [editable, loadProfiles, loadPromptPresets])

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
  }, [open])

  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId)
  const selectedPreset = promptPresets.find((preset) => preset.id === selectedPromptPresetId)
  const editableLabel =
    temporaryPrompt?.name || selectedPreset?.name || selectedProfile?.name || tAgents('general.name')
  const label = editable
    ? editableLabel
    : bindingLoading
      ? tAgents('loadingBinding')
      : activeBinding?.snapshot.name || tAgents('general.name')
  const selectionKind = editable
    ? temporaryPrompt || selectedPromptPresetId
      ? 'prompt'
      : selectedProfileId
        ? 'agent'
        : 'general'
    : activeBinding?.kind ?? 'general'
  const SelectedIcon = selectionKind === 'prompt' ? MessageSquareText : Bot
  const generalSelected =
    selectedProfileId == null && selectedPromptPresetId == null && temporaryPrompt == null

  const submitTemporaryPrompt = async (
    draft: SystemPromptDraft,
    action: 'primary' | 'secondary',
  ) => {
    if (action === 'primary') {
      selectTemporaryPrompt({
        name: draft.name,
        systemPrompt: draft.systemPrompt,
        promptMode: draft.promptMode,
      })
    } else {
      try {
        const response = await ipcClient.invoke('systemPromptPreset.create', {
          name: draft.name,
          description: draft.description || undefined,
          systemPrompt: draft.systemPrompt,
          promptMode: draft.promptMode,
        })
        if (!response?.preset) throw new Error('System prompt mutation returned no preset')
        await loadPromptPresets(true)
        selectPromptPreset(response.preset.id)
        toast.success(t('temporary.saved'))
      } catch (error) {
        toast.error(t('messages.saveFailed'), { description: String(error) })
        throw error
      }
    }
    setTemporaryDialogOpen(false)
  }

  if (!editable) {
    return (
      <div
        className="composer-meta-text flex min-w-0 max-w-[180px] items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-foreground-secondary/70"
        title={label}
      >
        <SelectedIcon className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
    )
  }

  return (
    <>
      <div ref={rootRef} className="relative min-w-0">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          aria-haspopup="listbox"
          aria-expanded={open}
          title={t('selector.hint')}
          className="composer-meta-text flex max-w-[190px] items-center gap-1.5 truncate rounded-md px-1.5 py-1 text-foreground-secondary/75 transition-colors hover:bg-accent/60 hover:text-foreground"
        >
          <SelectedIcon className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          <ChevronDown
            className={cn('h-3.5 w-3.5 shrink-0 transition-transform', open && 'rotate-180')}
          />
        </button>

        {open && (
          <div
            role="listbox"
            className="absolute bottom-[calc(100%+8px)] left-0 z-[80] w-[330px] overflow-hidden rounded-xl border border-border/80 bg-popover shadow-xl"
          >
            <div className="border-b border-border/50 px-3 py-2.5">
              <div className="text-[12px] font-medium text-foreground">{t('selector.title')}</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
                {t('selector.description')}
              </div>
            </div>
            <div className="max-h-[360px] overflow-y-auto py-1">
              <div className="px-3 pb-1 pt-1.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">
                {t('selector.generalGroup')}
              </div>
              <button
                type="button"
                role="option"
                aria-selected={generalSelected}
                onClick={() => {
                  selectGeneral()
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/70',
                  generalSelected && 'bg-accent/50',
                )}
              >
                <Bot className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-foreground">
                    {tAgents('general.name')}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                    {tAgents('general.description')}
                  </span>
                </span>
                {generalSelected && <Check className="mt-0.5 h-4 w-4 text-primary" />}
              </button>

              <div className="mt-1 border-t border-border/35 px-3 pb-1 pt-2.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">
                {t('selector.promptGroup')}
              </div>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  setTemporaryDialogOpen(true)
                }}
                className="flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/70"
              >
                <Plus className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12px] font-medium text-foreground">
                    {t('selector.temporary')}
                  </span>
                  <span className="mt-0.5 block text-[10px] leading-relaxed text-muted-foreground">
                    {t('selector.temporaryDescription')}
                  </span>
                </span>
              </button>
              {promptPresets.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  role="option"
                  aria-selected={selectedPromptPresetId === preset.id}
                  onClick={() => {
                    selectPromptPreset(preset.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/70',
                    selectedPromptPresetId === preset.id && 'bg-accent/50',
                  )}
                >
                  <MessageSquareText className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-foreground">
                      {preset.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {preset.description || t(`form.${preset.promptMode}`)}
                    </span>
                  </span>
                  {selectedPromptPresetId === preset.id && (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              ))}

              <div className="mt-1 border-t border-border/35 px-3 pb-1 pt-2.5 text-[9px] font-semibold uppercase tracking-[0.12em] text-muted-foreground/65">
                {t('selector.agentGroup')}
              </div>
              {profiles.map((profile) => (
                <button
                  key={profile.id}
                  type="button"
                  role="option"
                  aria-selected={selectedProfileId === profile.id}
                  onClick={() => {
                    selectProfile(profile.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors hover:bg-accent/70',
                    selectedProfileId === profile.id && 'bg-accent/50',
                  )}
                >
                  <Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary/80" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-foreground">
                      {profile.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted-foreground">
                      {profile.description || tAgents(`promptMode.${profile.promptMode}`)}
                    </span>
                  </span>
                  {selectedProfileId === profile.id && (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                  )}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-2 border-t border-border/50">
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  window.dispatchEvent(new CustomEvent('vizruna:open-system-prompts'))
                }}
                className="flex items-center gap-1.5 border-r border-border/50 px-3 py-2 text-left text-[10px] font-medium text-primary transition-colors hover:bg-accent/60"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t('selector.managePrompts')}
              </button>
              <button
                type="button"
                onClick={() => {
                  setOpen(false)
                  window.dispatchEvent(new CustomEvent('vizruna:open-agent-profiles'))
                }}
                className="flex items-center gap-1.5 px-3 py-2 text-left text-[10px] font-medium text-primary transition-colors hover:bg-accent/60"
              >
                <Settings2 className="h-3.5 w-3.5" />
                {t('selector.manageAgents')}
              </button>
            </div>
          </div>
        )}
      </div>

      {temporaryDialogOpen && (
        <SystemPromptEditorDialog
          title={t('temporary.title')}
          initialDraft={{ name: t('temporary.name'), promptMode: 'append' }}
          primaryLabel={t('temporary.useOnce')}
          secondaryLabel={t('temporary.saveAndUse')}
          onClose={() => setTemporaryDialogOpen(false)}
          onSubmit={submitTemporaryPrompt}
        />
      )}
    </>
  )
}
