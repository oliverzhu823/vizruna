import { Type } from '@earendil-works/pi-ai'
import type { ToolDefinition } from '@earendil-works/pi-coding-agent'
import type { OrchestrationWorkerRequest } from '@shared/orchestration'
import { requestOrchestration } from './orchestration-rpc.js'

function toolResult(result: unknown) {
  return {
    content: [
      {
        type: 'text' as const,
        text: JSON.stringify(result, null, 2),
      },
    ],
    details: result,
  }
}

async function executeRequest(
  request: OrchestrationWorkerRequest,
  signal?: AbortSignal,
) {
  return toolResult(await requestOrchestration(request, signal))
}

export function createOrchestrationTools(): ToolDefinition[] {
  return [
    {
      name: 'create_child_agent',
      label: 'Create child agent',
      description:
        'Create an independent child agent with an explicit goal. It normally receives an isolated managed Git worktree and may queue when the worker limit is reached.',
      promptSnippet: 'Create an independent child agent for a bounded subtask.',
      promptGuidelines: [
        'Give every child a concrete, bounded goal and inspect its evidence before relying on its result.',
        'Use local mode only when isolation is unnecessary or the workspace is not a Git repository.',
      ],
      executionMode: 'sequential',
      parameters: Type.Object({
        goal: Type.String({ minLength: 1, maxLength: 20_000 }),
        name: Type.Optional(Type.String({ maxLength: 120 })),
        environment: Type.Optional(
          Type.Union([Type.Literal('worktree'), Type.Literal('local')]),
        ),
        timeoutMs: Type.Optional(
          Type.Number({ minimum: 1_000, maximum: 86_400_000 }),
        ),
      }),
      execute: async (_toolCallId, params, signal) => {
        const value = params as {
          goal: string
          name?: string
          environment?: 'worktree' | 'local'
          timeoutMs?: number
        }
        return executeRequest({ method: 'createChild', ...value }, signal)
      },
    },
    {
      name: 'list_child_agents',
      label: 'List child agents',
      description:
        'List direct child agents, including queued/running/terminal status, environment, verification status, and latest summary.',
      promptSnippet: 'List direct child-agent status.',
      executionMode: 'parallel',
      parameters: Type.Object({}),
      execute: async (_toolCallId, _params, signal) =>
        executeRequest({ method: 'listChildren' }, signal),
    },
    {
      name: 'read_child_agent',
      label: 'Read child agent',
      description:
        'Inspect one child agent and its system-captured evidence. Reported success without passing verification remains unverified.',
      promptSnippet: 'Inspect a child agent and its evidence.',
      executionMode: 'parallel',
      parameters: Type.Object({
        relationshipId: Type.String({ format: 'uuid' }),
        includeEvidence: Type.Optional(Type.Boolean()),
      }),
      execute: async (_toolCallId, params, signal) => {
        const value = params as {
          relationshipId: string
          includeEvidence?: boolean
        }
        return executeRequest({ method: 'readChild', ...value }, signal)
      },
    },
    {
      name: 'send_message_to_child_agent',
      label: 'Message child agent',
      description:
        'Send steering text to a running child, or a follow-up prompt to an idle/terminal child session.',
      promptSnippet: 'Send a message to a child agent.',
      executionMode: 'sequential',
      parameters: Type.Object({
        relationshipId: Type.String({ format: 'uuid' }),
        text: Type.String({ minLength: 1, maxLength: 20_000 }),
      }),
      execute: async (_toolCallId, params, signal) => {
        const value = params as { relationshipId: string; text: string }
        return executeRequest({ method: 'sendMessage', ...value }, signal)
      },
    },
    {
      name: 'stop_child_agent',
      label: 'Stop child agent',
      description:
        'Cancel a child agent. Its session and managed worktree are retained for inspection and recovery.',
      promptSnippet: 'Stop a child agent without deleting its work.',
      executionMode: 'sequential',
      parameters: Type.Object({
        relationshipId: Type.String({ format: 'uuid' }),
      }),
      execute: async (_toolCallId, params, signal) => {
        const value = params as { relationshipId: string }
        return executeRequest({ method: 'stopChild', ...value }, signal)
      },
    },
    {
      name: 'wait_for_child_agents',
      label: 'Wait for child agents',
      description:
        'Wait for selected child agents (or all direct children) to reach terminal or attention-needed states. The wait is bounded to 60 seconds.',
      promptSnippet: 'Wait briefly for child-agent status changes.',
      executionMode: 'parallel',
      parameters: Type.Object({
        relationshipIds: Type.Optional(
          Type.Array(Type.String({ format: 'uuid' }), { maxItems: 32 }),
        ),
        timeoutMs: Type.Optional(
          Type.Number({ minimum: 0, maximum: 60_000 }),
        ),
      }),
      execute: async (_toolCallId, params, signal) => {
        const value = params as {
          relationshipIds?: string[]
          timeoutMs?: number
        }
        return executeRequest({ method: 'waitChildren', ...value }, signal)
      },
    },
  ]
}
