import { randomUUID } from 'node:crypto'
import type { AgentProfile } from '@shared/agent-profile'
import { resolveAgentPiResourceSnapshot } from '@shared/agent-composer'
import { hasAgentProviderRequirements } from '@shared/agent-provider-requirements'
import { auditRepository } from '../../audit/audit-repository'
import { ensureAgentVersion } from '../../agent-version-service'
import { getSessionAgentBinding } from '../../agent-profile-service'
import { collectPiResourceCenterSnapshot } from '../../pi-resource-center-service'
import { buildPiPackageStudioPlan, exportPiPackage } from '../../pi-package-studio-service'
import { applyPiPackageImport, previewPiPackageImport } from '../../pi-package-import-service'
import { sqliteIndex } from '../../sqlite-index'
import { registerHandlerWithSchema } from '../registry'
import {
  agentProfileArchiveSchema,
  agentProfileCreateSchema,
  agentProfileListSchema,
  agentProfilePreviewSchema,
  agentProfileUpdateSchema,
  piPackageStudioExportSchema,
  piPackageStudioPreviewSchema,
  piPackageImportApplySchema,
  piPackageImportPreviewSchema,
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

function validateProviderRequirements(profile: Pick<AgentProfile, 'modelId' | 'providerRequirements'>): void {
  if (hasAgentProviderRequirements(profile.providerRequirements) && !profile.modelId) {
    throw new Error('AGENT_MODEL_REQUIRED')
  }
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
      const nextProfile: AgentProfile = {
        id: randomUUID(),
        name: request.name,
        description: request.description || undefined,
        systemPrompt: request.systemPrompt,
        promptMode: request.promptMode,
        modelId: request.modelId || undefined,
        thinkingLevel: request.thinkingLevel || undefined,
        tools: request.tools,
        extensionTools: request.extensionTools,
        resourceSelection: request.resourceSelection,
        providerRequirements: request.providerRequirements,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      }
      validateProviderRequirements(nextProfile)
      const profile = save(nextProfile)
      const version = ensureAgentVersion(profile, now)
      auditRepository.write({
        category: 'operation',
        action: 'agent-profile.create',
        outcome: 'success',
        details: {
          profileId: profile.id,
          versionId: version.id,
          versionNumber: version.number,
          promptMode: profile.promptMode,
        },
      })
      return { profile }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentProfile.update',
    agentProfileUpdateSchema,
    async (request) => {
      const previous = requireProfile(request.id)
      const nextProfile: AgentProfile = {
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
        ...(request.extensionTools !== undefined
          ? {
              extensionTools:
                request.extensionTools === null ? undefined : request.extensionTools,
            }
          : {}),
        ...(request.resourceSelection !== undefined
          ? {
              resourceSelection:
                request.resourceSelection === null ? undefined : request.resourceSelection,
            }
          : {}),
        ...(request.providerRequirements !== undefined
          ? {
              providerRequirements:
                request.providerRequirements === null
                  ? undefined
                  : request.providerRequirements,
            }
          : {}),
        updatedAt: Date.now(),
      }
      validateProviderRequirements(nextProfile)
      const profile = save(nextProfile)
      const version = ensureAgentVersion(profile, profile.updatedAt)
      auditRepository.write({
        category: 'operation',
        action: 'agent-profile.update',
        outcome: 'success',
        details: {
          profileId: profile.id,
          versionId: version.id,
          versionNumber: version.number,
          promptMode: profile.promptMode,
        },
      })
      return { profile }
    },
  )

  registerHandlerWithSchema(
    'ipc:agentProfile.preview',
    agentProfilePreviewSchema,
    async (request) => {
      const catalog = await collectPiResourceCenterSnapshot({ workspaceId: request.workspaceId })
      const preview = resolveAgentPiResourceSnapshot(request.resourceSelection, catalog)
      return { ...preview, catalog }
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
  registerHandlerWithSchema(
    'ipc:pi.packageStudio.preview',
    piPackageStudioPreviewSchema,
    async (request) => ({ plan: await buildPiPackageStudioPlan(request) }),
  )
  registerHandlerWithSchema(
    'ipc:pi.packageStudio.export',
    piPackageStudioExportSchema,
    exportPiPackage,
  )
  registerHandlerWithSchema(
    'ipc:pi.packageStudio.import.preview',
    piPackageImportPreviewSchema,
    async (request) => ({ plan: await previewPiPackageImport(request) }),
  )
  registerHandlerWithSchema(
    'ipc:pi.packageStudio.import.apply',
    piPackageImportApplySchema,
    applyPiPackageImport,
  )
}
