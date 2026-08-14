import { buildAgentAssetCatalog } from '../../agent-asset-service'
import { registerHandlerWithSchema } from '../registry'
import { agentAssetListSchema } from '../schemas'

export function registerAgentAssetHandlers(): void {
  registerHandlerWithSchema('ipc:agentAsset.list', agentAssetListSchema, async (request) => ({
    catalog: buildAgentAssetCatalog(request.workspacePath),
  }))
}
