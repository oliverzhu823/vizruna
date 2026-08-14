import { useEffect, useState } from 'react'
import { Copy, Loader2, X } from 'lucide-react'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
import type {
  ProviderAuthFlowEvent,
  ProviderAuthNotification,
  ProviderAuthPrompt,
} from '@shared/provider-auth'
import { ipcClient, onProviderAuthFlow } from '@renderer/lib/ipc-client'
import { ExtensionDialogShell } from '@renderer/features/extension-ui/extension-dialog-shell'

type ActiveFlow = {
  flowId: string
  providerId: string
  stage: 'preparing' | 'browser'
}

type ActivePrompt = {
  flowId: string
  providerId: string
  promptId: string
  prompt: ProviderAuthPrompt
}

type DeviceNotice = {
  flowId: string
  providerId: string
  notification: Extract<ProviderAuthNotification, { type: 'device_code' }>
}

function routeDisplay(
  routeLabel: string,
  translate: (key: string, options?: Record<string, unknown>) => string,
): string {
  if (routeLabel === 'direct') {
    return translate('settings:providerAuth.routeDirect')
  }
  if (routeLabel === 'system') {
    return translate('settings:providerAuth.routeSystem')
  }
  if (routeLabel.startsWith('profile:')) {
    return translate('settings:providerAuth.routeProfile', {
      name: routeLabel.slice('profile:'.length),
    })
  }
  return routeLabel
}

function AuthInputPrompt({
  active,
  onCancel,
}: {
  active: ActivePrompt
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const prompt = active.prompt
  if (prompt.type === 'select') return null
  return (
    <ExtensionDialogShell title={prompt.message} onDismiss={onCancel} wide priority>
      <input
        autoFocus
        type={prompt.type === 'secret' ? 'password' : 'text'}
        value={value}
        placeholder={prompt.placeholder}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && value.trim()) {
            void ipcClient.invoke('providerAuth.respond', {
              flowId: active.flowId,
              promptId: active.promptId,
              value,
            })
          }
        }}
        className="mb-4 w-full rounded-md border border-border bg-background px-3 py-2 text-[13px] outline-none focus:border-primary/60"
      />
      <div className="flex justify-end gap-2">
        <button type="button" className="rounded-md border px-3 py-1.5 text-[13px]" onClick={onCancel}>
          {t('settings:providerAuth.cancel')}
        </button>
        <button
          type="button"
          disabled={!value.trim()}
          className="rounded-md bg-primary px-3 py-1.5 text-[13px] text-primary-foreground disabled:opacity-40"
          onClick={() =>
            void ipcClient.invoke('providerAuth.respond', {
              flowId: active.flowId,
              promptId: active.promptId,
              value,
            })
          }
        >
          {t('settings:providerAuth.continue')}
        </button>
      </div>
    </ExtensionDialogShell>
  )
}

