// Thinking level picker: shows all levels with descriptions, /thinking opens this.

import { ipcClient } from '@renderer/lib/ipc-client'
import { useUIStore } from '@renderer/stores/ui-store'
import { cn } from '@renderer/lib/utils'
import { X, Brain, Check } from 'lucide-react'
import { toast } from 'sonner'
import { normalizeThinkingLevel } from '@renderer/lib/format-run-display'
import { useTranslation } from 'react-i18next'

const LEVELS: { key: string; label: string }[] = [
  { key: 'off', label: 'Off' },
  { key: 'minimal', label: 'Minimal' },
  { key: 'low', label: 'Low' },
  { key: 'medium', label: 'Medium' },
  { key: 'high', label: 'High' },
  { key: 'xhigh', label: 'XHigh' },
]

export function ThinkingPicker() {
  const { t } = useTranslation('composer')
  const open = useUIStore((s) => s.thinkingPickerOpen)
  const setOpen = useUIStore((s) => s.setThinkingPickerOpen)
  const current = normalizeThinkingLevel(useUIStore((s) => s.runState.thinkingLevel)) ?? 'medium'

  if (!open) return null

  const pick = async (level: string) => {
    try {
      await ipcClient.invoke('thinkingLevel.set', { sessionId: '', level })
      useUIStore.getState().setRunState({ thinkingLevel: level })
      toast.success(`Thinking: ${level}`)
    } catch (e) {
      console.error('thinkingLevel.set failed:', e)
      toast.error(t('switchFailed'))
    }
    setOpen(false)
  }

  return (
    <div className="picker-backdrop backdrop-motion fixed inset-0 z-[110] flex items-end justify-center bg-black/40 p-4 pb-28 sm:items-start sm:pt-20" onClick={() => setOpen(false)}>
      <div
        className="picker-panel w-full max-w-md overflow-hidden rounded-xl border border-border/80 bg-background shadow-2xl"
        style={{ boxShadow: '0 16px 48px color-mix(in srgb, var(--foreground) 12%, transparent)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Brain className="h-4 w-4 text-muted-foreground/70" />
            <div className="text-[14px] font-medium">{t('thinkingPickerTitle')}</div>
          </div>
          <button type="button" onClick={() => setOpen(false)} className="row-hover rounded-lg p-1.5 text-foreground-secondary hover:text-foreground">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="py-1">
          {LEVELS.map((lv) => {
            const active = current === lv.key
            return (
              <button
                key={lv.key}
                onClick={() => pick(lv.key)}
                className={cn(
                  'picker-row flex w-full items-center gap-3 px-4 py-2.5 text-left',
                  active && 'bg-[var(--bg-active)]',
                )}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[12px] font-medium uppercase">{lv.label}</span>
                  </div>
                  <div className="text-[11px] text-muted-foreground/60">
                    {t(`thinkingDescriptions.${lv.key}`)}
                  </div>
                </div>
                {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
