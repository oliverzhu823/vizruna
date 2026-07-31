import { randomUUID } from 'node:crypto'
import { resolve } from 'node:path'
import type { AgentCase } from '@shared/agent-case'
import { auditRepository } from '../../audit/audit-repository'
import { sqliteIndex } from '../../sqlite-index'
import { getTrustedWorkspaceRoot } from '../../trusted-workspace'
import { registerHandlerWithSchema } from '../registry'
import {
  agentCaseArchiveSchema,
  agentCaseCreateSchema,
  agentCaseListSchema,
  agentCaseUpdateSchema,
} from '../schemas'

function requireAgentCase(id: string): AgentCase {
  const agentCase = sqliteIndex.getAgentCase(id)
  if (!agentCase) throw new Error('Agent case not found')
  return agentCase
}

function save(agentCase: AgentCase): AgentCase {
  if (!sqliteIndex.saveAgentCase(agentCase)) {
    throw new Error('Agent case metadata store is unavailable')
  }
  return agentCase
}

export function registerAgentCaseHandlers(): void {
  registerHandlerWithSchema('ipc:agentCase.list', agentCaseListSchema, async (request) => ({
    cases: sqliteIndex.listAgentCases(request),
  }))

  registerHandlerWithSchema('ipc:agentCase.create', agentCaseCreateSchema, async (request) => {
    const trustedWorkspace = getTrustedWorkspaceRoot()
    if (!trustedWorkspace || resolve(trustedWorkspace) !== resolve(request.workspacePath)) {
      throw new Error('Agent cases can only be created from the active trusted workspace')
    }
    const now = Date.now()
    const agentCase = save({
      id: randomUUID(),
      name: request.name,
      summary: request.summary || undefined,
      tags: request.tags ?? [],
      status: 'draft',
      workspacePath: request.workspacePath,
      sourceSessionId: request.sourceSessionId,
      sourceSessionFile: request.sourceSessionFile,
      modelId: request.modelId || undefined,
      thinkingLevel: request.thinkingLevel || undefined,
      createdAt: now,
      updatedAt: now,
    })
    auditRepository.write({
      category: 'operation',
      action: 'agent-case.create',
      outcome: 'success',
      workspaceId: agentCase.workspacePath,
      sessionFile: agentCase.sourceSessionFile,
      details: { agentCaseId: agentCase.id, status: agentCase.status },
    })
    return { agentCase }
  })

  registerHandlerWithSchema('ipc:agentCase.update', agentCaseUpdateSchema, async (request) => {
    const previous = requireAgentCase(request.id)
    const agentCase = save({
      ...previous,
      ...(request.name !== undefined ? { name: request.name } : {}),
      ...(request.summary !== undefined ? { summary: request.summary || undefined } : {}),
      ...(request.tags !== undefined ? { tags: request.tags } : {}),
      ...(request.status !== undefined ? { status: request.status } : {}),
      updatedAt: Date.now(),
    })
    auditRepository.write({
      category: 'operation',
      action: 'agent-case.update',
      outcome: 'success',
      workspaceId: agentCase.workspacePath,
      sessionFile: agentCase.sourceSessionFile,
      details: { agentCaseId: agentCase.id, status: agentCase.status },
    })
    return { agentCase }
  })

  registerHandlerWithSchema('ipc:agentCase.archive', agentCaseArchiveSchema, async (request) => {
    const previous = requireAgentCase(request.id)
    const agentCase = save({ ...previous, status: 'archived', updatedAt: Date.now() })
    auditRepository.write({
      category: 'operation',
      action: 'agent-case.archive',
      outcome: 'success',
      workspaceId: agentCase.workspacePath,
      sessionFile: agentCase.sourceSessionFile,
      details: { agentCaseId: agentCase.id },
    })
    return { agentCase }
  })
}
