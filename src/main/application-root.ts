import { existsSync } from 'fs'
import { join, resolve } from 'path'

type Exists = (path: string) => boolean

/**
 * Electron normally reports the application root from app.getAppPath().
 * When a built Main entry is launched directly (for preview/E2E), Electron
 * instead reports `out/main`. Normalize both launch modes to the directory
 * that owns package.json and the generated `out` tree.
 */
export function resolveApplicationRoot(appPath: string, exists: Exists = existsSync): string {
  const candidates = [appPath, resolve(appPath, '..', '..')]
  for (const candidate of candidates) {
    if (exists(join(candidate, 'package.json')) && exists(join(candidate, 'out'))) {
      return candidate
    }
  }
  return appPath
}
