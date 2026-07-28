import type { ManagedWorktree } from '@shared/managed-worktree'
import { sqliteIndex } from '../sqlite-index'

export interface ManagedWorktreeRepository {
  save(worktree: ManagedWorktree): void | Promise<void>
  get(id: string): ManagedWorktree | null | Promise<ManagedWorktree | null>
  list(options?: {
    rootWorkspacePath?: string
    includeRemoved?: boolean
  }): ManagedWorktree[] | Promise<ManagedWorktree[]>
}
export class SqliteManagedWorktreeRepository implements ManagedWorktreeRepository {
  save(worktree: ManagedWorktree): void {
    sqliteIndex.upsertManagedWorktree(worktree)
  }

  get(id: string): ManagedWorktree | null {
    return sqliteIndex.getManagedWorktree(id)
  }

  list(options?: {
    rootWorkspacePath?: string
    includeRemoved?: boolean
  }): ManagedWorktree[] {
    return sqliteIndex.listManagedWorktrees(options)
  }
}

export class MemoryManagedWorktreeRepository implements ManagedWorktreeRepository {
  private readonly records = new Map<string, ManagedWorktree>()

  save(worktree: ManagedWorktree): void {
    this.records.set(worktree.id, structuredClone(worktree))
  }

  get(id: string): ManagedWorktree | null {
    const record = this.records.get(id)
    return record ? structuredClone(record) : null
  }

  list(options?: {
    rootWorkspacePath?: string
    includeRemoved?: boolean
  }): ManagedWorktree[] {
    return [...this.records.values()]
      .filter(
        (record) =>
          (!options?.rootWorkspacePath ||
            record.rootWorkspacePath === options.rootWorkspacePath) &&
          (options?.includeRemoved === true || record.status !== 'removed'),
      )
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((record) => structuredClone(record))
  }
}
