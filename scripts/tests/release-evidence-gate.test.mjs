import test from 'node:test'
import assert from 'node:assert/strict'
import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import {
  createReleaseEvidenceTemplate,
  evaluateReleaseEvidence,
} from '../lib/release-evidence.mjs'

const version = '0.1.0'
const commit = 'a'.repeat(40)
const packageVersion = JSON.parse(readFileSync('package.json', 'utf8')).version
const sha = (character) => character.repeat(64)
const at = (day) => `2026-07-${String(day).padStart(2, '0')}T08:00:00.000Z`

function assertPrivateMode(path) {
  // POSIX permission bits are not enforced by Windows filesystems. The CLI
  // still requests 0600; validate the effective mode only where it is meaningful.
  if (process.platform === 'win32') return
  assert.equal(statSync(path).mode & 0o777, 0o600)
}

function validEvidence() {
  return {
    schemaVersion: 1,
    candidate: {
      product: 'Vizruna',
      version,
      commit,
      recordedAt: at(1),
    },
    license: {
      status: 'approved',
      reviewer: 'Legal Reviewer',
      reviewedAt: at(1),
      piApp: {
        sourceRepository: 'https://github.com/justhil/pi-app',
        sourceCommit: 'bcef920e3900a858b305c67c42a34e61779f977c',
        commercialUseApproved: true,
        redistributionApproved: true,
        decisionReference: 'legal/pi-app-001',
      },
      piGui: {
        sourceRepository: 'https://github.com/minghinmatthewlam/pi-gui',
        sourceCommit: '48ed3025868ddb9fd359cd1fc19b7ac48916cb39',
        useMode: 'behavior-reimplementation',
        copiedSourceFiles: 0,
        licenseAndAttributionReviewed: true,
        decisionReference: 'legal/pi-gui-001',
      },
      inventories: {
        noticeReviewed: true,
        thirdPartyDependenciesReviewed: true,
        sbomReviewed: true,
      },
      decisionReference: 'legal/decision-001',
    },
    macRelease: {
      status: 'passed',
      testedAt: at(1),
      builder: 'Release Owner',
      reviewer: 'Release Reviewer',
      candidateRunId: '123456789',
      developerIdTeam: 'TEAM123456',
      notaryRequestId: 'notary-request-001',
      dmgSha256: sha('2'),
      zipSha256: sha('3'),
      checks: {
        codesign: true,
        appGatekeeper: true,
        appStapler: true,
        dmgGatekeeper: true,
        dmgStapler: true,
      },
      evidenceReference: 'release/mac-001',
    },
    cleanDevice: {
      status: 'passed',
      testedAt: at(2),
      tester: 'Clean Device Tester',
      reviewer: 'Clean Device Reviewer',
      deviceModel: 'Mac mini',
      macOSVersion: 'macOS 26.4',
      downloadSha256Matches: true,
      installPassed: true,
      gatekeeperLaunchPassed: true,
      coreFlowPassed: true,
      upgradeFromVersion: '0.1.0-alpha.1',
      upgradePassed: true,
      uninstallPassed: true,
      userDataPreserved: true,
      diagnosticsRedacted: true,
      evidenceReference: 'release/clean-device-001',
    },
    providers: [
      {
        category: 'international',
        provider: 'international-test-provider',
        model: 'test-model-a',
        routeMode: 'profile',
        proxyProtocol: 'socks5',
        testedAt: at(2),
        tester: 'Provider Tester',
        modelReplyObserved: true,
        inferenceSent: true,
        otherAppsUnaffected: true,
        responseSha256: sha('4'),
        routingAuditEventId: 'audit-international-001',
        evidenceReference: 'provider/international-001',
      },
      {
        category: 'china',
        provider: 'china-test-provider',
        model: 'test-model-b',
        routeMode: 'direct',
        noProxyEffective: true,
        testedAt: at(2),
        tester: 'Provider Tester',
        modelReplyObserved: true,
        inferenceSent: true,
        otherAppsUnaffected: true,
        responseSha256: sha('5'),
        routingAuditEventId: 'audit-china-001',
        evidenceReference: 'provider/china-001',
      },
    ],
    trial: {
      status: 'passed',
      startedAt: at(1),
      endedAt: at(8),
      coordinator: 'Trial Coordinator',
      days: Array.from({ length: 7 }, (_, index) => ({
        date: `2026-07-${String(index + 1).padStart(2, '0')}`,
        tester: `Tester ${index + 1}`,
        completedTasks: 2,
        crashCount: 0,
        dataLossCount: 0,
        credentialLeakCount: 0,
        proxyMisrouteCount: 0,
        openS0: 0,
        openS1: 0,
        issueIds: [],
      })),
      concurrency: {
        realProviderInference: true,
        agentStartAttempts: 20,
        successfulAgentStarts: 19,
        maxConcurrentAgents: 4,
        uiRemainedInteractive: true,
        stateCrossTalkCount: 0,
        evidenceReference: 'trial/concurrency-001',
      },
      evidenceReference: 'trial/week-001',
    },
    recovery: {
      status: 'passed',
      testedAt: at(8),
      tester: 'Recovery Tester',
      reviewer: 'Recovery Reviewer',
      injectedFailure: 'Terminate one active Worker during a disposable task',
      applicationRecovered: true,
      jsonlVerified: true,
      sqliteVerified: true,
      gitVerified: true,
      noDataLoss: true,
      evidenceReference: 'recovery/drill-001',
    },
    pilot: {
      status: 'passed',
      coordinator: 'Pilot Coordinator',
      participants: [
        ['P-01', 'business-product', false],
        ['P-02', 'software-engineer', true],
        ['P-03', 'it-implementation', false],
      ].map(([id, userRole, projectDeveloper]) => ({
        id,
        userRole,
        projectDeveloper,
        completedAt: at(8),
        scenarios: {
          installation: true,
          providerRouting: true,
          codeEvidence: true,
          worktreeAgent: true,
          recovery: true,
        },
        internationalProviderPassed: true,
        chinaProviderPassed: true,
        diagnosticsRedacted: true,
        openS0: 0,
        openS1: 0,
        recommendation: 'go',
        evidenceReference: `pilot/${id}`,
      })),
      openS2: [],
      evidenceReference: 'pilot/summary-001',
    },
    signoffs: [
      ['engineering', 'Engineering Owner'],
      ['test', 'Test Owner'],
      ['product', 'Product Owner'],
      ['security-legal', 'Security Legal Owner'],
    ].map(([role, signer]) => ({
      role,
      signer,
      signedAt: at(8),
      decision: 'go',
      evidenceReference: `signoff/${role}`,
    })),
  }
}

