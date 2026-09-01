import { describe, expect, it } from 'vitest'
import { buildPromptManifest } from '../worker/prompt-manifest'

describe('Prompt Manifest', () => {
  it('assigns the complete prompt budget without double counting', () => {
    const text = `You are Pi.

Available tools:
- read: Read files
- skill_search: Search trusted local Skills by task intent before loading one.

Guidelines:
- Use skill_search only when specialized instructions may materially improve the task; do not search for routine work.

Pi documentation: docs

Agent instruction

<project_context>Trusted project</project_context>

The following skills provide specialized instructions
<available_skills><skill>pdf</skill></available_skills>
Current working directory: /workspace`
    const sections = buildPromptManifest({
      text,
      appendParts: ['Agent instruction'],
      activeTools: ['read', 'skill_search'],
      profile: {
        source: 'temporary',
        name: 'Conversation prompt',
        systemPrompt: 'Agent instruction',
        promptMode: 'append',
        capturedAt: 1,
      },
      skillDiscovery: {
        mode: 'on-demand',
        indexedCount: 37,
        promptSkillCount: 0,
        searchableCount: 36,
      },
    })

    expect(sections.reduce((sum, section) => sum + section.charCount, 0)).toBe(text.length)
    expect(sections.find((section) => section.id === 'agent-config')).toMatchObject({
      enabled: true,
      owner: 'agent-config',
      charCount: 'Agent instruction'.length,
    })
    expect(sections.find((section) => section.id === 'skill-router')?.charCount).toBeGreaterThan(0)
    expect(sections.find((section) => section.id === 'skill-catalog')?.charCount).toBeGreaterThan(0)
  })
})
