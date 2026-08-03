import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

export function WebWorkspacePathDialog({
  open,
  onConfirm,
  onSystemPicker,
  onCancel,
}: {
  open: boolean
  onConfirm: (path: string) => Promise<void>
  onSystemPicker: () => Promise<void>
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const titleId = useId()
  const inputRef = useRef<HTMLInputElement>(null)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!open) return
    setValue('')
    setError(null)
    setBusy(false)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !busy) onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [busy, onCancel, open])

  if (!open) return null

  const submit = async () => {
    const path = value.trim()
    if (!path || busy) return
    setBusy(true)
    setError(null)
    try {
      await onConfirm(path)
    } catch {
      setError(t('common:webWorkspacePath.invalid'))
    } finally {
      setBusy(false)
    }
  }

  const openSystemPicker = async () => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await onSystemPicker()
    } catch {
      setError(t('common:webWorkspacePath.systemPickerFailed'))
    } finally {
      setBusy(false)
    }
  }

  return createPortal(
    <div
      className="fixed inset-0 z-[600] flex items-center justify-center bg-black/40 p-4 backdrop-blur-[1px]"
      role="presentation"
      onPointerDown={(event) => {
        if (event.target === event.currentTarget && !busy) onCancel()
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="w-full max-w-lg rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-xl"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <h2 id={titleId} className="text-[15px] font-semibold text-foreground">
          {t('common:webWorkspacePath.title')}
        </h2>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {t('common:webWorkspacePath.description')}
        </p>
        <input
          ref={inputRef}
          type="text"
          value={value}
          disabled={busy}
          placeholder={t('common:webWorkspacePath.placeholder')}
          className="mt-3 w-full rounded-lg border border-border bg-background px-3 py-2 font-mono text-[13px] text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          onChange={(event) => {
            setValue(event.target.value)
            setError(null)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
        {error && <p className="mt-2 text-[12px] text-destructive">{error}</p>}
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-accent disabled:opacity-50"
            onClick={() => void openSystemPicker()}
          >
            {t('common:webWorkspacePath.systemPicker')}
          </button>
          <button
            type="button"
            disabled={busy}
            className="rounded-md px-3 py-1.5 text-[13px] text-muted-foreground hover:bg-accent disabled:opacity-50"
            onClick={onCancel}
          >
            {t('common:cancel')}
          </button>
          <button
            type="button"
            disabled={busy || !value.trim()}
            className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            onClick={() => void submit()}
          >
            {busy ? t('common:loading') : t('common:webWorkspacePath.open')}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  )
}
