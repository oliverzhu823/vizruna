import { BrowserWindow, shell } from 'electron'
import { randomUUID } from 'node:crypto'
import type {
  AuthEvent,
  AuthInteraction,
  AuthPrompt,
  AuthType,
} from '@earendil-works/pi-ai'
import type {
  ProviderAuthFlowEvent,
  ProviderAuthPrompt,
  ProviderAuthStatus,
  ProviderAuthType,
} from '@shared/provider-auth'
import type { ProviderRoute } from '@shared/provider-routing'
import { errorMessage } from '@shared/error-message'
import { getActiveSdkModule } from '../ipc/sdk-session'
import { getProviderRoutingService } from '../provider-routing/provider-routing-service'
import { failureFromUnknown } from '../reliability/failure-model'
import { redactSensitive } from '../reliability/redaction'
import { workerManager } from '../worker-manager'
import { withProviderAuthNetwork } from './auth-network-scope'

const AUTH_FLOW_TIMEOUT_MS = 10 * 60_000

type PromptPending = {
  flowId: string
  resolve: (value: string) => void
  reject: (error: Error) => void
  cleanup: () => void
}

type ActiveFlow = {
  id: string
  providerId: string
  authType: ProviderAuthType
  abort: AbortController
  timeout: ReturnType<typeof setTimeout>
  latestEvent: ProviderAuthFlowEvent
  abortReason?: 'user' | 'timeout' | 'browser'
  failureOverride?: Error
}

function isSafeAuthorizationUrl(value: string): boolean {
  try {
    const url = new URL(value)
    if (url.protocol === 'https:') return true
    return (
      url.protocol === 'http:' &&
      ['localhost', '127.0.0.1', '::1'].includes(url.hostname)
    )
  } catch {
    return false
  }
}

function publicPrompt(prompt: AuthPrompt): ProviderAuthPrompt {
  if (prompt.type === 'select') {
    return {
      type: 'select',
      message: prompt.message,
      options: prompt.options.map((option) => ({ ...option })),
    }
  }
  return {
    type: prompt.type,
    message: prompt.message,
    placeholder: prompt.placeholder,
  }
}

export class ProviderAuthService {
  private active: ActiveFlow | null = null
  private readonly prompts = new Map<string, PromptPending>()

  private send(event: ProviderAuthFlowEvent): void {
    if (this.active?.id === event.flowId) {
      if (
        event.phase === 'started' ||
        event.phase === 'prompt' ||
        (event.phase === 'notification' &&
          (event.notification.type === 'auth_url' ||
            event.notification.type === 'device_code'))
      ) {
        this.active.latestEvent = event
      } else if (
        event.phase === 'prompt-dismiss' &&
        this.active.latestEvent.phase === 'prompt' &&
        this.active.latestEvent.promptId === event.promptId
      ) {
        this.active.latestEvent = {
          phase: 'started',
          flowId: this.active.id,
          providerId: this.active.providerId,
          authType: this.active.authType,
        }
      }
    }
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
    if (win && !win.isDestroyed()) {
      win.webContents.send('ipc:provider-auth-flow', event)
      if (event.phase === 'prompt' ||
        (event.phase === 'notification' && event.notification.type === 'device_code')) {
        if (win.isMinimized()) win.restore()
        win.show()
        win.focus()
      }
    }
  }

  private async runtime() {
    const sdk = await getActiveSdkModule()
    if (!sdk.ModelRuntime) {
      throw new Error('当前 Pi SDK 不支持图形化登录，请切换到内嵌最新版')
    }
    const runtime = await sdk.ModelRuntime.create({ allowModelNetwork: false })
    const refresh = runtime.refresh.bind(runtime)
    runtime.refresh = (options = {}) =>
      refresh({ ...options, allowNetwork: false })
    return runtime
  }

