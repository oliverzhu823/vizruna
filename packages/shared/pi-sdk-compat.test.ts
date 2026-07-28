import { describe, expect, it } from 'vitest'
import {
  hasRequiredPiSdkCapabilities,
  isSupportedPiSdkVersion,
  MINIMUM_SUPPORTED_PI_SDK_VERSION,
} from './pi-sdk-compat'

describe('Pi SDK compatibility gate', () => {
  it('rejects the importable 0.80.x line and accepts the ModelRuntime line', () => {
    expect(MINIMUM_SUPPORTED_PI_SDK_VERSION).toBe('0.82.1')
    expect(isSupportedPiSdkVersion('0.80.7')).toBe(false)
    expect(isSupportedPiSdkVersion('0.82.0')).toBe(false)
    expect(isSupportedPiSdkVersion('0.82.1')).toBe(true)
    expect(isSupportedPiSdkVersion('0.83.0-beta.1')).toBe(true)
  })

  it('rejects a legacy-shaped SDK that has ModelRegistry but no ModelRuntime', () => {
    const legacySdk = {
      ModelRegistry: class ModelRegistry {},
      createAgentSessionServices() {},
      createAgentSessionRuntime() {},
      createAgentSessionFromServices() {},
      createEventBus() {},
    }
    expect(hasRequiredPiSdkCapabilities(legacySdk)).toBe(false)
  })

  it('accepts the capabilities used by the embedded architecture', () => {
    class ModelRuntime {
      static create() {}
    }
    expect(
      hasRequiredPiSdkCapabilities({
        ModelRuntime,
        createAgentSessionServices() {},
        createAgentSessionRuntime() {},
        createAgentSessionFromServices() {},
        createEventBus() {},
      }),
    ).toBe(true)
  })
})
