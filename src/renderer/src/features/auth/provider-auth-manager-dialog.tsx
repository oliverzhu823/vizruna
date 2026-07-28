import { useTranslation } from 'react-i18next'
import { ExtensionDialogShell } from '@renderer/features/extension-ui/extension-dialog-shell'
import {
  ProviderAuthSettings,
  type ProviderAuthViewMode,
} from '@renderer/features/settings/provider-auth-settings'

export type ProviderAuthManagerRequest = {
  mode: Exclude<ProviderAuthViewMode, 'manage'>
  providerId?: string
}

export const OPEN_PROVIDER_AUTH_EVENT = 'pi-enterprise-desktop:open-provider-auth'

export function openProviderAuthManager(request: ProviderAuthManagerRequest): void {
  window.dispatchEvent(
    new CustomEvent<ProviderAuthManagerRequest>(OPEN_PROVIDER_AUTH_EVENT, {
      detail: request,
    }),
  )
}

export function ProviderAuthManagerDialog({
  request,
  onClose,
}: {
  request: ProviderAuthManagerRequest | null
  onClose: () => void
}) {
  const { t } = useTranslation()
  if (!request) return null

  return (
    <ExtensionDialogShell
      title={
        request.mode === 'login'
          ? t('settings:providerAuth.dialogLoginTitle')
          : t('settings:providerAuth.dialogLogoutTitle')
      }
      onDismiss={onClose}
      wide
    >
      <div className="max-h-[min(72vh,680px)] overflow-y-auto pr-1">
        <ProviderAuthSettings
          mode={request.mode}
          initialQuery={request.providerId}
          autoStartExact={request.mode === 'login' && !!request.providerId}
          showHeader={false}
        />
      </div>
    </ExtensionDialogShell>
  )
}
