const SOURCE_REPOSITORY = 'justhil/pi-app'
const FORMAL_V01_VERSION = '0.1.0'
const COMMIT = /^[a-f0-9]{40}$/
const SHA256 = /^[a-f0-9]{64}$/
const RUN_ID = /^[0-9]+$/

export const REQUIRED_CANDIDATE_SECRETS = [
  'APPLE_APP_SPECIFIC_PASSWORD',
  'APPLE_ID',
  'APPLE_TEAM_ID',
  'MAC_CSC_KEY_PASSWORD',
  'MAC_CSC_LINK',
]

export const REQUIRED_RELEASE_VARIABLES = [
  'RELEASE_CANDIDATE_RUN_ID',
  'RELEASE_DMG_SHA256',
  'RELEASE_EVIDENCE_COMMIT',
  'RELEASE_ZIP_SHA256',
]

export function normalizeRepository(value) {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().replace(/\.git$/i, '')
  const shorthand = trimmed.match(/^([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/)
  if (shorthand) return `${shorthand[1]}/${shorthand[2]}`

  const scp = trimmed.match(
    /^(?:[^@]+@)?github\.com:([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/i,
  )
  if (scp) return `${scp[1]}/${scp[2]}`

  try {
    const url = new URL(trimmed)
    if (url.hostname.toLowerCase() !== 'github.com') return null
    const parts = url.pathname.split('/').filter(Boolean)
    if (parts.length !== 2) return null
    return `${parts[0]}/${parts[1]}`
  } catch {
    return null
  }
}

export function chooseRepository(explicitRepository, remotes) {
  const explicit = normalizeRepository(explicitRepository)
  if (explicitRepository) return explicit

  const origin = remotes.find(
    (remote) =>
      remote.name === 'origin' &&
      normalizeRepository(remote.pushUrl || remote.fetchUrl),
  )
  if (origin) return normalizeRepository(origin.pushUrl || origin.fetchUrl)

  const companyCandidate = remotes.find((remote) => {
    const repository = normalizeRepository(remote.pushUrl || remote.fetchUrl)
    return repository && repository.toLowerCase() !== SOURCE_REPOSITORY
  })
  if (companyCandidate) {
    return normalizeRepository(
      companyCandidate.pushUrl || companyCandidate.fetchUrl,
    )
  }

  const first = remotes.find((remote) =>
    normalizeRepository(remote.pushUrl || remote.fetchUrl),
  )
  return first
    ? normalizeRepository(first.pushUrl || first.fetchUrl)
    : null
}

function addCheck(checks, id, label, conditions) {
  const errors = conditions
    .filter((condition) => !condition.pass)
    .map((condition) => condition.message)
  checks.push({
    id,
    label,
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
  })
}

function hasRequiredReview(env) {
  return (
    env.requiredReviewerCount >= 1 &&
    env.preventSelfReview === true
  )
}

function hasRestrictedBranches(env) {
  return env.branchRestricted === true
}

function missingNames(actual, required) {
  const names = new Set(actual)
  return required.filter((name) => !names.has(name))
}

export function evaluateReleaseReadiness(snapshot) {
  const checks = []
  const local = snapshot.local
  const github = snapshot.github
  const candidateEnvironment = snapshot.candidateEnvironment
  const releaseEnvironment = snapshot.releaseEnvironment
  const evidence = snapshot.evidence
  const candidateRun = snapshot.candidateRun
  const repository = github.repository
  const normalizedRemotes = local.remotes
    .flatMap((remote) => [remote.fetchUrl, remote.pushUrl])
    .map(normalizeRepository)
    .filter(Boolean)
  const repositoryIsSource =
    repository?.toLowerCase() === SOURCE_REPOSITORY

  addCheck(checks, 'localCandidate', 'Frozen local v0.1 candidate', [
    {
      pass: COMMIT.test(local.commit),
      message: 'current Git commit is not a full 40-character SHA',
    },
    {
      pass: local.clean,
      message: 'working tree is not clean',
    },
    {
      pass: local.version === FORMAL_V01_VERSION,
      message: `package version must be ${FORMAL_V01_VERSION} before formal release`,
    },
    {
      pass: local.changelogReady,
      message: 'CHANGELOG has no user-facing entry for the package version',
    },
    {
      pass: local.workflowsTracked,
      message: 'candidate and release workflows are not both tracked by Git',
    },
  ])

  addCheck(checks, 'evidence', 'Formal release evidence', [
    {
      pass: evidence.exists,
      message: 'local release evidence file does not exist',
    },
    {
      pass: evidence.result === 'go',
      message: 'formal release evidence decision is not Go',
    },
    {
      pass: Boolean(evidence.binding),
      message: 'release evidence has no validated candidate artifact binding',
    },
  ])

  addCheck(checks, 'companyRepository', 'Company-controlled repository', [
    {
      pass: Boolean(repository),
      message: 'no GitHub repository was selected or resolved from remotes',
    },
    {
      pass: Boolean(repository) && !repositoryIsSource,
      message: 'repository must not be the justhil/pi-app upstream',
    },
    {
      pass:
        Boolean(repository) &&
        normalizedRemotes.some(
          (entry) => entry.toLowerCase() === repository.toLowerCase(),
        ),
      message: 'selected repository is not configured as a local Git remote',
    },
    {
      pass: github.repositoryExists,
      message: 'selected GitHub repository does not exist or is not accessible',
    },
    {
      pass: !github.repositoryExists || !github.archived,
      message: 'selected GitHub repository is archived',
    },
  ])

  addCheck(checks, 'repositoryAccess', 'Authenticated release access', [
    {
      pass: github.authenticated,
      message: 'GitHub CLI is not authenticated',
    },
    {
      pass: github.canPush,
      message: 'authenticated account has no push access to the repository',
    },
  ])

  addCheck(checks, 'candidateCommit', 'Candidate commit published to GitHub', [
    {
      pass: github.commitExists,
      message: 'current candidate commit is not present in the selected repository',
    },
    {
      pass: github.workflowsAtCommit,
      message: 'release workflows are not both present at the candidate commit',
    },
  ])

  addCheck(
    checks,
    'candidateEnvironment',
    'Protected v0.1-candidate environment',
    [
      {
        pass: candidateEnvironment.exists,
        message: 'v0.1-candidate environment does not exist',
      },
      {
        pass: hasRequiredReview(candidateEnvironment),
        message:
          'v0.1-candidate requires at least one reviewer with self-review prevented',
      },
      {
        pass: hasRestrictedBranches(candidateEnvironment),
        message: 'v0.1-candidate has no deployment branch restriction',
      },
    ],
  )

  const missingCandidateSecrets = missingNames(
    candidateEnvironment.secretNames,
    REQUIRED_CANDIDATE_SECRETS,
  )
  addCheck(checks, 'candidateSecrets', 'Candidate signing secret names', [
    {
      pass: missingCandidateSecrets.length === 0,
      message:
        missingCandidateSecrets.length === 0
          ? ''
          : `v0.1-candidate is missing: ${missingCandidateSecrets.join(', ')}`,
    },
  ])

  addCheck(
    checks,
    'releaseEnvironment',
    'Protected v0.1-release environment',
    [
      {
        pass: releaseEnvironment.exists,
        message: 'v0.1-release environment does not exist',
      },
      {
        pass: hasRequiredReview(releaseEnvironment),
        message:
          'v0.1-release requires at least one reviewer with self-review prevented',
      },
      {
        pass: hasRestrictedBranches(releaseEnvironment),
        message: 'v0.1-release has no deployment branch restriction',
      },
    ],
  )

  const variables = releaseEnvironment.variables
  const missingReleaseVariables = missingNames(
    Object.keys(variables),
    REQUIRED_RELEASE_VARIABLES,
  )
  const evidenceBinding = evidence.binding
  addCheck(checks, 'releaseVariables', 'Approved release bindings', [
    {
      pass: missingReleaseVariables.length === 0,
      message:
        missingReleaseVariables.length === 0
          ? ''
          : `v0.1-release is missing: ${missingReleaseVariables.join(', ')}`,
    },
    {
      pass:
        variables.RELEASE_EVIDENCE_COMMIT === local.commit &&
        COMMIT.test(variables.RELEASE_EVIDENCE_COMMIT || ''),
      message: 'RELEASE_EVIDENCE_COMMIT does not equal the current commit',
    },
    {
      pass:
        RUN_ID.test(variables.RELEASE_CANDIDATE_RUN_ID || '') &&
        variables.RELEASE_CANDIDATE_RUN_ID ===
          evidenceBinding?.candidateRunId,
      message:
        'RELEASE_CANDIDATE_RUN_ID does not equal validated release evidence',
    },
    {
      pass:
        SHA256.test(variables.RELEASE_DMG_SHA256 || '') &&
        variables.RELEASE_DMG_SHA256 === evidenceBinding?.dmgSha256,
      message: 'RELEASE_DMG_SHA256 does not equal validated release evidence',
    },
    {
      pass:
        SHA256.test(variables.RELEASE_ZIP_SHA256 || '') &&
        variables.RELEASE_ZIP_SHA256 === evidenceBinding?.zipSha256,
      message: 'RELEASE_ZIP_SHA256 does not equal validated release evidence',
    },
  ])

  addCheck(checks, 'candidateArtifact', 'Approved immutable candidate artifact', [
    {
      pass: candidateRun.exists,
      message: 'approved candidate workflow run does not exist',
    },
    {
      pass: candidateRun.workflowName === 'Build macOS Release Candidate',
      message: 'approved Run was not produced by the candidate workflow',
    },
    {
      pass: candidateRun.event === 'workflow_dispatch',
      message: 'approved candidate Run was not manually dispatched',
    },
    {
      pass: candidateRun.conclusion === 'success',
      message: 'approved candidate Run did not complete successfully',
    },
    {
      pass: candidateRun.headSha === local.commit,
      message: 'approved candidate Run commit does not match the current commit',
    },
    {
      pass:
        candidateRun.artifactPresent &&
        candidateRun.artifactExpired === false,
      message: 'approved candidate Artifact is missing or expired',
    },
  ])

  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    expectedCandidate: {
      version: local.version,
      commit: local.commit,
      repository,
    },
    authenticatedAs: github.login || null,
    result: checks.every((check) => check.status === 'pass')
      ? 'go'
      : 'no-go',
    checks,
  }
}

export function renderReleaseReadinessMarkdown(report) {
  const rows = report.checks
    .map(
      (check) =>
        `| ${check.label} | ${check.status === 'pass' ? 'Pass' : 'Fail'} | ${
          check.errors.length > 0
            ? check.errors.join('; ').replaceAll('|', '\\|')
            : 'Ready'
        } |`,
    )
    .join('\n')
  return `# Vizruna formal release readiness

- Generated: ${report.generatedAt}
- Repository: ${report.expectedCandidate.repository || 'Not configured'}
- Version: ${report.expectedCandidate.version}
- Commit: ${report.expectedCandidate.commit}
- GitHub account: ${report.authenticatedAs || 'Not authenticated'}
- Decision: **${report.result === 'go' ? 'Go' : 'No-Go'}**

| Check | Status | Result |
| --- | --- | --- |
${rows}
`
}
