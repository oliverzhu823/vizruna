import { describe, expect, it } from 'vitest'
import {
  piPackageMutationSchema,
  piPackageUpdateCheckSchema,
  piResourceFilterSetSchema,
} from './schemas'

describe('Pi resource mutation IPC schemas', () => {
  it('requires an explicit confirmation for package mutations', () => {
    expect(piPackageMutationSchema.safeParse({
      action: 'install',
      source: 'npm:@example/tools',
      scope: 'user',
    }).success).toBe(false)
    expect(piPackageMutationSchema.safeParse({
      action: 'install',
      source: 'npm:@example/tools',
      scope: 'user',
      confirmed: true,
    }).success).toBe(true)
  })

  it('bounds update checks and filter mutations to typed workspace requests', () => {
    expect(piPackageUpdateCheckSchema.safeParse({ workspaceId: '/workspace' }).success).toBe(true)
    expect(piResourceFilterSetSchema.safeParse({
      workspaceId: '/workspace',
      resourceId: 'skills:user:/agent/skills/review/SKILL.md',
      enabled: false,
    }).success).toBe(true)
    expect(piResourceFilterSetSchema.safeParse({ resourceId: '', enabled: false }).success).toBe(false)
  })
})
