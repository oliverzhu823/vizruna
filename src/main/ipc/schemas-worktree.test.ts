import { describe, expect, it } from 'vitest'
import {
  worktreeCreateSchema,
  worktreeIdSchema,
  worktreeRemoveSchema,
  metadataRestoreSchema,
  auditQuerySchema,
} from './schemas'

const id = '11111111-1111-4111-8111-111111111111'

describe('managed worktree IPC schemas', () => {
  it('accepts a bounded create request and rejects oversized task names', () => {
    expect(
      worktreeCreateSchema.safeParse({
        name: 'customer-api',
        branchName: 'feature/customer-api',
        baseRef: 'main',
      }).success,
    ).toBe(true)
    expect(worktreeCreateSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false)
    expect(
      worktreeCreateSchema.safeParse({ branchName: 'x'.repeat(201) }).success,
    ).toBe(false)
  })

  it('requires UUID identifiers', () => {
    expect(worktreeIdSchema.safeParse({ id }).success).toBe(true)
    expect(worktreeIdSchema.safeParse({ id: '../outside' }).success).toBe(false)
  })

  it('requires literal confirmation for a forced removal', () => {
    expect(worktreeRemoveSchema.safeParse({ id, force: true }).success).toBe(false)
    expect(
      worktreeRemoveSchema.safeParse({
        id,
        force: true,
        confirmed: true,
        deleteBranch: true,
      }).success,
    ).toBe(true)
  })

  it('bounds audit queries and requires a literal metadata restore confirmation', () => {
    expect(auditQuerySchema.safeParse({ outcome: 'failed', limit: 10_000 }).success).toBe(true)
    expect(auditQuerySchema.safeParse({ limit: 10_001 }).success).toBe(false)
    expect(
      metadataRestoreSchema.safeParse({
        backupId: 'pi-enterprise-desktop-manual-123-v4.db',
        confirmation: 'RESTORE_METADATA',
      }).success,
    ).toBe(true)
    expect(
      metadataRestoreSchema.safeParse({
        backupId: '../outside.db',
        confirmation: 'yes',
      }).success,
    ).toBe(false)
  })
})
