import { existsSync, readFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PRODUCT_USER_DATA_DIRECTORY } from '@shared/product-identity'

export const VIZRUNA_USER_DATA_ENV = 'VIZRUNA_USER_DATA_PATH'
export const VIZRUNA_APPLICATION_ROOT_ENV = 'VIZRUNA_APPLICATION_ROOT'

function platformAppDataPath(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Application Support')
  if (process.platform === 'win32') {
    return process.env.APPDATA?.trim() || join(homedir(), 'AppData', 'Roaming')
  }
  return process.env.XDG_CONFIG_HOME?.trim() || join(homedir(), '.config')
}

function findApplicationRoot(start: string): string | null {
  let current = resolve(start)
  for (;;) {
    if (existsSync(join(current, 'package.json'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

export function getRuntimeUserDataPath(): string {
  const explicit = process.env[VIZRUNA_USER_DATA_ENV]?.trim()
  return explicit ? resolve(explicit) : join(platformAppDataPath(), PRODUCT_USER_DATA_DIRECTORY)
}

export function getRuntimeApplicationRoot(): string {
  const explicit = process.env[VIZRUNA_APPLICATION_ROOT_ENV]?.trim()
  if (explicit) return resolve(explicit)
  const moduleRoot = findApplicationRoot(dirname(fileURLToPath(import.meta.url)))
  return moduleRoot || findApplicationRoot(process.cwd()) || process.cwd()
}

export function getRuntimeTempPath(): string {
  return process.env.VIZRUNA_TEMP_PATH?.trim() || tmpdir()
}

export function getRuntimeHomePath(): string {
  return process.env.VIZRUNA_HOME_PATH?.trim() || homedir()
}

export function getRuntimeVersion(): string {
  try {
    const manifest = JSON.parse(
      readFileSync(join(getRuntimeApplicationRoot(), 'package.json'), 'utf8'),
    ) as { version?: unknown }
    return typeof manifest.version === 'string' ? manifest.version : '0.0.0'
  } catch {
    return '0.0.0'
  }
}

export function getRuntimeStateDirectory(): string {
  return join(getRuntimeUserDataPath(), 'headless-runtime')
}
