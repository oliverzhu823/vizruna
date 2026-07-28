import { describe, expect, it } from 'vitest'
import { redactSensitive } from './redaction'

describe('diagnostic redaction', () => {
  it('redacts sensitive keys and secret-shaped values', () => {
    const result = redactSensitive({
      apiKey: 'sk-by-key-name',
      safe: 'Bearer abc.def.ghi',
      proxy: 'socks5://alice:super-secret@127.0.0.1:1080',
      nested: {
        note: 'token=decoy-token-value',
        github: 'ghp_123456789012345678901234567890',
      },
    })
    const serialized = JSON.stringify(result.value)
    expect(serialized).not.toContain('sk-by-key-name')
    expect(serialized).not.toContain('abc.def.ghi')
    expect(serialized).not.toContain('alice')
    expect(serialized).not.toContain('super-secret')
    expect(serialized).not.toContain('decoy-token-value')
    expect(serialized).not.toContain('123456789012345678901234567890')
    expect(result.redactionCount).toBeGreaterThanOrEqual(5)
  })

  it('keeps ordinary operational values visible', () => {
    const result = redactSensitive({
      status: 'running',
      workerCount: 4,
      path: '/tmp/project',
    })
    expect(result.value).toEqual({
      status: 'running',
      workerCount: 4,
      path: '/tmp/project',
    })
    expect(result.redactionCount).toBe(0)
  })
})

