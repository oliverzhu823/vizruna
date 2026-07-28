import { z } from 'zod'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import { getProviderAuthService } from '../../provider-auth/provider-auth-service'

const loginSchema = z.object({
  providerId: z.string().trim().min(1).max(120),
  authType: z.enum(['oauth', 'api_key']),
})

const logoutSchema = z.object({
  providerId: z.string().trim().min(1).max(120),
})

const responseSchema = z.object({
  flowId: z.string().uuid(),
  promptId: z.string().uuid(),
  value: z.string().max(64_000).optional(),
  cancelled: z.boolean().optional(),
})

const cancelSchema = z.object({
  flowId: z.string().uuid().optional(),
})

export function registerProviderAuthHandlers(): void {
  const service = getProviderAuthService()
  registerHandler('ipc:providerAuth.list', async () => ({
    providers: await service.list(),
  }))
  registerHandler('ipc:providerAuth.resume', async () => ({
    active: service.resume(),
  }))
  registerHandlerWithSchema('ipc:providerAuth.login', loginSchema, async (request) => {
    await service.login(request.providerId, request.authType)
    return { ok: true }
  })
  registerHandlerWithSchema('ipc:providerAuth.logout', logoutSchema, async (request) => {
    await service.logout(request.providerId)
    return { ok: true }
  })
  registerHandlerWithSchema('ipc:providerAuth.respond', responseSchema, async (request) => {
    service.respond(request)
    return { ok: true }
  })
  registerHandlerWithSchema('ipc:providerAuth.cancel', cancelSchema, async (request) => {
    service.cancel(request.flowId)
    return { ok: true }
  })
}
