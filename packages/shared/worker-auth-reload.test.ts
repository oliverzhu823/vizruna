import { describe, expect, it } from 'vitest'
import {
  AUTH_RELOAD_RUNTIME_INVALID,
  isDeferredAuthenticationReloadError,
  isInvalidAuthenticationRuntimeError,
} from './worker-auth-reload'

describe('worker authentication reload errors', () => {
  it('keeps an active turn alive when reload must be deferred', () => {
    expect(
      isDeferredAuthenticationReloadError(
        new Error('reloadAuthentication failed: AUTH_RELOAD_DEFERRED_ACTIVE_TURN'),
      ),
    ).toBe(true)
    expect(isInvalidAuthenticationRuntimeError('AUTH_RELOAD_DEFERRED_ACTIVE_TURN')).toBe(false)
  })

  it('only marks post-disposal reopen failures as runtime-invalid', () => {
    expect(
      isInvalidAuthenticationRuntimeError(
        new Error(`${AUTH_RELOAD_RUNTIME_INVALID}: failed to reopen session`),
      ),
    ).toBe(true)
  })
})
