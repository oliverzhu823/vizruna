import { randomUUID } from 'node:crypto'
import type { SystemPromptPreset } from '@shared/system-prompt-preset'
import { auditRepository } from '../../audit/audit-repository'
import { getConversationConfigBinding } from '../../system-prompt-preset-service'
import { sqliteIndex } from '../../sqlite-index'
import { registerHandlerWithSchema } from '../registry'
import {
  conversationConfigBindingGetSchema,
  systemPromptPresetArchiveSchema,
  systemPromptPresetCreateSchema,
  systemPromptPresetListSchema,
  systemPromptPresetUpdateSchema,
} from '../schemas'

function requirePreset(id: string): SystemPromptPreset {
  const preset = sqliteIndex.getSystemPromptPreset(id)
  if (!preset) throw new Error('System prompt not found')
  return preset
}

function save(preset: SystemPromptPreset): SystemPromptPreset {
  if (!sqliteIndex.saveSystemPromptPreset(preset)) {
    throw new Error('System prompt store is unavailable')
  }
  return preset
}

export function registerSystemPromptPresetHandlers(): void {
  registerHandlerWithSchema(
    'ipc:systemPromptPreset.list',
    systemPromptPresetListSchema,
    async (request) => ({
      presets: sqliteIndex.listSystemPromptPresets(request),
    }),
  )

  registerHandlerWithSchema(
    'ipc:systemPromptPreset.create',
    systemPromptPresetCreateSchema,
    async (request) => {
      const now = Date.now()
      const preset = save({
        id: randomUUID(),
        name: request.name,
        description: request.description || undefined,
        systemPrompt: request.systemPrompt,
        promptMode: request.promptMode,
        status: 'active',
        createdAt: now,
        updatedAt: now,
      })
      auditRepository.write({
        category: 'operation',
        action: 'system-prompt-preset.create',
        outcome: 'success',
        details: { presetId: preset.id, promptMode: preset.promptMode },
      })
      return { preset }
    },
  )

  registerHandlerWithSchema(
    'ipc:systemPromptPreset.update',
    systemPromptPresetUpdateSchema,
    async (request) => {
      const previous = requirePreset(request.id)
      const preset = save({
        ...previous,
        ...(request.name !== undefined ? { name: request.name } : {}),
        ...(request.description !== undefined
          ? { description: request.description || undefined }
          : {}),
        ...(request.systemPrompt !== undefined ? { systemPrompt: request.systemPrompt } : {}),
        ...(request.promptMode !== undefined ? { promptMode: request.promptMode } : {}),
        updatedAt: Date.now(),
      })
      auditRepository.write({
        category: 'operation',
        action: 'system-prompt-preset.update',
        outcome: 'success',
        details: { presetId: preset.id, promptMode: preset.promptMode },
      })
      return { preset }
    },
  )

  registerHandlerWithSchema(
    'ipc:systemPromptPreset.archive',
    systemPromptPresetArchiveSchema,
    async (request) => {
      const previous = requirePreset(request.id)
      const preset = save({ ...previous, status: 'archived', updatedAt: Date.now() })
      auditRepository.write({
        category: 'operation',
        action: 'system-prompt-preset.archive',
        outcome: 'success',
        details: { presetId: preset.id },
      })
      return { preset }
    },
  )

  registerHandlerWithSchema(
    'ipc:conversationConfig.binding.get',
    conversationConfigBindingGetSchema,
    async (request) => ({
      binding: getConversationConfigBinding(request),
    }),
  )
}
