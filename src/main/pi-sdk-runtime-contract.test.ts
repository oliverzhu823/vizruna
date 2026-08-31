import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import * as sdk from '@earendil-works/pi-coding-agent'
import { inspectPiSdkCompatibility } from '@shared/pi-sdk-compat'

const temporaryDirectories: string[] = []

function createTemporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), 'vizruna-pi-sdk-contract-'))
  temporaryDirectories.push(directory)
  return directory
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('embedded Pi SDK runtime contract', () => {
  it('pins the tested 0.84.4 runtime and exposes every Vizruna capability', () => {
    const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')
    const manifest = JSON.parse(
      readFileSync(
        join(repositoryRoot, 'node_modules/@earendil-works/pi-coding-agent/package.json'),
        'utf8',
      ),
    ) as { version?: string }

    expect(manifest.version).toBe('0.84.4')
    expect(inspectPiSdkCompatibility(sdk)).toEqual({
      compatible: true,
      missingCapabilities: [],
    })
  })

  it('creates the no-network model runtime used by model and auth screens', async () => {
    const root = createTemporaryDirectory()
    const runtime = await sdk.ModelRuntime.create({
      authPath: join(root, 'auth.json'),
      modelsPath: null,
      modelsStorePath: join(root, 'models-store.json'),
      allowModelNetwork: false,
      refreshOnCreate: false,
    })

    expect(runtime.getProviders().length).toBeGreaterThan(0)
    expect(runtime.getModels().length).toBeGreaterThan(0)
    expect(await runtime.listCredentials()).toEqual([])
  })

  it('resolves a workspace through Pi package primitives', async () => {
    const root = createTemporaryDirectory()
    const cwd = join(root, 'workspace')
    const agentDir = join(root, 'agent')
    const settingsManager = sdk.SettingsManager.create(cwd, agentDir)
    const packageManager = new sdk.DefaultPackageManager({ cwd, agentDir, settingsManager })

    expect(packageManager.listConfiguredPackages()).toEqual([])
    const resolved = await packageManager.resolve()
    expect(Array.isArray(resolved.extensions)).toBe(true)
    expect(Array.isArray(resolved.skills)).toBe(true)
    expect(Array.isArray(resolved.prompts)).toBe(true)
    expect(Array.isArray(resolved.themes)).toBe(true)
    expect(resolved.skills.every((resource) => typeof resource.enabled === 'boolean')).toBe(true)
  })

  it('honors Agent Composer resource and project-context overrides in Pi itself', async () => {
    const root = createTemporaryDirectory()
    const cwd = join(root, 'workspace')
    const agentDir = join(root, 'agent')
    const keptSkill = join(agentDir, 'skills', 'kept')
    const removedSkill = join(agentDir, 'skills', 'removed')
    mkdirSync(keptSkill, { recursive: true })
    mkdirSync(removedSkill, { recursive: true })
    mkdirSync(cwd, { recursive: true })
    writeFileSync(
      join(keptSkill, 'SKILL.md'),
      '---\nname: kept\ndescription: Kept by Agent Composer\n---\nUse this skill.',
    )
    writeFileSync(
      join(removedSkill, 'SKILL.md'),
      '---\nname: removed\ndescription: Filtered by Agent Composer\n---\nDo not use this skill.',
    )
    writeFileSync(join(cwd, 'AGENTS.md'), 'Project context that must not load.')
    const modelRuntime = await sdk.ModelRuntime.create({
      authPath: join(root, 'auth.json'),
      modelsPath: null,
      modelsStorePath: join(root, 'models-store.json'),
      allowModelNetwork: false,
      refreshOnCreate: false,
    })

    const services = await sdk.createAgentSessionServices({
      cwd,
      agentDir,
      modelRuntime,
      resourceLoaderOptions: {
        noContextFiles: true,
        skillsOverride: (base) => ({
          ...base,
          skills: base.skills.filter((skill) => skill.name === 'kept'),
        }),
      },
    })

    expect(services.resourceLoader.getSkills().skills.map((skill) => skill.name)).toEqual([
      'kept',
    ])
    expect(services.resourceLoader.getAgentsFiles().agentsFiles).toEqual([])
  })
})
