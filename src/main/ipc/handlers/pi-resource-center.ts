import { collectPiResourceCenterSnapshot } from '../../pi-resource-center-service'
import {
  checkPiPackageUpdates,
  mutatePiPackage,
  setPiResourceFilter,
} from '../../pi-resource-manager'
import {
  piPackageMutationSchema,
  piPackageUpdateCheckSchema,
  piResourceFilterSetSchema,
} from '../schemas'
import { registerHandler, registerHandlerWithSchema } from '../registry'

export function registerPiResourceCenterHandlers(): void {
  registerHandler('ipc:pi.resources.center.get', async (request) => ({
    snapshot: await collectPiResourceCenterSnapshot(request),
  }))
  registerHandlerWithSchema(
    'ipc:pi.resources.package.mutate',
    piPackageMutationSchema,
    mutatePiPackage,
  )
  registerHandlerWithSchema(
    'ipc:pi.resources.package.checkUpdates',
    piPackageUpdateCheckSchema,
    checkPiPackageUpdates,
  )
  registerHandlerWithSchema(
    'ipc:pi.resources.filter.set',
    piResourceFilterSetSchema,
    setPiResourceFilter,
  )
}