  async list(): Promise<ProviderAuthStatus[]> {
    const [runtime, routing] = await Promise.all([
      this.runtime(),
      getProviderRoutingService().getConfig(),
    ])
    // Populate ModelRuntime's auth snapshot before asking for source/type. This
    // is the same authority used by Pi's native /login and /logout UI.
    await runtime.getAvailable().catch(() => [])
    const credentials = new Map(
      (await runtime.listCredentials()).map((item) => [item.providerId, item.type]),
    )
    return runtime
      .getProviders()
      .map((provider) => {
        const methods: ProviderAuthType[] = []
        if (provider.auth.oauth) methods.push('oauth')
        if (provider.auth.apiKey?.login) methods.push('api_key')
        const storedType = credentials.get(provider.id)
        const status = runtime.getProviderAuthStatus(provider.id)
        const configured = status.configured || storedType != null
        const route = routing.routes.find((item) => item.provider === provider.id)
        const routeMode = route?.mode ?? 'system'
        const profileName = route?.profileId
          ? routing.profiles.find((item) => item.id === route.profileId)?.name
          : undefined
        return {
          providerId: provider.id,
          name: provider.name || provider.id,
          methods,
          configured,
          configuredType:
            storedType ??
            (configured
              ? runtime.isUsingOAuth(provider.id)
                ? 'oauth'
                : 'api_key'
              : undefined),
          storedCredential: storedType != null,
          source: storedType != null ? 'stored' : status.source,
          sourceLabel: status.label,
          routeMode,
          routeLabel:
            routeMode === 'profile'
              ? `profile:${profileName || 'missing'}`
              : routeMode,
        }
      })
      .filter((row) => row.methods.length > 0 || row.configured)
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async login(providerId: string, authType: ProviderAuthType): Promise<void> {
    if (this.active) {
      // Renderer reloads or a covered dialog can miss a one-shot IPC event.
      // Re-present the authoritative pending step instead of leaving every
      // subsequent login button blocked by an invisible active flow.
      this.resume()
      return
    }
    const abort = new AbortController()
    const flowId = randomUUID()
    const startedEvent: ProviderAuthFlowEvent = {
      phase: 'started',
      flowId,
      providerId,
      authType,
    }
    const flow: ActiveFlow = {
      id: flowId,
      providerId,
      authType,
      abort,
      latestEvent: startedEvent,
      timeout: setTimeout(() => {
        flow.abortReason = 'timeout'
        abort.abort(new Error('Provider authorization timed out'))
      }, AUTH_FLOW_TIMEOUT_MS),
    }
    flow.timeout.unref?.()
    this.active = flow
    this.send(startedEvent)

    try {
      const runtime = await this.runtime()
      const interaction: AuthInteraction = {
        signal: flow.abort.signal,
        prompt: (prompt) => this.prompt(flow, prompt),
        notify: (event) => this.notify(flow, event),
      }
      await withProviderAuthNetwork(
        getProviderRoutingService().runtimeConfig(),
        providerId,
        () => runtime.login(providerId, authType as AuthType, interaction),
      )
      await workerManager.reloadAuthentication().catch((reloadError) => {
        console.warn(
          '[ProviderAuth] credential saved; Worker reload deferred:',
          errorMessage(reloadError),
        )
      })
      this.send({ phase: 'completed', flowId: flow.id, providerId })
    } catch (error) {
      const cancelled = flow.abortReason === 'user'
      const failureError =
        flow.failureOverride ??
        (flow.abortReason === 'timeout'
          ? new Error('Provider authorization timed out')
          : error)
      const failure = redactSensitive(
        failureFromUnknown(failureError, 'authentication'),
      ).value
      const routeContext = await this.routeContext(providerId)
      this.send(
        cancelled
          ? { phase: 'cancelled', flowId: flow.id, providerId }
          : {
              phase: 'failed',
              flowId: flow.id,
              providerId,
              error: failure.message,
              failure,
              ...routeContext,
            },
      )
      if (!cancelled) throw error
    } finally {
      clearTimeout(flow.timeout)
      this.rejectFlowPrompts(flow.id, new Error('登录流程已结束'))
      if (this.active?.id === flow.id) this.active = null
    }
  }

  async logout(providerId: string): Promise<void> {
    const runtime = await this.runtime()
    await runtime.logout(providerId)
    await workerManager.reloadAuthentication().catch((reloadError) => {
      console.warn(
        '[ProviderAuth] credential removed; Worker reload deferred:',
        errorMessage(reloadError),
      )
    })
  }

  resume(): boolean {
    if (!this.active) return false
    this.send(this.active.latestEvent)
    return true
  }

  respond(input: {
    flowId: string
    promptId: string
    value?: string
    cancelled?: boolean
  }): void {
    const pending = this.prompts.get(input.promptId)
    if (!pending || pending.flowId !== input.flowId) return
    pending.cleanup()
    if (input.cancelled) pending.reject(new Error('登录已取消'))
    else pending.resolve(String(input.value ?? ''))
  }

  cancel(flowId?: string): void {
    if (!this.active || (flowId && this.active.id !== flowId)) return
    this.active.abortReason = 'user'
    this.active.abort.abort()
    this.rejectFlowPrompts(this.active.id, new Error('登录已取消'))
  }

  private prompt(flow: ActiveFlow, prompt: AuthPrompt): Promise<string> {
    if (flow.abort.signal.aborted || prompt.signal?.aborted) {
      return Promise.reject(new Error('登录已取消'))
    }
    const promptId = randomUUID()
    return new Promise<string>((resolve, reject) => {
      const cleanup = () => {
        flow.abort.signal.removeEventListener('abort', onAbort)
        prompt.signal?.removeEventListener('abort', onPromptAbort)
        this.prompts.delete(promptId)
        this.send({
          phase: 'prompt-dismiss',
          flowId: flow.id,
          providerId: flow.providerId,
          promptId,
        })
      }
      const onAbort = () => {
        cleanup()
        reject(new Error('登录已取消'))
      }
      const onPromptAbort = () => {
        cleanup()
        reject(new Error('该输入步骤已结束'))
      }
      flow.abort.signal.addEventListener('abort', onAbort, { once: true })
      prompt.signal?.addEventListener('abort', onPromptAbort, { once: true })
      this.prompts.set(promptId, { flowId: flow.id, resolve, reject, cleanup })
      this.send({
        phase: 'prompt',
        flowId: flow.id,
        providerId: flow.providerId,
        promptId,
        prompt: publicPrompt(prompt),
      })
    })
  }

  private notify(flow: ActiveFlow, notification: AuthEvent): void {
    this.send({
      phase: 'notification',
      flowId: flow.id,
      providerId: flow.providerId,
      notification,
    })
    const url =
      notification.type === 'auth_url'
        ? notification.url
        : notification.type === 'device_code'
          ? notification.verificationUri
          : null
    if (!url) return
    if (!isSafeAuthorizationUrl(url)) {
      throw new Error('OAuth authorization URL uses an unsafe protocol')
    }
    void shell.openExternal(url, { activate: true }).catch((error) => {
      flow.abortReason = 'browser'
      flow.failureOverride = new Error(
        `Unable to open the authorization page: ${errorMessage(error)}`,
      )
      flow.abort.abort(flow.failureOverride)
    })
  }

  private async routeContext(providerId: string): Promise<{
    route: ProviderRoute
    routeLabel: string
  }> {
    try {
      const config = await getProviderRoutingService().getConfig()
      const route =
        config.routes.find((item) => item.provider === providerId) ??
        ({ provider: providerId, mode: 'system' } satisfies ProviderRoute)
      const profileName = route.profileId
        ? config.profiles.find((item) => item.id === route.profileId)?.name
        : undefined
      return {
        route,
        routeLabel:
          route.mode === 'profile'
            ? `profile:${profileName || 'missing'}`
            : route.mode,
      }
    } catch {
      return {
        route: { provider: providerId, mode: 'system' },
        routeLabel: 'system',
      }
    }
  }

  private rejectFlowPrompts(flowId: string, error: Error): void {
    for (const pending of [...this.prompts.values()]) {
      if (pending.flowId !== flowId) continue
      pending.cleanup()
      pending.reject(error)
    }
  }
}

let instance: ProviderAuthService | null = null

export function getProviderAuthService(): ProviderAuthService {
  instance ??= new ProviderAuthService()
  return instance
}
