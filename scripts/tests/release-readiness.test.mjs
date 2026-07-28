import test from 'node:test'
import assert from 'node:assert/strict'
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  chooseRepository,
  evaluateReleaseReadiness,
  normalizeRepository,
  REQUIRED_CANDIDATE_SECRETS,
  REQUIRED_RELEASE_VARIABLES,
} from '../lib/release-readiness.mjs'

const commit = 'a'.repeat(40)
const dmgSha256 = 'b'.repeat(64)
const zipSha256 = 'c'.repeat(64)
const candidateRunId = '123456789'

function validSnapshot() {
  return {
    local: {
      commit,
      clean: true,
      version: '0.1.0',
      changelogReady: true,
      workflowsTracked: true,
      remotes: [
        {
          name: 'origin',
          fetchUrl: 'https://github.com/acme/pi-enterprise-desktop.git',
          pushUrl: 'git@github.com:acme/pi-enterprise-desktop.git',
        },
      ],
    },
    evidence: {
      exists: true,
      result: 'go',
      binding: {
        candidateRunId,
        dmgSha256,
        zipSha256,
      },
    },
    github: {
      repository: 'acme/pi-enterprise-desktop',
      authenticated: true,
      login: 'release-owner',
      repositoryExists: true,
      archived: false,
      canPush: true,
      commitExists: true,
      workflowsAtCommit: true,
    },
    candidateEnvironment: {
      exists: true,
      requiredReviewerCount: 1,
      preventSelfReview: true,
      branchRestricted: true,
      secretNames: [...REQUIRED_CANDIDATE_SECRETS],
    },
    releaseEnvironment: {
      exists: true,
      requiredReviewerCount: 2,
      preventSelfReview: true,
      branchRestricted: true,
      variables: {
        RELEASE_CANDIDATE_RUN_ID: candidateRunId,
        RELEASE_DMG_SHA256: dmgSha256,
        RELEASE_EVIDENCE_COMMIT: commit,
        RELEASE_ZIP_SHA256: zipSha256,
      },
    },
    candidateRun: {
      exists: true,
      workflowName: 'Build macOS Release Candidate',
      event: 'workflow_dispatch',
      conclusion: 'success',
      headSha: commit,
      artifactPresent: true,
      artifactExpired: false,
    },
  }
}

test('normalizes GitHub HTTPS, SSH, SCP, and shorthand repositories', () => {
  assert.equal(
    normalizeRepository('https://github.com/acme/desktop.git'),
    'acme/desktop',
  )
  assert.equal(
    normalizeRepository('ssh://git@github.com/acme/desktop.git'),
    'acme/desktop',
  )
  assert.equal(
    normalizeRepository('git@github.com:acme/desktop.git'),
    'acme/desktop',
  )
  assert.equal(normalizeRepository('acme/desktop'), 'acme/desktop')
  assert.equal(normalizeRepository('https://gitlab.com/acme/desktop'), null)
})

test('prefers an explicit or origin repository and skips upstream as company default', () => {
  const remotes = [
    {
      name: 'upstream',
      fetchUrl: 'https://github.com/justhil/pi-app.git',
      pushUrl: 'https://github.com/justhil/pi-app.git',
    },
    {
      name: 'company',
      fetchUrl: 'https://github.com/acme/desktop.git',
      pushUrl: 'https://github.com/acme/desktop.git',
    },
  ]
  assert.equal(chooseRepository(null, remotes), 'acme/desktop')
  assert.equal(chooseRepository('other/release', remotes), 'other/release')
})

test('returns Go only when all ten release-readiness checks pass', () => {
  const report = evaluateReleaseReadiness(validSnapshot())
  assert.equal(report.result, 'go')
  assert.equal(report.checks.length, 10)
  assert.ok(report.checks.every((check) => check.status === 'pass'))
  const serialized = JSON.stringify(report)
  assert.doesNotMatch(serialized, new RegExp(dmgSha256))
  assert.doesNotMatch(serialized, new RegExp(zipSha256))
  assert.doesNotMatch(serialized, new RegExp(candidateRunId))
})

