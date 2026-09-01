import {
  collectPiInspectorSnapshot,
  collectPiPromptDocument,
} from '../../pi-inspector-service'
import { registerHandler } from '../registry'

export function registerPiInspectorHandlers(): void {
  registerHandler('ipc:pi.inspector.get', async (request) => ({
    snapshot: await collectPiInspectorSnapshot(request),
  }))
  registerHandler('ipc:pi.inspector.prompt', collectPiPromptDocument)
}
