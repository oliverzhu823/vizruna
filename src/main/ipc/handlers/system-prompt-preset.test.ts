import { beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  ConversationConfigBinding,
  SystemPromptPreset,
} from '@shared/system-prompt-preset'

const mocks = vi.hoisted(() => {
  const handlers = new Map<string, (request: Record<string, unknown>) => Promise<unknown>>()
  return {
    handlers,
    sqliteIndex: {
      listSystemPromptPresets: vi.fn(() => []),
      getSystemPromptPreset: vi.fn(),
      saveSystemPromptPreset: vi.fn(() => true),
    },
    getConversationConfigBinding: vi.fn(),
    auditWrite: vi.fn(),
  }
})

vi.mock('../registry', () => ({
  registerHandlerWithSchema: (
    channel: string,
    schema: { parse: (request: unknown) => Record<string, unknown> },
    handler: (request: Record<string, unknown>) => Promise<unknown>,
  ) => {
    mocks.handlers.set(channel, (request) => handler(schema.parse(request)))
  },
}))
vi.mock('../../sqlite-index', () => ({ sqliteIndex: mocks.sqliteIndex }))
vi.mock('../../system-prompt-preset-service', () => ({
  getConversationConfigBinding: mocks.getConversationConfigBinding,
}))
vi.mock('../../audit/audit-repository', () => ({
  auditRepository: { write: mocks.auditWrite },
}))

import { registerSystemPromptPresetHandlers } from './system-prompt-preset'

const presetId = '86d06e79-2c03-4dfd-8e97-3f1500f548d9'
const existingPreset: SystemPromptPreset = {
  id: presetId,
  name: 'Market Analyst',
  description: 'Evidence-first market analysis',
  systemPrompt: 'Use evidence and state uncertainty.',
  promptMode: 'append',
  status: 'active',
  createdAt: 100,
  updatedAt: 100,
}

describe('System Prompt Preset IPC handlers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.handlers.clear()
    mocks.sqliteIndex.getSystemPromptPreset.mockReturnValue(existingPreset)
    mocks.sqliteIndex.saveSystemPromptPreset.mockReturnValue(true)
    registerSystemPromptPresetHandlers()
  })

  it('creates a trimmed reusable system prompt preset', async () => {
    const response = (await mocks.handlers.get('ipc:systemPromptPreset.create')!({
      name: ' Market Analyst ',
      description: ' Evidence first ',
      systemPrompt: ' Analyze rigorously. ',
      promptMode: 'append',
    })) as { preset: SystemPromptPreset }

    expect(response.preset).toMatchObject({
      name: 'Market Analyst',
      description: 'Evidence first',
      systemPrompt: 'Analyze rigorously.',
      promptMode: 'append',
      status: 'active',
    })
    expect(response.preset.id).toMatch(/^[0-9a-f-]{36}$/)
    expect(mocks.sqliteIndex.saveSystemPromptPreset).toHaveBeenCalledWith(response.preset)
  })

  it('updates a preset without changing fields that were not submitted', async () => {
    const response = (await mocks.handlers.get('ipc:systemPromptPreset.update')!({
      id: presetId,
      name: 'Updated Analyst',
    })) as { preset: SystemPromptPreset }

    expect(response.preset).toMatchObject({
      name: 'Updated Analyst',
      systemPrompt: existingPreset.systemPrompt,
      promptMode: existingPreset.promptMode,
    })
  })

  it('archives a preset without deleting it', async () => {
    const response = (await mocks.handlers.get('ipc:systemPromptPreset.archive')!({
      id: presetId,
    })) as { preset: SystemPromptPreset }

    expect(response.preset.status).toBe('archived')
    expect(mocks.auditWrite).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'system-prompt-preset.archive', outcome: 'success' }),
    )
  })

  it('returns either kind of immutable conversation binding', async () => {
    const binding: ConversationConfigBinding = {
      kind: 'prompt',
      sessionId: 'session-1',
      sessionFile: '/sessions/session-1.jsonl',
      snapshot: {
        source: 'preset',
        presetId,
        name: existingPreset.name,
        systemPrompt: existingPreset.systemPrompt,
        promptMode: existingPreset.promptMode,
        capturedAt: 120,
      },
      createdAt: 120,
    }
    mocks.getConversationConfigBinding.mockReturnValue(binding)

    await expect(
      mocks.handlers.get('ipc:conversationConfig.binding.get')!({
        sessionFile: '/sessions/session-1.jsonl',
      }),
    ).resolves.toEqual({ binding })
  })
})
