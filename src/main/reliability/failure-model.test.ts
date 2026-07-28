import { describe, expect, it } from 'vitest'
import { failureFromUnknown } from './failure-model'

describe('unified failure model', () => {
  it.each([
    ['401 unauthorized', 'AUTHENTICATION_FAILED', false],
    ['This country is not supported', 'REGION_RESTRICTED', false],
    ['OAuth callback state mismatch', 'OAUTH_CALLBACK_FAILED', true],
    ['fetch failed: ECONNRESET', 'NETWORK_UNREACHABLE', true],
    ['Worker crashed and exited with code 9', 'WORKER_EXITED', true],
    ['Session JSONL was externally modified', 'SESSION_EXTERNALLY_MODIFIED', false],
    ['git worktree not found', 'WORKTREE_UNAVAILABLE', false],
    ['ENOSPC: no space left on device', 'DISK_WRITE_FAILED', false],
    ['SQLITE_BUSY database is locked', 'SQLITE_BUSY', true],
    ['database disk image is malformed', 'SQLITE_CORRUPT', false],
    ['request timed out', 'TIMEOUT', true],
  ] as const)('classifies %s as %s', (message, code, retryable) => {
    const result = failureFromUnknown(new Error(message), 'unknown', 123)
    expect(result).toMatchObject({ code, retryable, timestamp: 123 })
    expect(result.userAction.length).toBeGreaterThan(5)
  })

  it('returns an explicit unknown envelope without leaking arbitrary objects', () => {
    const result = failureFromUnknown({ unexpected: true }, 'storage')
    expect(result.code).toBe('UNKNOWN')
    expect(result.stage).toBe('storage')
    expect(result.message).toBe('{"unexpected":true}')
  })
})
