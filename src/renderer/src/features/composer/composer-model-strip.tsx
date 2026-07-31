import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { cn } from '@renderer/lib/utils'
import { formatModelChip, formatThinkingChip } from '@renderer/lib/format-run-display'

/** Bottom-right of input: model / thinking */
function ComposerModelStripImpl({
  model,
  thinkingLevel,
  modelPickerOpen,
  thinkingPickerOpen,
  onModelClick,
  onThinkingClick,
}: {
  model?: string
  thinkingLevel?: string
  modelPickerOpen?: boolean
  thinkingPickerOpen?: boolean
  onModelClick: () => void
  onThinkingClick: () => void
}) {
  const { t } = useTranslation()
  const modelLabel = formatModelChip(model)
  const thinkLabel = formatThinkingChip(thinkingLevel)

  const btn = cn(
    'composer-meta-text max-w-[min(180px,38vw)] truncate rounded-md px-1.5 py-1 tabular-nums',
    'text-foreground-secondary/65 hover:bg-accent/60 hover:text-foreground-secondary/95 transition-colors duration-200',
    'focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand/25',
  )

  return (
    <div className="flex min-w-0 items-center justify-end gap-0.5">
      <button
        type="button"
        onClick={onModelClick}
        title={modelLabel === t('composer:selectModel') ? t('composer:selectModelHint') : t('composer:modelLabel', { name: model ?? modelLabel })}
        className={cn(btn, modelPickerOpen && 'bg-accent/60 text-foreground-secondary/95')}
      >
        {modelLabel}
      </button>
      <span className="composer-meta-text text-foreground-secondary/35">/</span>
      <button
        type="button"
        onClick={onThinkingClick}
        title={t('composer:thinkingLevel', { level: thinkLabel })}
        className={cn(btn, 'max-w-[96px]', thinkingPickerOpen && 'bg-accent/60 text-foreground-secondary/95')}
      >
        {thinkLabel}
      </button>
    </div>
  )
}

export const ComposerModelStrip = memo(ComposerModelStripImpl)
