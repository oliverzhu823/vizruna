import { describe, expect, it } from 'vitest'
import type { AgentVersion } from './agent-version'
import { agentAssetMatchesView, summarizeAgentAssets } from './agent-asset'

function version(number: number, status: AgentVersion['status']): AgentVersion {
  return {
    id: `version-${number}`,
    profileId: 'profile-1',
    number,
    digest: `digest-${number}`,
    config: { name: 'Agent', systemPrompt: 'Prompt', promptMode: 'append' },
    status,
    createdAt: number,
  }
}

describe('Agent asset summaries', () => {
  it('keeps mature and delivered assets visible while a newer candidate is edited', () => {
    const catalog = summarizeAgentAssets(
      ['profile-1'],
      [version(3, 'candidate'), version(1, 'validated'), version(2, 'released')],
    )
    expect(catalog.assets[0]).toMatchObject({
      building: true,
      validated: true,
      delivered: true,
      latestVersion: { number: 3 },
      latestValidatedVersion: { number: 2 },
      latestReleasedVersion: { number: 2 },
      package: { status: 'unknown', versionNumber: 2 },
    })
    expect(catalog.counts).toEqual({ all: 1, building: 1, validated: 1, delivered: 1 })
    expect(agentAssetMatchesView(catalog.assets[0], 'building')).toBe(true)
    expect(agentAssetMatchesView(catalog.assets[0], 'validated')).toBe(true)
    expect(agentAssetMatchesView(catalog.assets[0], 'delivered')).toBe(true)
  })
})
