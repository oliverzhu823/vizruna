#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { spawnSync } from 'node:child_process'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  chooseRepository,
  evaluateReleaseReadiness,
  normalizeRepository,
  renderReleaseReadinessMarkdown,
} from './lib/release-readiness.mjs'
import {
  evaluateReleaseEvidence,
  releaseEvidenceSchema,
} from './lib/release-evidence.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const action = process.argv[2]
const repositoryArg = process.argv.find((entry) => entry.startsWith('--repo='))
const outputArg = process.argv.find((entry) => entry.startsWith('--output='))
const packageJson = JSON.parse(
  readFileSync(join(root, 'package.json'), 'utf8'),
)
const commit = git(['rev-parse', 'HEAD']).stdout.trim()
const remotes = readRemotes()
const repository = chooseRepository(
  repositoryArg?.slice('--repo='.length),
  remotes,
)
const outputDirectory = resolve(
  outputArg?.slice('--output='.length) ||
    join(root, 'dist', 'release-readiness'),
)

if (!['status', 'check'].includes(action)) {
  console.error(
    '[release-readiness] usage: release-readiness.mjs status|check [--repo=OWNER/REPO] [--output=DIR]',
  )
  process.exit(1)
}
if (repositoryArg && !normalizeRepository(repositoryArg.slice('--repo='.length))) {
  console.error('[release-readiness] --repo must use OWNER/REPO or a GitHub URL')
  process.exit(1)
}

