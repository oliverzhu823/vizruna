import { describe, expect, it } from 'vitest'
import { createAuditEvent } from './audit-repository'

describe('audit repository', () => {
  it('redacts secrets recursively before persistence', () => {
    const event = createAuditEvent({
      category: 'security',
      action: 'test',
      outcome: 'success',
      details: {
        token: 'top-secret',
        nested: { apiKey: 'another-secret', safe: 'visible' },
      },
    })
    expect(event.details).toEqual({
      token: '[REDACTED]',
      nested: { apiKey: '[REDACTED]', safe: 'visible' },
    })
  })
})

