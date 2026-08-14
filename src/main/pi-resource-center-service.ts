import { existsSync, readFileSync } from 'node:fs'
import { basename, dirname, extname, join, relative, resolve } from 'node:path'
import type {
  PiResourceCenterItem,
  PiResourceCenterKind,
  PiResourceCenterPackage,
  PiResourceCenterRequest,
  PiResourceCenterSnapshot,
} from '@shared/pi-resource-center'
import type { ResolvedPaths } from '@earendil-works/pi-coding-agent'
import { configStore } from './config-store'
import { workerManager } from './worker-manager'
import { readPiInfo } from './pi-info'
import { getActiveSdkModule } from './ipc/sdk-session'
import { probeExtensions, type ExtensionProbeResult } from '../extension-compat/extension-probe'

type PackageMetadata = {
  name?: string
  description?: string
  version?: string
  error?: string
}

type ConfiguredPackage = {
  source: string
  scope: 'user' | 'project'
  filtered: boolean
  installedPath?: string
}

export type PiResourceCenterFacts = {
  generatedAt: number
  workspacePath: string
  sdkVersion: string
  workerLoaded: boolean
  projectTrusted: boolean
  packages: ConfiguredPackage[]
  resolved: ResolvedPaths
  resolveError?: string
  packageMetadata: Record<string, PackageMetadata>
  extensionProbes?: ExtensionProbeResult[]
}

const EMPTY_RESOLVED: ResolvedPaths = {
  extensions: [],
  skills: [],
  prompts: [],
  themes: [],
}

function packageId(scope: 'user' | 'project', source: string): string {
  return `${scope}:${source}`
}

function packageType(source: string): PiResourceCenterPackage['type'] {
  const value = source.toLowerCase()
  if (value.startsWith('npm:')) return 'npm'
  if (
    value.startsWith('git:') ||
    value.startsWith('git@') ||
    value.startsWith('https://') ||
    value.startsWith('http://') ||
    value.startsWith('ssh://') ||
    value.startsWith('git://')
  ) return 'git'
  return 'local'
}

function isPinnedPackage(source: string, type: PiResourceCenterPackage['type']): boolean {
  if (type === 'local') return false
  const value = source.replace(/^(npm:|git:)/, '')
  const at = value.lastIndexOf('@')
  if (at < 0) return false
  if (type === 'npm') return at > value.lastIndexOf('/')
  return at > Math.max(value.lastIndexOf('/'), value.lastIndexOf(':'))
}

function fallbackPackageName(source: string): string {
  return source
    .replace(/^(npm:|git:)/, '')
    .replace(/@[^/@]+$/, '')
    .replace(/\.git$/, '')
    .split(/[\\/]/)
    .filter(Boolean)
    .at(-1) || source
}

function resourceName(kind: PiResourceCenterKind, path: string): string {
  const leaf = basename(path)
  if (kind === 'skills' && leaf.toLowerCase() === 'skill.md') return basename(dirname(path))
  return extname(leaf) ? basename(leaf, extname(leaf)) : leaf
}

function resourceRows(
  kind: PiResourceCenterKind,
  rows: ResolvedPaths[PiResourceCenterKind],
  packageIds: Map<string, string>,
  extensionProbes: ExtensionProbeResult[] = [],
): PiResourceCenterItem[] {
  return rows.map((row) => {
    const source = row.metadata.source
    const id = `${kind}:${row.metadata.scope}:${row.path}`
    const relativePath = row.metadata.baseDir
      ? relative(row.metadata.baseDir, row.path).split(/\\/g).join('/')
      : undefined
    const normalizedPath = resolve(row.path)
    const extensionProbe =
      kind === 'extensions'
        ? extensionProbes.find((probe) => {
            const candidates = [
              probe.mainFilePath,
              probe.packageRoot,
              ...(probe.packageResourcePaths ?? []),
            ].filter((path): path is string => !!path)
            return candidates.some((path) => {
              const candidate = resolve(path)
              return (
                candidate === normalizedPath ||
                normalizedPath.startsWith(`${candidate}/`) ||
                candidate.startsWith(`${normalizedPath}/`)
              )
            })
          })
        : undefined
    return {
      id,
      kind,
      name: resourceName(kind, row.path),
      path: row.path,
      source,
      scope: row.metadata.scope,
      origin: row.metadata.origin,
      enabled: row.enabled,
      packageId:
        row.metadata.origin === 'package'
          ? packageIds.get(`${row.metadata.scope}:${source}`)
          : undefined,
      relativePath,
      configurable: Boolean(relativePath && !relativePath.startsWith('../')),
      tools: extensionProbe ? [...extensionProbe.registeredTools] : undefined,
      commands: extensionProbe ? [...extensionProbe.registeredCommands] : undefined,
    }
  })
}

