import { workerManager } from '../../worker-manager'
import { getProviderRoutingService } from '../../provider-routing/provider-routing-service'
import { registerHandler, registerHandlerWithSchema } from '../registry'
import {
  providerRouteSetSchema,
  providerRoutingDiagnoseSchema,
  proxyProfileDeleteSchema,
  proxyProfileSaveSchema,
} from '../schemas'

async function applyToLiveWorkers(): Promise<{
  workersUpdated: number
  workersDeferred: number
}> {
  const result = await workerManager.updateProviderRouting(
    getProviderRoutingService().runtimeConfig(),
  )
  return {
    workersUpdated: result.updated,
    workersDeferred: result.deferred,
  }
}

export function registerProviderRoutingHandlers(): void {
  registerHandler('ipc:providerRouting.get', async () => ({
    config: await getProviderRoutingService().getConfig(),
  }))

  registerHandlerWithSchema(
    'ipc:proxyProfile.save',
    proxyProfileSaveSchema,
    async (request) => {
      const profile = getProviderRoutingService().saveProfile(request)
      return { profile, ...(await applyToLiveWorkers()) }
    },
  )

  registerHandlerWithSchema(
    'ipc:proxyProfile.delete',
    proxyProfileDeleteSchema,
    async ({ id, confirmed }) => {
      getProviderRoutingService().deleteProfile(id, confirmed)
      return applyToLiveWorkers()
    },
  )

  registerHandlerWithSchema(
    'ipc:providerRouting.set',
    providerRouteSetSchema,
    async (request) => {
      const route = getProviderRoutingService().setRoute(request)
      return { route, ...(await applyToLiveWorkers()) }
    },
  )

  registerHandlerWithSchema(
    'ipc:providerRouting.diagnose',
    providerRoutingDiagnoseSchema,
    async ({ provider }) => ({
      result: await getProviderRoutingService().diagnose(provider),
    }),
  )
}
