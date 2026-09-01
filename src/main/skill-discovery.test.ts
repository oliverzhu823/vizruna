import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { formatSkillsForPrompt, type Skill } from '@earendil-works/pi-coding-agent'
import { createSkillDiscoveryRuntime } from '../worker/skill-discovery'

function skill(name: string, description: string, disabled = false): Skill {
  return {
    name,
    description,
    filePath: `/skills/${name}/SKILL.md`,
    baseDir: `/skills/${name}`,
    sourceInfo: {
      path: `/skills/${name}/SKILL.md`,
      source: 'local',
      scope: 'user',
      origin: 'top-level',
    },
    disableModelInvocation: disabled,
  }
}

describe('on-demand Skill discovery', () => {
  it('keeps native commands but removes the general catalogue from the prompt', async () => {
    const runtime = createSkillDiscoveryRuntime(null, {})
    const result = runtime.resourceLoaderOptions.skillsOverride?.({
      skills: [
        skill('pdf', 'Read and create PDF documents'),
        skill('release-notes', 'Prepare product release notes'),
      ],
      diagnostics: [],
    })

    expect(runtime.mode).toBe('on-demand')
    expect(result?.skills).toHaveLength(2)
    expect(result?.skills.every((item) => item.disableModelInvocation)).toBe(true)
    expect(formatSkillsForPrompt(result?.skills || [])).toBe('')
    expect(runtime.snapshot()).toMatchObject({
      indexedCount: 2,
      promptSkillCount: 0,
      searchableCount: 2,
    })

    const tool = runtime.customTools[0]
    const response = await tool.execute(
      'call-1',
      { query: 'create pdf', limit: 3 },
      undefined,
      undefined as never,
      undefined as never,
    )
    expect(JSON.stringify(response)).toContain('pdf')
    expect(JSON.stringify(response)).not.toContain('/skills/pdf/SKILL.md')
    expect(runtime.snapshot()).toMatchObject({ searchCount: 1, loadCount: 0 })
  })

  it('does not expose explicitly disabled model-invocation skills to search', async () => {
    const runtime = createSkillDiscoveryRuntime(null, {})
    runtime.resourceLoaderOptions.skillsOverride?.({
      skills: [skill('private-release', 'Private release workflow', true)],
      diagnostics: [],
    })
    const response = await runtime.customTools[0].execute(
      'call-2',
      { query: 'release' },
      undefined,
      undefined as never,
      undefined as never,
    )
    expect((response.details as { matches: unknown[] }).matches).toEqual([])
  })

  it('keeps selected Agent skills fixed and directly visible to Pi', () => {
    const runtime = createSkillDiscoveryRuntime(
      {
        profileId: 'agent-1',
        name: 'PDF Agent',
        systemPrompt: 'Work with PDFs',
        promptMode: 'append',
        capturedAt: 1,
        resourceSnapshot: {
          mode: 'selected',
          projectContext: 'inherit',
          workspacePath: '/workspace',
          sdkVersion: '0.84.4',
          selectedPackageIds: [],
          selectedResourceIds: ['skill:pdf'],
          resources: [{
            id: 'skill:pdf',
            kind: 'skills',
            name: 'pdf',
            path: '/skills/pdf/SKILL.md',
            source: 'local',
            scope: 'user',
            origin: 'top-level',
          }],
          missingPackageIds: [],
          missingResourceIds: [],
          disabledResourceIds: [],
          capturedAt: 1,
        },
      },
      {},
    )
    const result = runtime.resourceLoaderOptions.skillsOverride?.({
      skills: [skill('pdf', 'Read PDFs')],
      diagnostics: [],
    })

    expect(runtime.mode).toBe('fixed')
    expect(runtime.customTools).toEqual([])
    expect(result?.skills[0].disableModelInvocation).toBe(false)
    expect(runtime.snapshot().promptSkillCount).toBe(1)
  })

  it('removes Skills disabled in Vizruna settings from both prompt and search', () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'vizruna-skills-'))
    writeFileSync(
      join(agentDir, 'settings.json'),
      JSON.stringify({ desktopSkillOverrides: { 'name:pdf': false } }),
    )
    const runtime = createSkillDiscoveryRuntime(null, {}, { agentDir })
    const result = runtime.resourceLoaderOptions.skillsOverride?.({
      skills: [skill('pdf', 'Read PDFs'), skill('documents', 'Read documents')],
      diagnostics: [],
    })

    expect(result?.skills.map((item) => item.name)).toEqual(['documents'])
    expect(runtime.snapshot().indexedCount).toBe(1)
  })

  it('loads the selected Skill body fresh and records invocation evidence', async () => {
    const root = mkdtempSync(join(tmpdir(), 'vizruna-skill-load-'))
    const filePath = join(root, 'SKILL.md')
    writeFileSync(filePath, '---\nname: local-test\ndescription: Local test\n---\nFirst instructions')
    const runtime = createSkillDiscoveryRuntime(null, {})
    runtime.resourceLoaderOptions.skillsOverride?.({
      skills: [{ ...skill('local-test', 'Local test'), filePath, baseDir: root }],
      diagnostics: [],
    })
    writeFileSync(filePath, '---\nname: local-test\ndescription: Local test\n---\nUpdated instructions')

    const response = await runtime.customTools[1].execute(
      'call-load',
      { name: 'local-test' },
      undefined,
      undefined as never,
      undefined as never,
    )
    expect(JSON.stringify(response)).toContain('Updated instructions')
    expect(JSON.stringify(response)).not.toContain('First instructions')
    expect(runtime.snapshot()).toMatchObject({
      loadCount: 1,
      loadedSkills: ['local-test'],
    })
  })
})
