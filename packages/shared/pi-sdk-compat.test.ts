import { describe, expect, it } from 'vitest'
import {
  hasRequiredPiSdkCapabilities,
  inspectPiSdkCompatibility,
  isSupportedPiSdkVersion,
  MINIMUM_SUPPORTED_PI_SDK_VERSION,
  SUPPORTED_PI_SDK_MINOR_LINE,
} from './pi-sdk-compat'

describe('Pi SDK compatibility gate', () => {
  it('requires the tested Pi 0.84.1 compatibility line', () => {
    expect(MINIMUM_SUPPORTED_PI_SDK_VERSION).toBe('0.84.1')
    expect(SUPPORTED_PI_SDK_MINOR_LINE).toBe('0.84.x')
    expect(isSupportedPiSdkVersion('0.80.7')).toBe(false)
    expect(isSupportedPiSdkVersion('0.82.1')).toBe(false)
    expect(isSupportedPiSdkVersion('0.84.0')).toBe(false)
    expect(isSupportedPiSdkVersion('0.84.1')).toBe(true)
    expect(isSupportedPiSdkVersion('0.84.2')).toBe(true)
    expect(isSupportedPiSdkVersion('0.84.2-beta.1')).toBe(false)
    expect(isSupportedPiSdkVersion('0.85.0')).toBe(false)
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

  it('reports missing Pi-native package capabilities instead of accepting a partial SDK', () => {
    class ModelRuntime {
      static create() {}
    }
    const report = inspectPiSdkCompatibility({
      ModelRuntime,
      createAgentSessionServices() {},
      createAgentSessionRuntime() {},
      createAgentSessionFromServices() {},
      createEventBus() {},
      getAgentDir() {},
    })
    expect(report.compatible).toBe(false)
    expect(report.missingCapabilities).toContain('DefaultPackageManager.prototype.resolve')
  })

  it('accepts the complete surface used by the Pi-native architecture', () => {
    class ModelRuntime {
      static create() {}
    }
    class SettingsManager {
      static create() {}
    }
    class SessionManager {
      static create() {}
      static open() {}
      static list() {}
    }
    class DefaultPackageManager {
      resolve() {}
      installAndPersist() {}
      removeAndPersist() {}
      update() {}
      checkForAvailableUpdates() {}
    }
    expect(hasRequiredPiSdkCapabilities({
      ModelRuntime,
      SettingsManager,
      SessionManager,
      DefaultPackageManager,
      createAgentSessionServices() {},
      createAgentSessionRuntime() {},
      createAgentSessionFromServices() {},
      createEventBus() {},
      getAgentDir() {},
    })).toBe(true)
  })
})
