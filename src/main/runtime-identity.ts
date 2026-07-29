import { join } from 'node:path'
import {
  PRODUCT_APP_ID,
  PRODUCT_DEVELOPMENT_APP_ID,
  PRODUCT_DEVELOPMENT_NAME,
  PRODUCT_DEVELOPMENT_USER_DATA_DIRECTORY,
  PRODUCT_NAME,
  PRODUCT_USER_DATA_DIRECTORY,
} from '@shared/product-identity'

export const PI_CODING_AGENT_DIRECTORY_ENV = 'PI_CODING_AGENT_DIR'
export const VIZRUNA_RUNTIME_CHANNEL_ENV = 'VIZRUNA_RUNTIME_CHANNEL'

export type RuntimeChannel = 'development' | 'production'

export interface RuntimeIdentityOptions {
  isPackaged: boolean
  isE2E: boolean
  appDataPath: string
  tempPath: string
  pid: number
  explicitUserData?: string
  explicitPiAgentDirectory?: string
}

export interface RuntimeIdentity {
  channel: RuntimeChannel
  appName: string
  appId: string
  userDataPath: string
  piAgentDirectory: string | null
  isolated: boolean
}

function nonEmpty(value: string | undefined): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

/**
 * Resolve runtime identity before any service imports Pi or electron-store.
 *
 * Production deliberately keeps Pi's native global ~/.pi/agent credential
 * store. Source development and every E2E launch use an isolated agent
 * directory so local testing can never inherit a real user's OAuth/API keys.
 */
export function resolveRuntimeIdentity(
  options: RuntimeIdentityOptions,
): RuntimeIdentity {
  const channel: RuntimeChannel = options.isPackaged
    ? 'production'
    : 'development'
  const isDevelopment = channel === 'development'
  const appName = isDevelopment ? PRODUCT_DEVELOPMENT_NAME : PRODUCT_NAME
  const appId = isDevelopment ? PRODUCT_DEVELOPMENT_APP_ID : PRODUCT_APP_ID
  const userDataDirectory = isDevelopment
    ? PRODUCT_DEVELOPMENT_USER_DATA_DIRECTORY
    : PRODUCT_USER_DATA_DIRECTORY
  const explicitUserData = nonEmpty(options.explicitUserData)
  const userDataPath =
    explicitUserData ??
    (options.isE2E
      ? join(options.tempPath, `${userDataDirectory}-e2e-${options.pid}`)
      : join(options.appDataPath, userDataDirectory))
  const isolated = isDevelopment || options.isE2E
  const explicitPiAgentDirectory = nonEmpty(
    options.explicitPiAgentDirectory,
  )
  const piAgentDirectory =
    options.isE2E
      ? join(userDataPath, 'pi-agent')
      : explicitPiAgentDirectory ??
        (isolated ? join(userDataPath, 'pi-agent') : null)

  return {
    channel,
    appName,
    appId,
    userDataPath,
    piAgentDirectory,
    isolated,
  }
}
