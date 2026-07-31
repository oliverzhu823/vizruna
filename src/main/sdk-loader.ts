// SDK Loader - 解析当前生效 pi SDK 入口（内置 / 全局 / 独立环境）

import { existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { app } from 'electron'
import { resolveApplicationRoot } from './application-root'
import {
  discoverGlobalPiCodingAgentRoot,
  resolvePackageEntryPath,
  validatePiCodingAgentRoot,
} from './global-sdk-resolve'
import { isSupportedPiSdkVersion } from '@shared/pi-sdk-compat'

const PKG = '@earendil-works/pi-coding-agent'

export type SdkKind = 'builtin' | 'global' | 'user'

export interface ActiveSdk {
  kind: SdkKind
  version: string
  entryPath: string
  fallbackReason?: string
}

let globalSdkPathCache: string | null | undefined

export function clearGlobalSdkPathCache(): void {
  globalSdkPathCache = undefined
}

export function readBuiltinSdkVersion(): string {
  try {
    const applicationRoot = resolveApplicationRoot(app.getAppPath())
    const pkgPath = join(
      applicationRoot,
      'node_modules',
      '@earendil-works',
      'pi-coding-agent',
      'package.json',
    )
    if (existsSync(pkgPath)) {
      const pkg = JSON.parse(readFileSync(pkgPath, 'utf-8'))
      return pkg.version || ''
    }
  } catch (e) { void e }
  return ''
}

function resolveEntryPath(pkgRoot: string): string | null {
  return resolvePackageEntryPath(pkgRoot)
}

function validateEntry(pkgRoot: string): boolean {
  return validatePiCodingAgentRoot(pkgRoot)
}

export function resolveGlobalSdkPath(): string | null {
  if (globalSdkPathCache !== undefined) return globalSdkPathCache
  const result = discoverGlobalPiCodingAgentRoot()
  if (result) globalSdkPathCache = result
  return result
}

export function readGlobalSdkVersion(): string | null {
  return readVersionAt(resolveGlobalSdkPath())
}

export function resolveUserSdkPath(userDataDir: string): string | null {
  const pkgRoot = join(userDataDir, 'sdk', 'current', 'node_modules', '@earendil-works', 'pi-coding-agent')
  return validateEntry(pkgRoot) ? pkgRoot : null
}

export function readUserSdkVersion(userDataDir: string): string | null {
  return readVersionAt(resolveUserSdkPath(userDataDir))
}

function readVersionAt(pkgRoot: string | null): string | null {
  if (!pkgRoot) return null
  try {
    const pkg = JSON.parse(readFileSync(join(pkgRoot, 'package.json'), 'utf-8'))
    return pkg.version || null
  } catch (e) {
    return null
  }
}

interface CurrentJson {
  active: SdkKind
}

function readCurrentJson(userDataDir: string): CurrentJson {
  try {
    const p = join(userDataDir, 'sdk', 'current.json')
    if (!existsSync(p)) return { active: 'builtin' }
    const data = JSON.parse(readFileSync(p, 'utf-8'))
    if (data?.active === 'global' || data?.active === 'user') return { active: data.active }
    return { active: 'builtin' }
  } catch (e) {
    return { active: 'builtin' }
  }
}

export function resolveActiveSdk(userDataDir: string): ActiveSdk {
  const { active } = readCurrentJson(userDataDir)
  if (active === 'global') {
    const globalRoot = resolveGlobalSdkPath()
    if (globalRoot) {
      const entry = resolveEntryPath(globalRoot)
      const version = readGlobalSdkVersion() || ''
      if (entry && isSupportedPiSdkVersion(version)) {
        return { kind: 'global', version, entryPath: entry }
      }
      if (entry) {
        return {
          kind: 'builtin',
          version: readBuiltinSdkVersion(),
          entryPath: PKG,
          fallbackReason: 'global-incompatible',
        }
      }
    }
    return { kind: 'builtin', version: readBuiltinSdkVersion(), entryPath: PKG, fallbackReason: 'global-unavailable' }
  }
  if (active === 'user') {
    const userRoot = resolveUserSdkPath(userDataDir)
    if (userRoot) {
      const entry = resolveEntryPath(userRoot)
      const version = readUserSdkVersion(userDataDir) || ''
      if (entry && isSupportedPiSdkVersion(version)) {
        return { kind: 'user', version, entryPath: entry }
      }
      if (entry) {
        return {
          kind: 'builtin',
          version: readBuiltinSdkVersion(),
          entryPath: PKG,
          fallbackReason: 'user-incompatible',
        }
      }
    }
    return { kind: 'builtin', version: readBuiltinSdkVersion(), entryPath: PKG, fallbackReason: 'user-unavailable' }
  }
  return { kind: 'builtin', version: readBuiltinSdkVersion(), entryPath: PKG }
}
