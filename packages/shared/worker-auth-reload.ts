export const AUTH_RELOAD_DEFERRED_ACTIVE_TURN = 'AUTH_RELOAD_DEFERRED_ACTIVE_TURN'
export const AUTH_RELOAD_ALREADY_RUNNING = 'AUTH_RELOAD_ALREADY_RUNNING'
export const AUTH_RELOAD_RUNTIME_INVALID = 'AUTH_RELOAD_RUNTIME_INVALID'

export function isDeferredAuthenticationReloadError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes(AUTH_RELOAD_DEFERRED_ACTIVE_TURN) ||
    message.includes(AUTH_RELOAD_ALREADY_RUNNING)
  )
}

export function isInvalidAuthenticationRuntimeError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes(AUTH_RELOAD_RUNTIME_INVALID)
}
