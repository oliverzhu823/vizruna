import type { AgentVersion } from './agent-version'

export type AgentAssetView = 'all' | 'building' | 'validated' | 'delivered'
export type AgentPackageEvidenceStatus = 'not-exported' | 'unknown' | 'available' | 'missing' | 'invalid'

export interface AgentPackageEvidence {
  status: AgentPackageEvidenceStatus
  versionId?: string
  versionNumber?: number
  packagePath?: string
  releasedAt?: number
}

/** Evidence-derived lifecycle summary. Views intentionally overlap. */
export interface AgentAssetSummary {
  profileId: string
  latestVersion?: AgentVersion
  latestValidatedVersion?: AgentVersion
  latestReleasedVersion?: AgentVersion
  building: boolean
  validated: boolean
  delivered: boolean
  package: AgentPackageEvidence
}

export interface AgentAssetCatalog {
  assets: AgentAssetSummary[]
  counts: Record<AgentAssetView, number>
}

export interface AgentAssetListRequest {
  workspacePath?: string
}

export interface AgentAssetListResponse {
  catalog: AgentAssetCatalog
}

export function summarizeAgentAssets(
  profileIds: string[],
  versions: AgentVersion[],
): AgentAssetCatalog {
  const assets = profileIds.map((profileId): AgentAssetSummary => {
    const profileVersions = versions
      .filter((version) => version.profileId === profileId)
      .sort((left, right) => right.number - left.number)
    const latestVersion = profileVersions[0]
    const latestValidatedVersion = profileVersions.find(
      (version) => version.status === 'validated' || version.status === 'released',
    )
    const latestReleasedVersion = profileVersions.find((version) => version.status === 'released')
    return {
      profileId,
      latestVersion,
      latestValidatedVersion,
      latestReleasedVersion,
      building: latestVersion?.status === 'candidate',
      validated: Boolean(latestValidatedVersion),
      delivered: Boolean(latestReleasedVersion),
      package: latestReleasedVersion
        ? {
            status: 'unknown',
            versionId: latestReleasedVersion.id,
            versionNumber: latestReleasedVersion.number,
            releasedAt: latestReleasedVersion.releasedAt,
          }
        : { status: 'not-exported' },
    }
  })
  return {
    assets,
    counts: {
      all: assets.length,
      building: assets.filter((asset) => asset.building).length,
      validated: assets.filter((asset) => asset.validated).length,
      delivered: assets.filter((asset) => asset.delivered).length,
    },
  }
}

export function agentAssetMatchesView(asset: AgentAssetSummary, view: AgentAssetView): boolean {
  if (view === 'all') return true
  return asset[view]
}
