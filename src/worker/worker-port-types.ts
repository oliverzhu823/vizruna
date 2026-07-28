/** Messages from Main → Worker utilityProcess. */
import type { ProviderRoutingRuntime } from '@shared/provider-routing'

export type WorkerIncomingMessage = {
  type?: string
  requestId?: string
  rpcId?: string
  response?: unknown
  cwd?: string
  sdkPath?: string | null
  providerRouting?: ProviderRoutingRuntime
  text?: string
  options?: unknown
  sessionFile?: string
  offset?: number
  limit?: number
  targetId?: string
  summarize?: boolean
  customInstructions?: string
  replaceInstructions?: string
  label?: string
  provider?: string
  modelId?: string
  level?: string
  patch?: Record<string, unknown>
  commandName?: string
  argumentPrefix?: string
  [key: string]: unknown
}

export type WorkerCommandRow = {
  id: string
  name: string
  description: string
  category: string
  source?: unknown
}

export type WorkerModelRow = {
  id: string
  name: string
  provider: string
  contextWindow: number
  maxOutput: number
  available: boolean
}