export function ProviderAuthFlowHost({
  onFlowStarted,
}: {
  onFlowStarted?: () => void
}) {
  const { t } = useTranslation()
  const [activeFlow, setActiveFlow] = useState<ActiveFlow | null>(null)
  const [activePrompt, setActivePrompt] = useState<ActivePrompt | null>(null)
  const [device, setDevice] = useState<DeviceNotice | null>(null)

  useEffect(() => {
    const unsubscribe = onProviderAuthFlow((event: ProviderAuthFlowEvent) => {
        if (event.phase === 'started') {
          setActiveFlow({
            flowId: event.flowId,
            providerId: event.providerId,
            stage: 'preparing',
          })
          setActivePrompt(null)
          setDevice(null)
          onFlowStarted?.()
          return
        }
        if (event.phase === 'prompt') {
          onFlowStarted?.()
          setActivePrompt({
            flowId: event.flowId,
            providerId: event.providerId,
            promptId: event.promptId,
            prompt: event.prompt,
          })
          return
        }
        if (event.phase === 'prompt-dismiss') {
          setActivePrompt((current) =>
            current?.promptId === event.promptId ? null : current,
          )
          return
        }
        if (event.phase === 'notification') {
          onFlowStarted?.()
          if (event.notification.type === 'auth_url') {
            setActiveFlow((current) => ({
              flowId: event.flowId,
              providerId: event.providerId,
              stage: 'browser',
            }))
            toast.info(t('settings:providerAuth.browserOpened'))
          } else if (event.notification.type === 'device_code') {
            setDevice({
              flowId: event.flowId,
              providerId: event.providerId,
              notification: event.notification,
            })
          }
          return
        }
        if (event.phase === 'completed') {
          setActiveFlow(null)
          setActivePrompt(null)
          setDevice(null)
          toast.success(t('settings:providerAuth.loginSuccess'))
          window.dispatchEvent(new CustomEvent('vizruna:provider-auth-completed', {
            detail: { providerId: event.providerId },
          }))
          return
        }
        if (event.phase === 'failed') {
          setActiveFlow(null)
          setActivePrompt(null)
          setDevice(null)
          toast.error(t('settings:providerAuth.loginFailed'), {
            description: t('settings:providerAuth.failureDetail', {
              category: t(
                `settings:providerAuth.failureCategory.${event.failure.code}`,
              ),
              message: event.error,
              route: routeDisplay(event.routeLabel, t),
              action: t(
                `settings:providerAuth.failureAction.${event.failure.code}`,
              ),
            }),
            duration: 12_000,
          })
          return
        }
        if (event.phase === 'cancelled') {
          setActiveFlow(null)
          setActivePrompt(null)
          setDevice(null)
          toast.message(t('settings:providerAuth.loginCancelled'))
        }
    })
    // IPC flow events are intentionally transient. Ask Main to replay the
    // current authoritative step after every renderer mount/reload.
    void ipcClient.invoke('providerAuth.resume').catch(() => undefined)
    return unsubscribe
  }, [onFlowStarted, t])

  const cancel = (flowId: string) => {
    void ipcClient.invoke('providerAuth.cancel', { flowId })
  }

  if (activePrompt?.prompt.type === 'select') {
    return (
      <ExtensionDialogShell
        title={activePrompt.prompt.message}
        onDismiss={() => cancel(activePrompt.flowId)}
        wide
        priority
      >
        <div className="flex flex-col gap-2">
          {activePrompt.prompt.options.map((option) => (
            <button
              key={option.id}
              type="button"
              className="rounded-lg border border-border px-3 py-2.5 text-left hover:bg-accent"
              onClick={() =>
                void ipcClient.invoke('providerAuth.respond', {
                  flowId: activePrompt.flowId,
                  promptId: activePrompt.promptId,
                  value: option.id,
                })
              }
            >
              <span className="block text-[13px] font-medium">{option.label}</span>
              {option.description ? (
                <span className="mt-0.5 block text-[11px] text-muted-foreground">
                  {option.description}
                </span>
              ) : null}
            </button>
          ))}
        </div>
        <button
          type="button"
          className="mt-3 w-full rounded-md border px-3 py-2 text-[13px] text-muted-foreground"
          onClick={() => cancel(activePrompt.flowId)}
        >
          {t('settings:providerAuth.cancel')}
        </button>
      </ExtensionDialogShell>
    )
  }

  if (activePrompt) {
    return (
      <AuthInputPrompt
        key={activePrompt.promptId}
        active={activePrompt}
        onCancel={() => cancel(activePrompt.flowId)}
      />
    )
  }

  if (device) {
    return (
      <ExtensionDialogShell
        title={t('settings:providerAuth.deviceTitle')}
        onDismiss={() => cancel(device.flowId)}
        wide
        priority
      >
        <div className="rounded-lg border border-border bg-muted/20 p-4 text-center">
          <div className="text-[11px] text-muted-foreground">
            {t('settings:providerAuth.deviceInstruction')}
          </div>
          <div className="mt-3 select-all font-mono text-2xl font-semibold tracking-[0.25em]">
            {device.notification.userCode}
          </div>
          <button
            type="button"
            className="mt-3 inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]"
            onClick={() => {
              void navigator.clipboard.writeText(device.notification.userCode)
              toast.success(t('settings:providerAuth.codeCopied'))
            }}
          >
            <Copy className="h-3.5 w-3.5" />
            {t('settings:providerAuth.copyCode')}
          </button>
        </div>
        <div className="mt-3 flex items-center gap-2 rounded-md bg-primary/5 px-3 py-2 text-[11px] text-muted-foreground">
          <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
          {t('settings:providerAuth.waiting')}
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]"
            onClick={() => cancel(device.flowId)}
          >
            <X className="h-3.5 w-3.5" />
            {t('settings:providerAuth.cancel')}
          </button>
        </div>
      </ExtensionDialogShell>
    )
  }

  if (activeFlow) {
    const browserOpen = activeFlow.stage === 'browser'
    return (
      <ExtensionDialogShell
        title={
          browserOpen
            ? t('settings:providerAuth.browserTitle')
            : t('settings:providerAuth.preparingTitle')
        }
        onDismiss={() => cancel(activeFlow.flowId)}
        wide
        priority
      >
        <div className="flex items-start gap-3 rounded-lg border border-border bg-muted/20 px-3 py-3">
          <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-primary" />
          <div>
            <div className="text-[13px] font-medium">
              {browserOpen
                ? t('settings:providerAuth.browserWaiting')
                : t('settings:providerAuth.preparingDescription', {
                    provider: activeFlow.providerId,
                  })}
            </div>
            {browserOpen ? (
              <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {t('settings:providerAuth.browserInstruction')}
              </div>
            ) : null}
          </div>
        </div>
        <div className="mt-3 flex justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[12px]"
            onClick={() => cancel(activeFlow.flowId)}
          >
            <X className="h-3.5 w-3.5" />
            {t('settings:providerAuth.cancel')}
          </button>
        </div>
      </ExtensionDialogShell>
    )
  }

  return null
}
