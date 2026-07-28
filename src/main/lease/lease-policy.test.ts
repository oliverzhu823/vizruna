import { describe, expect, it, vi } from 'vitest'
import type { SessionLeaseRecord } from '@shared/session-lease'
import { classifyLeaseRecord } from './lease-policy'

const baseRecord: SessionLeaseRecord = {
  version: 1,
  appId: 'com.example.app',
  instanceId: '11111111-1111-4111-8111-111111111111',
  hostname: 'host-a',
  pid: 123,
  sessionFile: '/tmp/session.jsonl',
  acquiredAt: '2026-07-25T00:00:00.000Z',
  refreshedAt: '2026-07-25T00:00:50.000Z',
}

function classify(
  record: SessionLeaseRecord | null,
  overrides: Partial<Parameters<typeof classifyLeaseRecord>[3]> = {},
) {
  return classifyLeaseRecord('/tmp/session.jsonl', '/tmp/session.jsonl.lease', record, {
    instanceId: '22222222-2222-4222-8222-222222222222',
    hostname: 'host-a',
    nowMs: Date.parse('2026-07-25T00:01:00.000Z'),
    ttlMs: 60_000,
    isPidAlive: vi.fn(() => true),
    ...overrides,
  })
}

describe('session lease policy', () => {
  it('marks a missing lease as available', () => {
    expect(classify(null)).toMatchObject({ disposition: 'available', reason: 'missing' })
  })

  it('recognizes the same app instance as owner', () => {
    expect(
      classify(baseRecord, { instanceId: baseRecord.instanceId }),
    ).toMatchObject({ disposition: 'owned', reason: 'same-instance' })
  })

  it('blocks a live process on the same host', () => {
    expect(classify(baseRecord)).toMatchObject({
      disposition: 'active-foreign',
      reason: 'same-host-live-pid',
    })
  })

  it('marks a dead process on the same host as stale', () => {
    expect(classify(baseRecord, { isPidAlive: () => false })).toMatchObject({
      disposition: 'stale',
      reason: 'same-host-dead-pid',
    })
  })

  it('uses TTL for a different host', () => {
    const foreignHostRecord = { ...baseRecord, hostname: 'host-b' }
    expect(classify(foreignHostRecord)).toMatchObject({
      disposition: 'active-foreign',
      reason: 'cross-host-fresh',
    })
    expect(
      classify(foreignHostRecord, {
        nowMs: Date.parse('2026-07-25T00:02:00.001Z'),
      }),
    ).toMatchObject({ disposition: 'stale', reason: 'cross-host-expired' })
  })
})

