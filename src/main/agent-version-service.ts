import { createHash, randomUUID } from 'node:crypto'
import type { AgentEvaluationSuite } from '@shared/agent-evaluation'
import type { AgentProfile } from '@shared/agent-profile'
import {
  agentVersionConfigFromProfile,
  serializeAgentVersionConfig,
  type AgentVersion,
  type AgentVersionValidation,
} from '@shared/agent-version'
import { sqliteIndex } from './sqlite-index'

export function digestAgentVersionConfig(profile: AgentProfile): string {
  const config = agentVersionConfigFromProfile(profile)
  return createHash('sha256').update(serializeAgentVersionConfig(config)).digest('hex')
}

function saveVersion(version: AgentVersion): AgentVersion {
  if (!sqliteIndex.saveAgentVersion(version)) {
    throw new Error('Agent version store is unavailable')
  }
  return version
}

/** Create one immutable version only when the normalized Agent configuration changed. */
export function ensureAgentVersion(
  profile: AgentProfile,
  createdAt = Date.now(),
): AgentVersion {
  const config = agentVersionConfigFromProfile(profile)
  const digest = createHash('sha256')
    .update(serializeAgentVersionConfig(config))
    .digest('hex')
  const latest = sqliteIndex.getLatestAgentVersion(profile.id)
  if (latest?.digest === digest) return latest
  return saveVersion({
    id: randomUUID(),
    profileId: profile.id,
    number: (latest?.number ?? 0) + 1,
    digest,
    config,
    status: 'candidate',
    createdAt,
  })
}

export function requireAgentVersion(versionId: string, profileId?: string): AgentVersion {
  const version = sqliteIndex.getAgentVersion(versionId)
  if (!version) throw new Error('Agent version not found')
  if (profileId && version.profileId !== profileId) {
    throw new Error('Agent version does not belong to the Agent configuration')
  }
  return version
}

export function profileAtAgentVersion(
  identity: Pick<AgentProfile, 'id' | 'status' | 'createdAt' | 'updatedAt'>,
  version: AgentVersion,
): AgentProfile {
  return {
    id: identity.id,
    ...version.config,
    status: identity.status,
    createdAt: identity.createdAt,
    updatedAt: identity.updatedAt,
  }
}

export function validateAgentVersion(
  version: AgentVersion,
  validation: AgentVersionValidation,
): AgentVersion {
  return saveVersion({
    ...version,
    status: version.status === 'released' ? 'released' : 'validated',
    validation,
  })
}

export function releaseAgentVersion(version: AgentVersion, releasedAt = Date.now()): AgentVersion {
  if (version.status !== 'validated' && version.status !== 'released') {
    throw new Error('Only a validated Agent version can be released')
  }
  return saveVersion({
    ...version,
    status: 'released',
    releasedAt: version.releasedAt ?? releasedAt,
  })
}

/** One-time logical migration after schema v13: preserve all existing Agents and suites. */
export function migrateAgentVersions(): void {
  const versions = new Map<string, AgentVersion>()
  for (const profile of sqliteIndex.listAgentProfiles({ includeArchived: true })) {
    versions.set(profile.id, ensureAgentVersion(profile, profile.updatedAt || Date.now()))
  }
  for (const suite of sqliteIndex.listAgentEvaluationSuites({ includeArchived: true })) {
    if (suite.versionId) continue
    const version = versions.get(suite.profileId)
    if (!version) continue
    const migrated: AgentEvaluationSuite = { ...suite, versionId: version.id }
    if (!sqliteIndex.saveAgentEvaluationSuite(migrated)) {
      throw new Error('Agent evaluation version migration failed')
    }
  }
}
