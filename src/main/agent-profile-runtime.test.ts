import { describe, expect, it } from 'vitest'
import type { AgentProfileSnapshot } from '@shared/agent-profile'
import type { SystemPromptSnapshot } from '@shared/system-prompt-preset'
import {
  buildAgentPromptLoaderOverrides,
  buildAgentResourceLoaderOverrides,
  buildAgentToolsOverride,
} from '../worker/agent-profile-runtime'

function profile(
  overrides: Partial<AgentProfileSnapshot> = {},
): AgentProfileSnapshot {
  return {
    profileId: 'b0d3a941-2048-4c9d-a7ea-a6d3a82dc012',
    name: 'Research Agent',
    systemPrompt: 'Return a cited research report.',
    promptMode: 'append',
    capturedAt: 100,
    ...overrides,
  }
}

describe('Agent profile Pi runtime options', () => {
  it('leaves General Pi prompt and tools untouched', () => {
    expect(buildAgentPromptLoaderOverrides(null)).toEqual({})
    expect(buildAgentToolsOverride(null)).toEqual({})
  })

  it('appends scenario instructions without mutating Pi base prompts', () => {
    const overrides = buildAgentPromptLoaderOverrides(profile())
    const base = ['Pi default', 'Project SYSTEM.md']

    expect(overrides.appendSystemPromptOverride?.(base)).toEqual([
      ...base,
      'Return a cited research report.',
    ])
    expect(base).toEqual(['Pi default', 'Project SYSTEM.md'])
    expect(overrides.systemPromptOverride).toBeUndefined()
  })

  it('replaces the Pi prompt only in explicit replace mode', () => {
    const overrides = buildAgentPromptLoaderOverrides(
      profile({ promptMode: 'replace', systemPrompt: 'You are a closed-domain reviewer.' }),
    )

    expect(overrides.systemPromptOverride?.()).toBe('You are a closed-domain reviewer.')
    expect(overrides.appendSystemPromptOverride).toBeUndefined()
  })

  it('distinguishes inherited tools from an intentionally tool-less Agent', () => {
    expect(buildAgentToolsOverride(profile())).toEqual({})
    expect(buildAgentToolsOverride(profile({ tools: [] }))).toEqual({ tools: [] })
    expect(buildAgentToolsOverride(profile({ tools: ['read', 'grep'] }))).toEqual({
      tools: ['read', 'grep'],
    })
  })

  it('allows tools registered by explicitly selected Extensions', () => {
    expect(
      buildAgentToolsOverride(
        profile({
          tools: ['read'],
          resourceSnapshot: {
            workspacePath: '/workspace',
            sdkVersion: '0.84.1',
            mode: 'selected',
            projectContext: 'inherit',
            selectedPackageIds: [],
            selectedResourceIds: ['extensions:user:/extensions/search.ts'],
            resources: [],
            missingPackageIds: [],
            missingResourceIds: [],
            disabledResourceIds: [],
            capturedAt: 100,
          },
        }),
        ['web_search', 'web_search'],
      ),
    ).toEqual({ tools: ['read', 'web_search'] })
  })

  it('restricts selected Extension tools to the Agent allowlist', () => {
    expect(
      buildAgentToolsOverride(
        profile({
          tools: ['read'],
          extensionTools: ['web_search'],
          resourceSnapshot: {
            workspacePath: '/workspace',
            sdkVersion: '0.84.1',
            mode: 'selected',
            projectContext: 'inherit',
            selectedPackageIds: [],
            selectedResourceIds: ['extensions:user:/extensions/search.ts'],
            resources: [],
            missingPackageIds: [],
            missingResourceIds: [],
            disabledResourceIds: [],
            capturedAt: 100,
          },
        }),
        ['web_search', 'web_fetch'],
      ),
    ).toEqual({ tools: ['read', 'web_search'] })
  })

  it('applies a standalone conversation prompt without overriding Agent tools', () => {
    const prompt: SystemPromptSnapshot = {
      source: 'temporary',
      name: 'Draft Agent Prompt',
      systemPrompt: 'Help design an Agent from scratch.',
      promptMode: 'append',
      capturedAt: 100,
    }

    expect(
      buildAgentPromptLoaderOverrides(prompt).appendSystemPromptOverride?.(['Pi default']),
    ).toEqual(['Pi default', 'Help design an Agent from scratch.'])
    expect(buildAgentToolsOverride(prompt)).toEqual({})
  })

  it('filters Pi resources and project context from the immutable session snapshot', () => {
    const overrides = buildAgentResourceLoaderOverrides(
      profile({
        resourceSnapshot: {
          workspacePath: '/workspace',
          sdkVersion: '0.84.1',
          mode: 'selected',
          projectContext: 'none',
          selectedPackageIds: ['user:npm:research-kit'],
          selectedResourceIds: [],
          resources: [
            {
              id: 'skills:user:/pkg/citations/SKILL.md',
              kind: 'skills',
              name: 'citations',
              path: '/pkg/citations/SKILL.md',
              source: 'npm:research-kit',
              scope: 'user',
              origin: 'package',
              packageId: 'user:npm:research-kit',
            },
            {
              id: 'prompts:user:/pkg/report.md',
              kind: 'prompts',
              name: 'report',
              path: '/pkg/report.md',
              source: 'npm:research-kit',
              scope: 'user',
              origin: 'package',
              packageId: 'user:npm:research-kit',
            },
          ],
          missingPackageIds: [],
          missingResourceIds: [],
          disabledResourceIds: [],
          capturedAt: 100,
        },
      }),
    )

    expect(overrides.noContextFiles).toBe(true)
    expect(
      overrides.skillsOverride?.({
        diagnostics: [],
        skills: [
          {
            name: 'citations',
            description: '',
            filePath: '/pkg/citations/SKILL.md',
            baseDir: '/pkg/citations',
            sourceInfo: {
              path: '/pkg/citations/SKILL.md',
              source: 'npm:research-kit',
              scope: 'user',
              origin: 'package',
            },
            disableModelInvocation: false,
          },
          {
            name: 'other',
            description: '',
            filePath: '/skills/other/SKILL.md',
            baseDir: '/skills/other',
            sourceInfo: {
              path: '/skills/other/SKILL.md',
              source: 'user',
              scope: 'user',
              origin: 'top-level',
            },
            disableModelInvocation: false,
          },
        ],
      }).skills.map((skill) => skill.name),
    ).toEqual(['citations'])
    expect(
      overrides.promptsOverride?.({
        diagnostics: [],
        prompts: [
          {
            name: 'report',
            description: '',
            content: '',
            filePath: '/pkg/report.md',
            sourceInfo: {
              path: '/pkg/report.md',
              source: 'npm:research-kit',
              scope: 'user',
              origin: 'package',
            },
          },
          {
            name: 'other',
            description: '',
            content: '',
            filePath: '/prompts/other.md',
            sourceInfo: {
              path: '/prompts/other.md',
              source: 'user',
              scope: 'user',
              origin: 'top-level',
            },
          },
        ],
      }).prompts.map((prompt) => prompt.name),
    ).toEqual(['report'])
  })

  it('keeps all Pi resources in inherit mode while still honoring context policy', () => {
    const overrides = buildAgentResourceLoaderOverrides(
      profile({
        resourceSnapshot: {
          workspacePath: '/workspace',
          sdkVersion: '0.84.1',
          mode: 'inherit',
          projectContext: 'inherit',
          selectedPackageIds: [],
          selectedResourceIds: [],
          resources: [],
          missingPackageIds: [],
          missingResourceIds: [],
          disabledResourceIds: [],
          capturedAt: 100,
        },
      }),
    )

    expect(overrides).toEqual({})
  })
})
