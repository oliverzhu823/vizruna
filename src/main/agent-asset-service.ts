import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type { AgentAssetCatalog, AgentPackageEvidence } from '@shared/agent-asset'
import { summarizeAgentAssets } from '@shared/agent-asset'
import { PI_PACKAGE_STUDIO_FILES, piPackageSlug } from '@shared/pi-package-studio'
import type { AgentProfile } from '@shared/agent-profile'
import type { AgentVersion } from '@shared/agent-version'
import { sqliteIndex } from './sqlite-index'
import { getTrustedWorkspaceRoot } from './trusted-workspace'

function assertTrustedWorkspace(workspacePath: string): string {
  const workspace = resolve(workspacePath)
  const trusted = getTrustedWorkspaceRoot()
  if (!trusted || resolve(trusted) !== workspace) {
    throw new Error('Agent delivery assets can only be inspected in the active trusted workspace')
  }
  return workspace
}

function packageEvidence(
  profile: AgentProfile,
  version: AgentVersion,
  workspacePath?: string,
): AgentPackageEvidence {
  const base = {
    versionId: version.id,
    versionNumber: version.number,
    releasedAt: version.releasedAt,
  }
  if (!workspacePath) return { status: 'unknown', ...base }
  const workspace = assertTrustedWorkspace(workspacePath)
  const packageRoot = resolve(workspace, '.vizruna', 'pi-packages')
  // Package paths are derived from the immutable version name, not the mutable profile name.
  const slug = piPackageSlug(version.config.name, profile.id)
  const directoryName = `${slug}-${profile.id.replace(/-/g, '').slice(0, 8)}-v${version.number}`
  const packagePath = resolve(packageRoot, directoryName)
  if (!packagePath.startsWith(`${packageRoot}/`)) {
    throw new Error('Invalid managed Agent package path')
  }
  if (!existsSync(packagePath)) return { status: 'missing', ...base, packagePath }
  try {
    for (const relativePath of PI_PACKAGE_STUDIO_FILES) {
      if (!existsSync(join(packagePath, relativePath))) {
        return { status: 'invalid', ...base, packagePath }
      }
    }
    const metadata = JSON.parse(readFileSync(join(packagePath, 'vizruna-agent.json'), 'utf8')) as {
      profile?: { id?: string }
      version?: { id?: string; number?: number; digest?: string }
    }
    if (
      metadata.profile?.id !== profile.id ||
      metadata.version?.id !== version.id ||
      metadata.version?.number !== version.number ||
      metadata.version?.digest !== version.digest
    ) {
      return { status: 'invalid', ...base, packagePath }
    }
    return { status: 'available', ...base, packagePath }
  } catch {
    return { status: 'invalid', ...base, packagePath }
  }
}

export function buildAgentAssetCatalog(workspacePath?: string): AgentAssetCatalog {
  const profiles = sqliteIndex.listAgentProfiles()
  const versions = sqliteIndex.listAgentVersions()
  const catalog = summarizeAgentAssets(profiles.map((profile) => profile.id), versions)
  const profileMap = new Map(profiles.map((profile) => [profile.id, profile]))
  return {
    ...catalog,
    assets: catalog.assets.map((asset) => {
      const profile = profileMap.get(asset.profileId)
      if (!profile || !asset.latestReleasedVersion) return asset
      return {
        ...asset,
        package: packageEvidence(profile, asset.latestReleasedVersion, workspacePath),
      }
    }),
  }
}

export const agentAssetServiceTestApi = { packageEvidence }
