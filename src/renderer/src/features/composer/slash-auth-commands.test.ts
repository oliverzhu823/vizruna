import { afterEach, describe, expect, it, vi } from 'vitest'
import { BUILTIN_COMMANDS } from './composer-constants'
import { executeSlashCommand, isExecutableBuiltin } from './slash-exec'

describe('native provider authentication slash commands', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('lists /login and /logout as executable built-ins', () => {
    expect(BUILTIN_COMMANDS.map((command) => command.name)).toEqual(
      expect.arrayContaining(['/login', '/logout']),
    )
    expect(isExecutableBuiltin('/login')).toBe(true)
    expect(isExecutableBuiltin('/logout')).toBe(true)
  })

  it('routes /login with a provider to the native auth manager', async () => {
    const received = vi.fn()
    window.addEventListener('pi-enterprise-desktop:open-provider-auth', received, {
      once: true,
    })

    await expect(executeSlashCommand('/login openai-codex')).resolves.toBe(true)

    expect(received).toHaveBeenCalledTimes(1)
    expect((received.mock.calls[0][0] as CustomEvent).detail).toEqual({
      mode: 'login',
      providerId: 'openai-codex',
    })
  })

  it('routes /logout to the stored-credential manager', async () => {
    const received = vi.fn()
    window.addEventListener('pi-enterprise-desktop:open-provider-auth', received, {
      once: true,
    })

    await expect(executeSlashCommand('/logout')).resolves.toBe(true)

    expect((received.mock.calls[0][0] as CustomEvent).detail).toEqual({
      mode: 'logout',
      providerId: undefined,
    })
  })
})
