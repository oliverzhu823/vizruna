export const MINIMUM_SUPPORTED_PI_SDK_VERSION = '0.84.1'
export const SUPPORTED_PI_SDK_MINOR_LINE = '0.84.x'

export interface PiSdkCompatibilityReport {
  compatible: boolean
  missingCapabilities: string[]
}

function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isSupportedPiSdkVersion(version: string): boolean {
  if (version.includes('-')) return false
  const actual = parseVersion(version)
  const minimum = parseVersion(MINIMUM_SUPPORTED_PI_SDK_VERSION)
  if (!actual || !minimum) return false
  // Pi is still pre-1.0 and minor releases can contain breaking changes. Keep
  // externally selectable runtimes on the compatibility line we actually test.
  if (actual[0] !== minimum[0] || actual[1] !== minimum[1]) return false
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true
    if (actual[index] < minimum[index]) return false
  }
  return true
}

function hasFunction(value: unknown, name: string): boolean {
  return (
    (typeof value === 'function' || (typeof value === 'object' && value !== null)) &&
    typeof (value as Record<string, unknown>)[name] === 'function'
  )
}

function hasPrototypeFunction(value: unknown, name: string): boolean {
  if (typeof value !== 'function') return false
  return hasFunction((value as { prototype?: unknown }).prototype, name)
}

/**
 * Runtime surface used by Vizruna's worker, authentication, session and Pi
 * package-management paths. A version-only check is insufficient because Pi
 * permits external/global SDK selection and these APIs are all exercised after
 * startup.
 */
export function inspectPiSdkCompatibility(module: unknown): PiSdkCompatibilityReport {
  if (!module || (typeof module !== 'object' && typeof module !== 'function')) {
    return { compatible: false, missingCapabilities: ['module'] }
  }

  const sdk = module as Record<string, unknown>
  const missingCapabilities: string[] = []
  const requireExport = (name: string) => {
    if (typeof sdk[name] !== 'function') missingCapabilities.push(name)
  }
  const requireStatic = (exportName: string, methodName: string) => {
    if (!hasFunction(sdk[exportName], methodName)) {
      missingCapabilities.push(`${exportName}.${methodName}`)
    }
  }
  const requirePrototype = (exportName: string, methodName: string) => {
    if (!hasPrototypeFunction(sdk[exportName], methodName)) {
      missingCapabilities.push(`${exportName}.prototype.${methodName}`)
    }
  }

  for (const name of [
    'createAgentSessionServices',
    'createAgentSessionRuntime',
    'createAgentSessionFromServices',
    'createEventBus',
    'getAgentDir',
  ]) {
    requireExport(name)
  }
  requireStatic('ModelRuntime', 'create')
  requireStatic('SettingsManager', 'create')
  for (const method of ['create', 'open', 'list']) requireStatic('SessionManager', method)
  for (const method of [
    'resolve',
    'installAndPersist',
    'removeAndPersist',
    'update',
    'checkForAvailableUpdates',
  ]) {
    requirePrototype('DefaultPackageManager', method)
  }

  return { compatible: missingCapabilities.length === 0, missingCapabilities }
}

export function hasRequiredPiSdkCapabilities(module: unknown): boolean {
  return inspectPiSdkCompatibility(module).compatible
}