export function buildPiResourceCenterSnapshot(
  facts: PiResourceCenterFacts,
): PiResourceCenterSnapshot {
  const packageIds = new Map(
    facts.packages.map((pkg) => [
      `${pkg.scope}:${pkg.source}`,
      packageId(pkg.scope, pkg.source),
    ]),
  )
  const resources: PiResourceCenterSnapshot['resources'] = {
    extensions: resourceRows(
      'extensions',
      facts.resolved.extensions,
      packageIds,
      facts.extensionProbes,
    ),
    skills: resourceRows('skills', facts.resolved.skills, packageIds),
    prompts: resourceRows('prompts', facts.resolved.prompts, packageIds),
    themes: resourceRows('themes', facts.resolved.themes, packageIds),
  }
  const countsByPackage = new Map<
    string,
    Record<PiResourceCenterKind, number>
  >()
  for (const kind of Object.keys(resources) as PiResourceCenterKind[]) {
    for (const resource of resources[kind]) {
      if (!resource.packageId) continue
      const counts = countsByPackage.get(resource.packageId) || {
        extensions: 0,
        skills: 0,
        prompts: 0,
        themes: 0,
      }
      counts[kind] += 1
      countsByPackage.set(resource.packageId, counts)
    }
  }
  const packages = facts.packages.map<PiResourceCenterPackage>((pkg) => {
    const id = packageId(pkg.scope, pkg.source)
    const metadata = facts.packageMetadata[id] || {}
    const type = packageType(pkg.source)
    return {
      id,
      source: pkg.source,
      name: metadata.name || fallbackPackageName(pkg.source),
      description: metadata.description,
      version: metadata.version,
      scope: pkg.scope,
      type,
      pinned: isPinnedPackage(pkg.source, type),
      filtered: pkg.filtered,
      installed: !!pkg.installedPath && existsSync(pkg.installedPath),
      installedPath: pkg.installedPath,
      resources: countsByPackage.get(id) || {
        extensions: 0,
        skills: 0,
        prompts: 0,
        themes: 0,
      },
    }
  })
  const allResources = Object.values(resources).flat()
  const warnings: PiResourceCenterSnapshot['warnings'] = []
  if (!facts.projectTrusted) {
    warnings.push({
      code: 'project-untrusted',
      message: 'Project-local Pi settings, packages, and executable resources are not loaded.',
    })
  }
  for (const pkg of packages) {
    if (!pkg.installed) {
      warnings.push({
        code: 'package-missing',
        message: `${pkg.source} is configured but is not installed locally.`,
        packageId: pkg.id,
      })
    }
    const metadataError = facts.packageMetadata[pkg.id]?.error
    if (metadataError) {
      warnings.push({ code: 'package-read-error', message: metadataError, packageId: pkg.id })
    }
  }
  if (facts.resolveError) {
    warnings.push({ code: 'resolve-error', message: facts.resolveError })
  }
  return {
    generatedAt: facts.generatedAt,
    workspacePath: facts.workspacePath,
    runtime: {
      sdkVersion: facts.sdkVersion,
      workerLoaded: facts.workerLoaded,
      projectTrusted: facts.projectTrusted,
    },
    summary: {
      packages: packages.length,
      installedPackages: packages.filter((pkg) => pkg.installed).length,
      extensions: resources.extensions.length,
      skills: resources.skills.length,
      prompts: resources.prompts.length,
      themes: resources.themes.length,
      enabledResources: allResources.filter((resource) => resource.enabled).length,
      projectResources: allResources.filter((resource) => resource.scope === 'project').length,
    },
    packages,
    resources,
    warnings,
  }
}

function readPackageMetadata(pkg: ConfiguredPackage): PackageMetadata {
  if (!pkg.installedPath) return {}
  const packageJson = join(pkg.installedPath, 'package.json')
  if (!existsSync(packageJson)) return {}
  try {
    const raw = JSON.parse(readFileSync(packageJson, 'utf8')) as Record<string, unknown>
    return {
      name: typeof raw.name === 'string' ? raw.name : undefined,
      description: typeof raw.description === 'string' ? raw.description : undefined,
      version: typeof raw.version === 'string' ? raw.version : undefined,
    }
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) }
  }
}

export function activePiResourceWorkspace(request: PiResourceCenterRequest): string {
  const current = workerManager.cwd || configStore.get('currentProject') || ''
  const requested = request.workspaceId?.trim() || ''
  if (!current) return resolve(requested || process.cwd())
  if (!requested || resolve(requested) === resolve(current)) return resolve(current)
  return resolve(current)
}

export async function collectPiResourceCenterSnapshot(
  request: PiResourceCenterRequest,
): Promise<PiResourceCenterSnapshot> {
  const workspacePath = activePiResourceWorkspace(request)
  const sdk = await getActiveSdkModule()
  const agentDir = sdk.getAgentDir()
  const settingsManager = sdk.SettingsManager.create(workspacePath, agentDir)
  const manager = new sdk.DefaultPackageManager({ cwd: workspacePath, agentDir, settingsManager })
  const packages = manager.listConfiguredPackages()
  let resolved = EMPTY_RESOLVED
  let resolveError: string | undefined
  try {
    resolved = await manager.resolve(async () => 'skip')
  } catch (error) {
    resolveError = error instanceof Error ? error.message : String(error)
  }
  const packageMetadata = Object.fromEntries(
    packages.map((pkg) => [packageId(pkg.scope, pkg.source), readPackageMetadata(pkg)]),
  )
  return buildPiResourceCenterSnapshot({
    generatedAt: Date.now(),
    workspacePath,
    sdkVersion: readPiInfo().sdkVersion,
    workerLoaded: workerManager.isRunning && resolve(workerManager.cwd || '') === workspacePath,
    projectTrusted: settingsManager.isProjectTrusted(),
    packages,
    resolved,
    resolveError,
    packageMetadata,
    extensionProbes: probeExtensions(workspacePath),
  })
}