test('rejects an upstream repository, prerelease version, dirty tree, and missing evidence', () => {
  const snapshot = validSnapshot()
  snapshot.local.clean = false
  snapshot.local.version = '0.1.0-alpha.1'
  snapshot.local.remotes[0].fetchUrl =
    'https://github.com/justhil/pi-app.git'
  snapshot.local.remotes[0].pushUrl =
    'https://github.com/justhil/pi-app.git'
  snapshot.github.repository = 'justhil/pi-app'
  snapshot.evidence = {
    exists: false,
    result: 'no-go',
    binding: null,
  }
  const report = evaluateReleaseReadiness(snapshot)
  assert.equal(report.result, 'no-go')
  assert.match(
    report.checks.find((check) => check.id === 'localCandidate').errors.join('\n'),
    /working tree|package version/,
  )
  assert.match(
    report.checks.find((check) => check.id === 'companyRepository').errors.join('\n'),
    /upstream/,
  )
  assert.equal(
    report.checks.find((check) => check.id === 'evidence').status,
    'fail',
  )
})

test('rejects unprotected environments and missing signing configuration names', () => {
  const snapshot = validSnapshot()
  snapshot.candidateEnvironment.requiredReviewerCount = 0
  snapshot.candidateEnvironment.preventSelfReview = false
  snapshot.candidateEnvironment.branchRestricted = false
  snapshot.candidateEnvironment.secretNames =
    REQUIRED_CANDIDATE_SECRETS.slice(0, 2)
  snapshot.releaseEnvironment.requiredReviewerCount = 0
  snapshot.releaseEnvironment.preventSelfReview = false
  snapshot.releaseEnvironment.branchRestricted = false
  const report = evaluateReleaseReadiness(snapshot)
  assert.equal(report.result, 'no-go')
  assert.equal(
    report.checks.find((check) => check.id === 'candidateEnvironment').status,
    'fail',
  )
  assert.match(
    report.checks.find((check) => check.id === 'candidateSecrets').errors.join('\n'),
    /missing/,
  )
  assert.equal(
    report.checks.find((check) => check.id === 'releaseEnvironment').status,
    'fail',
  )
})

test('rejects release variables or candidate artifacts not bound to evidence', () => {
  const snapshot = validSnapshot()
  snapshot.releaseEnvironment.variables.RELEASE_DMG_SHA256 = 'd'.repeat(64)
  snapshot.candidateRun.headSha = 'e'.repeat(40)
  snapshot.candidateRun.artifactExpired = true
  const report = evaluateReleaseReadiness(snapshot)
  assert.equal(report.result, 'no-go')
  assert.match(
    report.checks.find((check) => check.id === 'releaseVariables').errors.join('\n'),
    /DMG/,
  )
  assert.match(
    report.checks.find((check) => check.id === 'candidateArtifact').errors.join('\n'),
    /commit|expired/,
  )
  assert.deepEqual(
    Object.keys(snapshot.releaseEnvironment.variables).sort(),
    [...REQUIRED_RELEASE_VARIABLES].sort(),
  )
})

test('CLI status is read-only and reports the current upstream-only checkout as No-Go', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-release-readiness-'))
  try {
    const result = spawnSync(
      process.execPath,
      [
        'scripts/release-readiness.mjs',
        'status',
        `--output=${directory}`,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )
    assert.equal(result.status, 0, result.stderr)
    assert.match(result.stdout, /decision=no-go/)
    const report = JSON.parse(
      readFileSync(
        join(directory, 'formal-release-readiness.json'),
        'utf8',
      ),
    )
    assert.equal(report.result, 'no-go')
    assert.equal(report.expectedCandidate.repository, 'justhil/pi-app')
    assert.equal(
      report.checks.find((check) => check.id === 'companyRepository').status,
      'fail',
    )
    assert.equal(
      statSync(join(directory, 'formal-release-readiness.json')).mode & 0o777,
      0o600,
    )
    assert.equal(
      statSync(join(directory, 'formal-release-readiness.md')).mode & 0o777,
      0o600,
    )

    const strict = spawnSync(
      process.execPath,
      [
        'scripts/release-readiness.mjs',
        'check',
        `--output=${directory}`,
      ],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
      },
    )
    assert.equal(strict.status, 1)

    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
    assert.match(packageJson.scripts['release:readiness:status'], /status/)
    assert.match(packageJson.scripts['release:readiness:check'], /check/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
