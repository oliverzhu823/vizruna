export const MINIMUM_SUPPORTED_PI_SDK_VERSION = '0.82.1'

function parseVersion(version: string): [number, number, number] | null {
  const match = version.trim().match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/)
  if (!match) return null
  return [Number(match[1]), Number(match[2]), Number(match[3])]
}

export function isSupportedPiSdkVersion(version: string): boolean {
  const actual = parseVersion(version)
  const minimum = parseVersion(MINIMUM_SUPPORTED_PI_SDK_VERSION)
  if (!actual || !minimum) return false
  for (let index = 0; index < minimum.length; index += 1) {
    if (actual[index] > minimum[index]) return true
    if (actual[index] < minimum[index]) return false
  }
  return true
}

/** Runtime surface required by the embedded ModelRuntime-based architecture. */
export function hasRequiredPiSdkCapabilities(module: unknown): boolean {
  if (!module || typeof module !== 'object') return false
  const sdk = module as Record<string, unknown>
  const modelRuntime = sdk.ModelRuntime
  return (
    typeof modelRuntime === 'function' &&
    typeof (modelRuntime as unknown as { create?: unknown }).create === 'function' &&
    typeof sdk.createAgentSessionServices === 'function' &&
    typeof sdk.createAgentSessionRuntime === 'function' &&
    typeof sdk.createAgentSessionFromServices === 'function' &&
    typeof sdk.createEventBus === 'function'
  )
}
