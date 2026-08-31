import { describe, expect, it } from 'vitest'
import { resolveRuntimePermission } from './permission-policy'

describe('resolveRuntimePermission', () => {
  it('keeps observe mode read-only', () => {
    const result = resolveRuntimePermission({ mode: 'observe' })
    expect(result.allowedTools).toEqual(['read', 'find', 'grep', 'ls'])
    expect(result.deniedTools).toEqual(['bash', 'edit', 'write'])
  })

  it('requires explicit approval for shell tools in collaborate mode', () => {
    expect(resolveRuntimePermission({ mode: 'collaborate' }).allowedTools).not.toContain('bash')
    expect(resolveRuntimePermission({ mode: 'collaborate', approvedTools: ['bash'] }).allowedTools)
      .toContain('bash')
  })

  it('allows the full requested profile in autonomous mode', () => {
    expect(resolveRuntimePermission({
      mode: 'autonomous',
      requestedTools: ['read', 'bash', 'custom'],
    }).allowedTools).toEqual(['read', 'bash', 'custom'])
  })
})
