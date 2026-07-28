import type { ProviderRoute, ProviderRouteMode } from './provider-routing'
import type { FailureEnvelope } from './reliability'

export type ProviderAuthType = 'oauth' | 'api_key'

export type ProviderAuthSource =
  | 'stored'
  | 'runtime'
  | 'environment'
  | 'fallback'
  | 'models_json_key'
  | 'models_json_command'

export interface ProviderAuthStatus {
  providerId: string
  name: string
  methods: ProviderAuthType[]
  configured: boolean
  configuredType?: ProviderAuthType
  /** True only for credentials written to auth.json and removable by Pi logout. */
  storedCredential: boolean
  source?: ProviderAuthSource
  sourceLabel?: string
  routeMode: ProviderRouteMode
  routeLabel: string
}

export type ProviderAuthPrompt =
  | {
      type: 'text' | 'secret' | 'manual_code'
      message: string
      placeholder?: string
    }
  | {
      type: 'select'
      message: string
      options: Array<{ id: string; label: string; description?: string }>
    }

export type ProviderAuthNotification =
  | { type: 'info' | 'progress'; message: string }
  | { type: 'auth_url'; url: string; instructions?: string }
  | {
      type: 'device_code'
      userCode: string
      verificationUri: string
      intervalSeconds?: number
      expiresInSeconds?: number
    }

export type ProviderAuthFlowEvent =
  | {
      phase: 'started'
      flowId: string
      providerId: string
      authType: ProviderAuthType
    }
  | {
      phase: 'prompt'
      flowId: string
      providerId: string
      promptId: string
      prompt: ProviderAuthPrompt
    }
  | {
      phase: 'prompt-dismiss'
      flowId: string
      providerId: string
      promptId: string
    }
  | {
      phase: 'notification'
      flowId: string
      providerId: string
      notification: ProviderAuthNotification
    }
  | {
      phase: 'completed' | 'cancelled'
      flowId: string
      providerId: string
    }
  | {
      phase: 'failed'
      flowId: string
      providerId: string
      error: string
      failure: FailureEnvelope
      route: ProviderRoute
      routeLabel: string
    }