function command(commandName, args, options = {}) {
  const result = spawnSync(commandName, args, {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 4 * 1024 * 1024,
    ...options,
  })
  return {
    ok: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

function git(args) {
  return command('git', args)
}

function ghJson(endpoint) {
  const result = command('gh', [
    'api',
    '-H',
    'Accept: application/vnd.github+json',
    endpoint,
  ])
  if (!result.ok) return null
  try {
    return JSON.parse(result.stdout)
  } catch {
    return null
  }
}

function readRemotes() {
  const names = git(['remote']).stdout.split(/\r?\n/).filter(Boolean)
  return names.map((name) => ({
    name,
    fetchUrl: git(['remote', 'get-url', name]).stdout.trim(),
    pushUrl: git(['remote', 'get-url', '--push', name]).stdout.trim(),
  }))
}

function protectionSnapshot(environment) {
  const reviewerRule = environment?.protection_rules?.find(
    (rule) => rule.type === 'required_reviewers',
  )
  const branchPolicy = environment?.deployment_branch_policy
  return {
    exists: Boolean(environment),
    requiredReviewerCount: reviewerRule?.reviewers?.length || 0,
    preventSelfReview: reviewerRule?.prevent_self_review === true,
    branchRestricted: Boolean(
      branchPolicy?.protected_branches ||
        branchPolicy?.custom_branch_policies,
    ),
  }
}

function evidenceSnapshot() {
  const evidencePath = join(
    root,
    'release-evidence',
    `${packageJson.version}.json`,
  )
  if (!existsSync(evidencePath)) {
    return {
      exists: false,
      result: 'no-go',
      binding: null,
    }
  }
  try {
    const raw = JSON.parse(readFileSync(evidencePath, 'utf8'))
    const report = evaluateReleaseEvidence(raw, {
      version: packageJson.version,
      commit,
    })
    const parsed = releaseEvidenceSchema.safeParse(raw)
    return {
      exists: true,
      result: report.result,
      binding:
        report.result === 'go' && parsed.success
          ? {
              candidateRunId: parsed.data.macRelease.candidateRunId,
              dmgSha256: parsed.data.macRelease.dmgSha256.toLowerCase(),
              zipSha256: parsed.data.macRelease.zipSha256.toLowerCase(),
            }
          : null,
    }
  } catch {
    return {
      exists: true,
      result: 'no-go',
      binding: null,
    }
  }
}

function listNames(endpoint, field) {
  const response = ghJson(endpoint)
  return Array.isArray(response?.[field])
    ? response[field]
        .map((entry) => entry?.name)
        .filter((name) => typeof name === 'string')
    : []
}

function readVariables(endpoint) {
  const response = ghJson(endpoint)
  if (!Array.isArray(response?.variables)) return {}
  return Object.fromEntries(
    response.variables
      .filter(
        (entry) =>
          typeof entry?.name === 'string' &&
          typeof entry?.value === 'string',
      )
      .map((entry) => [entry.name, entry.value]),
  )
}

const status = git(['status', '--porcelain', '--untracked-files=normal'])
const trackedWorkflows = [
  '.github/workflows/release-candidate.yml',
  '.github/workflows/release.yml',
].every((path) =>
  git(['ls-files', '--error-unmatch', path]).ok,
)
const escapedVersion = packageJson.version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const changelogReady = new RegExp(
  `^##\\s+(?:\\[)?v?${escapedVersion}(?:\\])?(?:\\s|$)`,
  'm',
).test(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'))
const evidence = evidenceSnapshot()

const sourceOnly = repository?.toLowerCase() === 'justhil/pi-app'
const user = command('gh', ['api', 'user'])
let userData = null
try {
  userData = user.ok ? JSON.parse(user.stdout) : null
} catch {
  userData = null
}

const repositoryData =
  repository && !sourceOnly ? ghJson(`repos/${repository}`) : null
const commitData =
  repositoryData && /^[a-f0-9]{40}$/i.test(commit)
    ? ghJson(`repos/${repository}/commits/${commit}`)
    : null
const workflowsAtCommit = Boolean(
  repositoryData &&
    ghJson(
      `repos/${repository}/contents/.github/workflows/release-candidate.yml?ref=${commit}`,
    ) &&
    ghJson(
      `repos/${repository}/contents/.github/workflows/release.yml?ref=${commit}`,
    ),
)

const candidateEnvironmentData = repositoryData
  ? ghJson(`repos/${repository}/environments/v0.1-candidate`)
  : null
const releaseEnvironmentData = repositoryData
  ? ghJson(`repos/${repository}/environments/v0.1-release`)
  : null
const candidateSecretNames = repositoryData
  ? listNames(
      `repos/${repository}/environments/v0.1-candidate/secrets?per_page=100`,
      'secrets',
    )
  : []
const releaseVariables = repositoryData
  ? readVariables(
      `repos/${repository}/environments/v0.1-release/variables?per_page=100`,
    )
  : {}

const approvedRunId = releaseVariables.RELEASE_CANDIDATE_RUN_ID
const candidateRunData =
  repositoryData && /^[0-9]+$/.test(approvedRunId || '')
    ? ghJson(`repos/${repository}/actions/runs/${approvedRunId}`)
    : null
const candidateArtifacts =
  repositoryData && candidateRunData
    ? ghJson(
        `repos/${repository}/actions/runs/${approvedRunId}/artifacts?per_page=100`,
      )
    : null
const artifactName = approvedRunId
  ? `pi-desktop-mac-candidate-${approvedRunId}`
  : null
const approvedArtifact = candidateArtifacts?.artifacts?.find(
  (artifact) => artifact.name === artifactName,
)

const snapshot = {
  local: {
    commit,
    clean: status.ok && status.stdout.trim() === '',
    version: packageJson.version,
    changelogReady,
    workflowsTracked: trackedWorkflows,
    remotes,
  },
  evidence,
  github: {
    repository,
    authenticated: Boolean(userData?.login),
    login: userData?.login || null,
    repositoryExists: Boolean(repositoryData?.full_name),
    archived: repositoryData?.archived === true,
    canPush:
      repositoryData?.permissions?.push === true ||
      repositoryData?.permissions?.admin === true,
    commitExists: Boolean(commitData?.sha),
    workflowsAtCommit,
  },
  candidateEnvironment: {
    ...protectionSnapshot(candidateEnvironmentData),
    secretNames: candidateSecretNames,
  },
  releaseEnvironment: {
    ...protectionSnapshot(releaseEnvironmentData),
    variables: releaseVariables,
  },
  candidateRun: {
    exists: Boolean(candidateRunData?.id),
    workflowName: candidateRunData?.name || null,
    event: candidateRunData?.event || null,
    conclusion: candidateRunData?.conclusion || null,
    headSha: candidateRunData?.head_sha || null,
    artifactPresent: Boolean(approvedArtifact),
    artifactExpired: approvedArtifact?.expired ?? null,
  },
}

const report = evaluateReleaseReadiness(snapshot)
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 })
const jsonPath = join(outputDirectory, 'formal-release-readiness.json')
const markdownPath = join(outputDirectory, 'formal-release-readiness.md')
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
})
writeFileSync(markdownPath, renderReleaseReadinessMarkdown(report), {
  encoding: 'utf8',
  mode: 0o600,
})
chmodSync(jsonPath, 0o600)
chmodSync(markdownPath, 0o600)

console.log(`[release-readiness] decision=${report.result}`)
console.log(
  `[release-readiness] repository=${report.expectedCandidate.repository || 'not-configured'}`,
)
console.log(`[release-readiness] report=${markdownPath}`)
for (const check of report.checks) {
  console.log(
    `[release-readiness] ${check.status} ${check.id}: ${check.label}`,
  )
}
if (report.result !== 'go' && action === 'check') process.exit(1)