test('formal release evidence passes only when every external gate is complete', () => {
  const report = evaluateReleaseEvidence(validEvidence(), { version, commit })
  assert.equal(report.result, 'go')
  assert.equal(report.errors.length, 0)
  assert.equal(report.requirements.length, 10)
  assert.ok(report.requirements.every((requirement) => requirement.status === 'pass'))
})

test('template remains No-Go until real evidence is supplied', () => {
  const template = createReleaseEvidenceTemplate({
    version,
    commit,
    now: at(1),
  })
  const report = evaluateReleaseEvidence(template, { version, commit })
  assert.equal(report.result, 'no-go')
  assert.ok(report.errors.length > 0)
})

test('rejects stale candidates, short trials, incomplete pilots, and same-person review', () => {
  const evidence = validEvidence()
  evidence.candidate.commit = 'c'.repeat(40)
  evidence.trial.endedAt = at(3)
  evidence.trial.concurrency.successfulAgentStarts = 18
  evidence.pilot.participants = evidence.pilot.participants.slice(0, 2)
  evidence.macRelease.reviewer = evidence.macRelease.builder
  evidence.signoffs[0].signedAt = at(2)
  const report = evaluateReleaseEvidence(evidence, { version, commit })
  assert.equal(report.result, 'no-go')
  assert.match(report.errors.join('\n'), /frozen commit/)
  assert.match(report.errors.join('\n'), /seven-day trial/)
  assert.match(report.errors.join('\n'), /startup success rate/)
  assert.match(report.errors.join('\n'), /at least 3/i)
  assert.match(report.errors.join('\n'), /different people/)
  assert.match(report.errors.join('\n'), /signoff cannot predate/)
})

test('rejects evidence files that contain secrets or raw authorization material', () => {
  const evidence = validEvidence()
  evidence.providers[0].openaiApiKey = 'sk-do-not-store-this-secret'
  evidence.providers[1].evidenceReference =
    'http://proxy-user:proxy-password@127.0.0.1:10808'
  const report = evaluateReleaseEvidence(evidence, { version, commit })
  assert.equal(report.result, 'no-go')
  assert.match(report.errors.join('\n'), /forbidden secret-bearing field/)
  assert.match(report.errors.join('\n'), /authenticated URL/)
})

test('CLI initializes private local evidence, reports No-Go, and blocks strict check', () => {
  const directory = mkdtempSync(join(tmpdir(), 'pi-release-evidence-gate-'))
  const evidencePath = join(directory, 'candidate.json')
  const outputPath = join(directory, 'report')
  try {
    const initialized = spawnSync(
      process.execPath,
      [
        'scripts/release-evidence-gate.mjs',
        'init',
        `--file=${evidencePath}`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(initialized.status, 0, initialized.stderr)
    assertPrivateMode(evidencePath)
    assert.equal(JSON.parse(readFileSync(evidencePath, 'utf8')).schemaVersion, 1)

    chmodSync(evidencePath, 0o644)
    const forced = spawnSync(
      process.execPath,
      [
        'scripts/release-evidence-gate.mjs',
        'init',
        `--file=${evidencePath}`,
        '--force',
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(forced.status, 0, forced.stderr)
    assertPrivateMode(evidencePath)

    const status = spawnSync(
      process.execPath,
      [
        'scripts/release-evidence-gate.mjs',
        'status',
        `--file=${evidencePath}`,
        `--output=${outputPath}`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(status.status, 0, status.stderr)
    assert.match(status.stdout, /decision=no-go/)
    assertPrivateMode(join(outputPath, `${packageVersion}-release-gate.json`))
    assertPrivateMode(join(outputPath, `${packageVersion}-release-gate.md`))

    const strict = spawnSync(
      process.execPath,
      [
        'scripts/release-evidence-gate.mjs',
        'check',
        `--file=${evidencePath}`,
        `--output=${outputPath}`,
      ],
      { cwd: process.cwd(), encoding: 'utf8' },
    )
    assert.equal(strict.status, 1)
    assert.match(strict.stderr, /blocking finding/)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
