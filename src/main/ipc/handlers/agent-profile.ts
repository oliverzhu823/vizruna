import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '@shared/agent-profile'
import { auditRepository } from '../../audit/audit-repository'
import { getSessionAgentBinding } from '../../agent-profile-service'
import { sqliteIndex } from '../../sqlite-index'
import { registerHandlerWithSchema } from '../registry'
import {
  agentProfileArchiveSchema,
  agentProfileCreateSchema,
  agentProfileListSchema,
  agentProfileUpdateSchema,
  sessionAgentBindingGetSchema,
} from '../schemas'

function requireProfile(id: string): AgentProfile {
  const profile = sqliteIndex.getAgentProfile(id)
  if (!profile) throw new Error('Agent configuration not found')
  return profile
}

function save(profile: AgentProfile): AgentProfile {
  if (!sqliteIndex.saveAgentProfile(profile)) {
    throw new Error('Agent configuration store is unavailable')
  }
  return profile
}

export function registerAgentProfileHandlers(): void {
  registerHandlerWithSchema('ipc:agentProfile.list', agentProfileListSchema, async (request) => ({
    profiles: sqliteIndex.listAgentProfiles(request),
  }))

  registerHandlerWithSchema(
    'ipc:agentProfile.create',
    agentProfileCreateSchema,
    async (request) => {
      const now = Date.now()
      const profile = save({
        id: randomUUID(),
        name: request.name,
        description: request.description || undefined,
        systemPrompt: request.systemPrompt,
        promptMode: request.promptMode,
        modelId: request.modelId || undefined,
        thinkingLevel: request.thinkingLevel || undefined,
        tools: request.tools,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      auditRepository.write({
        category: 'operation',
        action: 'agent-profile.create',
        outcome: 'success',
        details: { profileId: profile.id, promptMode: profile.promptMode },
      })
      return { profile }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentProfile.update',
    agentProfileUpdateSchema,
    async (request) => {
      const previous = requireProfile(request.id)
      const profile = save({
        ...previous,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.description !== undefined
          ? { description: request.description || undefined }
          : {}),
        ...(request.systemPrompt !== undefined
          ? { systemPrompt: request.systemPrompt }
          : {}),
        ...(request.promptMode !== undefined ? { promptMode: request.promptMode } : {}),
        ...(request.modelId !== undefined
          ? { modelId: request.modelId || undefined }
          : {}),
        ...(request.thinkingLevel !== undefined
          ? { thinkingLevel: request.thinkingLevel || undefined }
          : {}),
        ...(request.tools !== undefined
          ? { tools: request.tools === null ? undefined : request.tools }
          : {}),
        updatedAt: Date.now(),
      })
      auditRepository.write({
        category: 'operation',
        action: 'agent-profile.update',
        outcome: 'success',
        details: { profileId: profile.id, promptMode: profile.promptMode },
      })
      return { profile }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentProfile.archive',
    agentProfileArchiveSchema,
    async (request) => {
      const previous = requireProfile(request.id)
      const profile = save({ ...previous, status: 'archived', updatedAt: Date.now() })
      auditRepository.write({
        category: 'operation',
        action: 'agent-profile.archive',
        outcome: 'success',
        details: { profileId: profile.id },
      })
      return { profile }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentProfile.binding.get',
    sessionAgentBindingGetSchema,
    async (request) => ({
      binding: getSessionAgentBinding(request),
    }),
  )
}
