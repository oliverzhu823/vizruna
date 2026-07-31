import {
  chmodSync,
  copyFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import {
  getLegacyPiAgentDirectory,
  getPiAgentDirectory,
} from './pi-agent-directory'

const IMPORTABLE_FILES = ['auth.json', 'models.json', 'settings.json'] as const
const MAX_CONFIG_BYTES = 5 * 1024 * 1024

type ImportableFile = (typeof IMPORTABLE_FILES)[number]

export interface PiConfigImportInspection {
  available: boolean
  sourceDir: string
  targetDir: string
  files: ImportableFile[]
  providers: string[]
  targetHasConfig: boolean
  reason?: 'same-directory' | 'source-empty'
}

export interface PiConfigImportResult {
  ok: true
  imported: ImportableFile[]
  backupFiles: string[]
  targetDir: string
}

function isImportableRegularFile(path: string): boolean {
  if (!existsSync(path)) return false
  try {
    const stat = lstatSync(path)
    return stat.isFile() && stat.size <= MAX_CONFIG_BYTES
  } catch {
    return false
  }
}

function readJsonObject(path: string): Record<string, unknown> {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as unknown
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${basename(path)} must contain a JSON object`)
  }
  return parsed as Record<string, unknown>
}

function configuredProviders(authPath: string): string[] {
  if (!isImportableRegularFile(authPath)) return []
  try {
    return Object.keys(readJsonObject(authPath)).sort((a, b) => a.localeCompare(b))
  } catch {
    return []
  }
}

export function inspectPiConfigImport(options?: {
  sourceDir?: string
  targetDir?: string
}): PiConfigImportInspection {
  const sourceDir = resolve(options?.sourceDir ?? getLegacyPiAgentDirectory())
  const targetDir = resolve(options?.targetDir ?? getPiAgentDirectory())
  const files = IMPORTABLE_FILES.filter((name) =>
    isImportableRegularFile(join(sourceDir, name)),
  )
  const targetHasConfig = IMPORTABLE_FILES.some((name) =>
    isImportableRegularFile(join(targetDir, name)),
  )
  const sameDirectory = sourceDir === targetDir

  return {
    available: !sameDirectory && files.length > 0,
    sourceDir,
    targetDir,
    files,
    providers: configuredProviders(join(sourceDir, 'auth.json')),
    targetHasConfig,
    reason: sameDirectory
      ? 'same-directory'
      : files.length === 0
        ? 'source-empty'
        : undefined,
  }
}

/**
 * Copy an existing terminal Pi profile into Vizruna's isolated profile.
 * Files are validated and staged before replacement; existing targets receive
 * local 0600 backups and are restored if a later commit fails.
 */
export function importPiConfig(options?: {
  sourceDir?: string
  targetDir?: string
}): PiConfigImportResult {
  const inspection = inspectPiConfigImport(options)
  if (!inspection.available) {
    throw new Error(
      inspection.reason === 'same-directory'
        ? 'The current Pi profile already uses this directory'
        : 'No local Pi configuration is available to import',
    )
  }

  mkdirSync(inspection.targetDir, { recursive: true, mode: 0o700 })
  const staged = new Map<ImportableFile, string>()
  const backups = new Map<ImportableFile, string>()
  const committed: ImportableFile[] = []
  const suffix = `${Date.now()}-${randomUUID()}`

  try {
    for (const name of inspection.files) {
      const source = join(inspection.sourceDir, name)
      const value = readJsonObject(source)
      const stage = join(inspection.targetDir, `.vizruna-import-${suffix}-${name}`)
      writeFileSync(stage, `${JSON.stringify(value, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
        flag: 'wx',
      })
      staged.set(name, stage)
    }

    for (const name of inspection.files) {
      const target = join(inspection.targetDir, name)
      if (!isImportableRegularFile(target)) continue
      const backup = join(
        inspection.targetDir,
        `${name}.vizruna-import-backup-${suffix}`,
      )
      copyFileSync(target, backup)
      chmodSync(backup, 0o600)
      backups.set(name, backup)
    }

    for (const name of inspection.files) {
      renameSync(staged.get(name)!, join(inspection.targetDir, name))
      chmodSync(join(inspection.targetDir, name), 0o600)
      staged.delete(name)
      committed.push(name)
    }
  } catch (error) {
    for (const path of staged.values()) {
      try {
        unlinkSync(path)
      } catch {
        // Best-effort cleanup; original error remains authoritative.
      }
    }
    for (const name of committed.reverse()) {
      const target = join(inspection.targetDir, name)
      const backup = backups.get(name)
      try {
        if (backup) copyFileSync(backup, target)
        else if (existsSync(target)) unlinkSync(target)
      } catch {
        // Preserve the import failure; backups remain available for recovery.
      }
    }
    throw error
  }

  return {
    ok: true,
    imported: [...inspection.files],
    backupFiles: [...backups.values()].map((path) => basename(path)),
    targetDir: inspection.targetDir,
  }
}
