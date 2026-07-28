import { resolve } from 'node:path'
import type { ManagedWorktree, WorktreeSafety } from '@shared/managed-worktree'
import { getTrustedWorkspaceRoot } from '../../trusted-workspace'
import { workerManager } from '../../worker-manager'
import { getManagedWorktreeService } from '../../worktree/managed-worktree-instance'
import { ManagedWorktreeError } from '../../worktree/managed-worktree-service'
import { registerHandlerWithSchema } from '../registry'
import {
  worktreeCreateSchema,
  worktreeIdSchema,
  worktreeRemoveSchema,
  worktreeRootSchema,
} from '../schemas'

function errorResponse(error: unknown) {
  if (error instanceof ManagedWorktreeError) {
    return { ok: false as const, code: error.code, error: error.message, details: error.details }
  }
  return {
    ok: false as const,
    code: 'UNKNOWN',
    error: error instanceof Error ? error.message : String(error),
  }
}

async function trustedRoot(requested?: string): Promise<string> {
  const trusted = getTrustedWorkspaceRoot()
  if (!trusted) throw new ManagedWorktreeError('NOT_GIT_REPOSITORY', 'No active workspace')
  if (requested && resolve(requested) !== resolve(trusted)) {
    throw new ManagedWorktreeError(
      'PATH_OUTSIDE_MANAGED_ROOT',
      'Requested repository is not the active trusted workspace',
    )
  }
  return trusted
}

async function assertTrustedWorktree(id: string): Promise<{
  worktree: ManagedWorktree
  activeWorkspace: string
}> {
  const workspace = await trustedRoot()
  const service = getManagedWorktreeService()
  const [capability, worktree] = await Promise.all([
    service.capability(workspace),
    service.get(id),
  ])
  if (!worktree) throw new ManagedWorktreeError('WORKTREE_NOT_FOUND', 'Managed worktree not found')
  const trustedRepositoryRoot = resolve(capability.repositoryRoot || workspace)
  if (resolve(worktree.rootWorkspacePath) !== trustedRepositoryRoot) {
    throw new ManagedWorktreeError(
      'PATH_OUTSIDE_MANAGED_ROOT',
      'Managed worktree does not belong to the active repository',
    )
  }
  return { worktree, activeWorkspace: workspace }
}

function withRuntimeSafety(
  worktree: ManagedWorktree,
  activeWorkspace: string,
  safety: WorktreeSafety,
): WorktreeSafety {
  const inUse =
    resolve(activeWorkspace) === resolve(worktree.worktreePath) ||
    workerManager.hasWorkspaceWorkers(worktree.worktreePath)
  if (!inUse) return safety
  return {
    ...safety,
    safeToRemove: false,
    forceRemovalAllowed: false,
    blockers: [...new Set([...safety.blockers, 'active-workspace' as const])],
  }
}

export function registerWorktreeHandlers(): void {
  registerHandlerWithSchema('ipc:worktree.capability', worktreeRootSchema, async (req) => {
    try {
      const workspace = await trustedRoot(req.rootWorkspacePath)
      const capability = await getManagedWorktreeService().capability(workspace)
      return { ok: true, capability }
    } catch (error) {
      return errorResponse(error)
    }
  })

  registerHandlerWithSchema('ipc:worktree.list', worktreeRootSchema, async (req) => {
    try {
      const workspace = await trustedRoot(req.rootWorkspacePath)
      const service = getManagedWorktreeService()
      const capability = await service.capability(workspace)
      const root = capability.repositoryRoot || workspace
      return { ok: true, worktrees: await service.list(root), managedRoot: service.managedRoot }
    } catch (error) {
      return errorResponse(error)
    }
  })

  registerHandlerWithSchema('ipc:worktree.create', worktreeCreateSchema, async (req) => {
    try {
      const workspace = await trustedRoot(req.rootWorkspacePath)
      const worktree = await getManagedWorktreeService().create({
        ...req,
        rootWorkspacePath: workspace,
      })
      return { ok: true, worktree }
    } catch (error) {
      return errorResponse(error)
    }
  })

  registerHandlerWithSchema('ipc:worktree.inspectRemoval', worktreeIdSchema, async (req) => {
    try {
      const context = await assertTrustedWorktree(req.id)
      const safety = withRuntimeSafety(
        context.worktree,
        context.activeWorkspace,
        await getManagedWorktreeService().inspectSafety(req.id),
      )
      return { ok: true, safety }
    } catch (error) {
      return errorResponse(error)
    }
  })

  registerHandlerWithSchema('ipc:worktree.remove', worktreeRemoveSchema, async (req) => {
    try {
      const context = await assertTrustedWorktree(req.id)
      const service = getManagedWorktreeService()
      const safety = withRuntimeSafety(
        context.worktree,
        context.activeWorkspace,
        await service.inspectSafety(req.id),
      )
      if (!safety.forceRemovalAllowed) {
        throw new ManagedWorktreeError(
          'WORKTREE_UNSAFE',
          'Switch away from this worktree and stop its running tasks before removing it',
          { safety },
        )
      }
      const result = await service.remove(req)
      return { ok: true, ...result }
    } catch (error) {
      return errorResponse(error)
    }
  })

  registerHandlerWithSchema('ipc:worktree.reconcile', worktreeRootSchema, async (req) => {
    try {
      const workspace = await trustedRoot(req.rootWorkspacePath)
      const result = await getManagedWorktreeService().reconcile(workspace)
      return { ok: true, ...result }
    } catch (error) {
      return errorResponse(error)
    }
  })
}
