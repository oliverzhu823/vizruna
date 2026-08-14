import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  AgentCase,
  AgentCasePackageProvenance,
  AgentCaseProvenance,
  AgentCaseVerification,
  AgentCaseVerificationCheck,
} from '@shared/agent-case'
import type { AgentProfileSnapshot } from '@shared/agent-profile'
import type { PiResourceCenterPackage, PiResourceCenterSnapshot } from '@shared/pi-resource-center'
import { readPiInfo } from './pi-info'
import { collectPiResourceCenterSnapshot } from './pi-resource-center-service'
import { sqliteIndex } from './sqlite-index'

function digestSnapshot(snapshot: AgentProfileSnapshot): string {
  return snapshot.versionDigest || createHash('sha256').update(JSON.stringify(snapshot)).digest('hex')
}

function dependencyPackageIds(snapshot: AgentProfileSnapshot): Set<string> {
  const resourceSnapshot = snapshot.resourceSnapshot
  if (!resourceSnapshot) return new Set()
  return new Set([
    ...resourceSnapshot.selectedPackageIds,
    ...resourceSnapshot.resources.flatMap((resource) =>
      resource.packageId ? [resource.packageId] : [],
    ),
  ])
}

function packageProvenance(
  pkg: PiResourceCenterPackage,
  role: AgentCasePackageProvenance['role'],
): AgentCasePackageProvenance {
  return {
    id: pkg.id,
    source: pkg.source,
    name: pkg.name,
    version: pkg.version,
    scope: pkg.scope,
    role,
  }
}

function installedMetadataRoot(pkg: PiResourceCenterPackage): string | null {
  const candidate = pkg.installedPath || (pkg.type === 'local' ? pkg.source : '')
  if (!candidate) return null
  return resolve(candidate)
}

function generatedAgentProfileId(pkg: PiResourceCenterPackage): string | null {
  const root = installedMetadataRoot(pkg)
  if (!root) return null
  const path = join(root, 'vizruna-agent.json')
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as { profile?: { id?: unknown } }
    return typeof value.profile?.id === 'string' ? value.profile.id : null
  } catch {
    return null
  }
}

export async function captureAgentCaseProvenance(input: {
  workspacePath: string
  sourceSessionFile: string
  capturedAt?: number
}): Promise<AgentCaseProvenance> {
  const capturedAt = input.capturedAt ?? Date.now()
  const binding = sqliteIndex.getSessionAgentBinding({ sessionFile: input.sourceSessionFile })
  const catalog = await collectPiResourceCenterSnapshot({ workspaceId: input.workspacePath })
  const dependencyIds = binding ? dependencyPackageIds(binding.snapshot) : new Set<string>()
  const packages = catalog.packages
    .filter((pkg) => dependencyIds.has(pkg.id))
    .map((pkg) => packageProvenance(pkg, 'resource-dependency'))
  if (binding) {
    for (const pkg of catalog.packages) {
      if (generatedAgentProfileId(pkg) !== binding.profileId) continue
      if (!packages.some((item) => item.id === pkg.id)) {
        packages.push(packageProvenance(pkg, 'agent-package'))
      }
    }
  }
  const profile = binding ? sqliteIndex.getAgentProfile(binding.profileId) : null
  return {
    capturedAt,
    piRuntimeVersion: readPiInfo().sdkVersion,
    agent: binding
      ? {
          profileId: binding.profileId,
          name: binding.snapshot.name,
          versionId: binding.snapshot.versionId,
          versionNumber: binding.snapshot.versionNumber,
          profileUpdatedAt: profile?.updatedAt,
          snapshotCapturedAt: binding.snapshot.capturedAt,
          snapshotDigest: digestSnapshot(binding.snapshot),
        }
      : undefined,
    packages,
  }
}

function check(
  code: AgentCaseVerificationCheck['code'],
  status: AgentCaseVerificationCheck['status'],
  options: Omit<AgentCaseVerificationCheck, 'code' | 'status'> = {},
): AgentCaseVerificationCheck {
  return { code, status, ...options }
}

function currentPackage(
  expected: AgentCasePackageProvenance,
  catalog: PiResourceCenterSnapshot,
): PiResourceCenterPackage | undefined {
  return catalog.packages.find((pkg) => pkg.id === expected.id) ??
    catalog.packages.find((pkg) => pkg.source === expected.source)
}

export async function verifyAgentCaseProvenance(
  agentCase: AgentCase,
  checkedAt = Date.now(),
): Promise<AgentCaseVerification> {
  const checks: AgentCaseVerificationCheck[] = []
  const provenance = agentCase.provenance
  if (!provenance) {
    checks.push(check('provenance-present', 'failed'))
    return { checkedAt, reproducible: false, checks }
  }
  checks.push(check('provenance-present', 'passed'))
  checks.push(check(
    'source-session-present',
    existsSync(agentCase.sourceSessionFile) ? 'passed' : 'failed',
    { expected: agentCase.sourceSessionFile, actual: existsSync(agentCase.sourceSessionFile) ? agentCase.sourceSessionFile : undefined },
  ))
  const currentRuntime = readPiInfo().sdkVersion
  checks.push(check(
    'pi-runtime-version',
    currentRuntime === provenance.piRuntimeVersion ? 'passed' : 'failed',
    { expected: provenance.piRuntimeVersion, actual: currentRuntime },
  ))
  if (!provenance.agent) {
    checks.push(check('agent-bound', 'warning'))
  } else {
    checks.push(check('agent-bound', 'passed', { label: provenance.agent.name }))
    const profile = sqliteIndex.getAgentProfile(provenance.agent.profileId)
    const version = provenance.agent.versionId
      ? sqliteIndex.getAgentVersion(provenance.agent.versionId)
      : null
    const versionMatches = provenance.agent.versionId
      ? !!version &&
        version.profileId === provenance.agent.profileId &&
        version.digest === provenance.agent.snapshotDigest
      : !!profile && (
          provenance.agent.profileUpdatedAt == null ||
          profile.updatedAt === provenance.agent.profileUpdatedAt
        )
    checks.push(check(
      'agent-profile-version',
      versionMatches ? 'passed' : 'failed',
      {
        label: provenance.agent.name,
        expected: provenance.agent.versionId || provenance.agent.profileUpdatedAt?.toString(),
        actual: version?.id || profile?.updatedAt.toString(),
      },
    ))
  }
  const catalog = await collectPiResourceCenterSnapshot({ workspaceId: agentCase.workspacePath })
  for (const expected of provenance.packages) {
    const actual = currentPackage(expected, catalog)
    checks.push(check(
      'package-installed',
      actual?.installed ? 'passed' : 'failed',
      { label: expected.name, expected: expected.source, actual: actual?.source },
    ))
    if (expected.version) {
      checks.push(check(
        'package-version',
        actual?.version === expected.version ? 'passed' : 'failed',
        { label: expected.name, expected: expected.version, actual: actual?.version },
      ))
    }
  }
  return {
    checkedAt,
    reproducible: checks.every((item) => item.status !== 'failed'),
    checks,
  }
}

export const agentCaseProvenanceTestApi = {
  digestSnapshot,
  generatedAgentProfileId,
}
