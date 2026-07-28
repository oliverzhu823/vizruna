import { resolve } from 'node:path'
import { getOrchestrationService } from '../../orchestration/orchestration-instance'
import { getTrustedWorkspaceRoot } from '../../trusted-workspace'
import { getManagedWorktreeService } from '../../worktree/managed-worktree-instance'
import { registerHandlerWithSchema } from '../registry'
import {
  orchestrationCreateSchema,
  orchestrationIdSchema,
  orchestrationListSchema,
  orchestrationResumeSchema,
  orchestrationSendSchema,
} from '../schemas'

function trustedWorkspace(requested?: string): string {
  const trusted = getTrustedWorkspaceRoot()
  if (!trusted) throw new Error('No active trusted workspace')
  if (requested && resolve(requested) !== resolve(trusted)) {
    throw new Error('Requested workspace is not the active trusted workspace')
  }
  return trusted
}

async function trustedRepositoryRoot(requested?: string): Promise<{
  activeWorkspace: string
  repositoryRoot: string
}> {
  const activeWorkspace = trustedWorkspace(requested)
  const capability = await getManagedWorktreeService().capability(
    activeWorkspace,
  )
  return {
    activeWorkspace,
    repositoryRoot: capability.repositoryRoot || activeWorkspace,
  }
}

async function assertTrustedRelationship(relationshipId: string) {
  const [context, snapshot] = await Promise.all([
    trustedRepositoryRoot(),
    getOrchestrationService().readChild(relationshipId),
  ])
  if (
    resolve(snapshot.relationship.rootWorkspacePath) !==
    resolve(context.repositoryRoot)
  ) {
    throw new Error('Child agent does not belong to the active trusted repository')
  }
  return snapshot
}

export function registerOrchestrationHandlers(): void {
  registerHandlerWithSchema(
    'ipc:orchestration.list',
    orchestrationListSchema,
    async (request) => {
      const context = await trustedRepositoryRoot(request.rootWorkspacePath)
      return {
        relationships: await getOrchestrationService().listWorkspace(
          context.repositoryRoot,
        ),
      }
    },
  )

  registerHandlerWithSchema(
    'ipc:orchestration.create',
    orchestrationCreateSchema,
    async (request) => {
      const context = await trustedRepositoryRoot(request.rootWorkspacePath)
      return {
        relationship: await getOrchestrationService().createChild({
          ...request,
          rootWorkspacePath: context.repositoryRoot,
          parentWorkspacePath: context.activeWorkspace,
          parentWorkerKey: `renderer:${request.parentSessionFile}`,
        }),
      }
    },
  )

  registerHandlerWithSchema(
    'ipc:orchestration.read',
    orchestrationIdSchema,
    async (request) => ({
      snapshot: await assertTrustedRelationship(request.relationshipId),
    }),
  )

  registerHandlerWithSchema(
    'ipc:orchestration.send',
    orchestrationSendSchema,
    async (request) => {
      await assertTrustedRelationship(request.relationshipId)
      return {
        relationship: await getOrchestrationService().sendMessage(
          request.relationshipId,
          request.text,
        ),
      }
    },
  )

  registerHandlerWithSchema(
    'ipc:orchestration.stop',
    orchestrationIdSchema,
    async (request) => {
      await assertTrustedRelationship(request.relationshipId)
      return {
        relationship: await getOrchestrationService().cancelChild(
          request.relationshipId,
        ),
      }
    },
  )

  registerHandlerWithSchema(
    'ipc:orchestration.resume',
    orchestrationResumeSchema,
    async (request) => {
      await assertTrustedRelationship(request.relationshipId)
      return {
        relationship: await getOrchestrationService().resumeChild(
          request.relationshipId,
          request.action,
        ),
      }
    },
  )
}
