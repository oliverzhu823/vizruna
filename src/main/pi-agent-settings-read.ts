import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { getPiAgentDirectory } from './pi-agent-directory'

/** Worker 未运行时从当前运行时 Pi agent 目录读取（仅读，不写）。 */
export function readPiAgentGlobalSettingsFromDisk(): Record<string, unknown> | null {
  try {
    const p = join(getPiAgentDirectory(), 'settings.json')
    if (!existsSync(p)) return null
    const raw = JSON.parse(readFileSync(p, 'utf-8'))
    return raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null
  } catch (e) {
    return null
  }
}
