import { app } from 'electron'
import { pathToFileURL } from 'node:url'
import { resolveActiveSdk } from '../sdk-loader'
import { inspectPiSdkCompatibility } from '@shared/pi-sdk-compat'

export async function getActiveSdkModule(): Promise<typeof import('@earendil-works/pi-coding-agent')> {
  const active = resolveActiveSdk(app.getPath('userData'))
  if (active.kind === 'builtin') {
    return import(active.entryPath)
  }
  try {
    const candidate = await import(pathToFileURL(active.entryPath).href)
    const compatibility = inspectPiSdkCompatibility(candidate)
    if (!compatibility.compatible) {
      throw new Error(
        `Pi SDK ${active.version || 'unknown'} is missing required capabilities: ${compatibility.missingCapabilities.join(', ')}`,
      )
    }
    return candidate as typeof import('@earendil-works/pi-coding-agent')
  } catch (error) {
    console.warn('[SDK] Active external SDK failed capability check; falling back to builtin:', error)
    return import('@earendil-works/pi-coding-agent')
  }
}

export type SessionOnDiskRow = {
  id: string
  path: string
  cwd?: string
  name?: string
  firstMessage?: string
  created?: Date
  modified?: Date
  messageCount?: number
}

export async function listSessionsOnDisk(workspaceId: string): Promise<SessionOnDiskRow[]> {
  const { SessionManager } = await getActiveSdkModule()
  return (await SessionManager.list(workspaceId)) as SessionOnDiskRow[]
}
