import { describe, expect, it } from 'vitest'
import type { AgentSession } from '@earendil-works/pi-coding-agent'
import { captureRunContextSnapshot, captureRunResourceEvidence } from './pi-run-evidence'

describe('Pi run evidence', () => {
  it('captures context and only the resources exposed by the live AgentSession', () => {
    const sourceInfo = (path: string, source: string) => ({
      path,
      source,
      scope: 'project' as const,
      origin: 'top-level' as const,
    })
    const session = {
      messages: [{ role: 'user' }, { role: 'assistant' }],
      getContextUsage: () => ({ tokens: 4200, contextWindow: 128_000, percent: 3.28125 }),
      getActiveToolNames: () => ['read', 'web_search'],
      getAllTools: () => [
        { name: 'read', sourceInfo: sourceInfo('/pi/read', 'pi') },
        { name: 'web_search', sourceInfo: sourceInfo('/ext/web.ts', 'web-extension') },
        { name: 'disabled_tool', sourceInfo: sourceInfo('/ext/disabled.ts', 'disabled') },
      ],
      resourceLoader: {
        getSkills: () => ({
          skills: [{ name: 'research', filePath: '/project/.pi/skills/research/SKILL.md', sourceInfo: sourceInfo('/project/.pi/skills/research/SKILL.md', 'project') }],
        }),
        getPrompts: () => ({
          prompts: [{ name: 'brief', filePath: '/project/.pi/prompts/brief.md', sourceInfo: sourceInfo('/project/.pi/prompts/brief.md', 'project') }],
        }),
        getExtensions: () => ({
          extensions: [{ path: '/project/.pi/extensions/web.ts', resolvedPath: '/project/.pi/extensions/web.ts', sourceInfo: sourceInfo('/project/.pi/extensions/web.ts', 'project') }],
        }),
        getAgentsFiles: () => ({ agentsFiles: [{ path: '/project/AGENTS.md', content: 'Rules' }] }),
        getSystemPromptSource: () => ({ path: '/project/.pi/SYSTEM.md' }),
        getAppendSystemPromptSources: () => [{ path: '/project/.pi/APPEND.md' }],
      },
    } as unknown as AgentSession

    expect(captureRunContextSnapshot(session, 100)).toEqual({
      tokens: 4200,
      contextWindow: 128_000,
      percent: 3.28125,
      messageCount: 2,
      capturedAt: 100,
    })
    expect(captureRunResourceEvidence(session, 100)).toMatchObject({
      capturedAt: 100,
      activeTools: [{ name: 'read' }, { name: 'web_search' }],
      skills: [{ name: 'research' }],
      promptTemplates: [{ name: 'brief' }],
      extensions: [{ name: 'web.ts' }],
      contextFiles: [{ name: 'AGENTS.md' }],
      systemPromptSources: [{ name: 'SYSTEM.md' }, { name: 'APPEND.md' }],
    })
    expect(captureRunResourceEvidence(session, 100)?.activeTools.map((tool) => tool.name)).not.toContain('disabled_tool')
  })
})
