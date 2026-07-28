import { app } from 'electron'
import { join } from 'node:path'
import { PRODUCT_PACKAGE_NAME } from '@shared/product-identity'
import { auditRepository } from '../audit/audit-repository'
import { SqliteManagedWorktreeRepository } from './managed-worktree-repository'
import { ManagedWorktreeService } from './managed-worktree-service'

let instance: ManagedWorktreeService | null = null

export function getManagedWorktreeService(): ManagedWorktreeService {
  if (!instance) {
    instance = new ManagedWorktreeService({
      managedRoot: join(app.getPath('home'), `.${PRODUCT_PACKAGE_NAME}`, 'worktrees'),
      repository: new SqliteManagedWorktreeRepository(),
      audit: (event) => {
        auditRepository.write(event)
      },
    })
  }
  return instance
}
