import { z } from 'zod'

const PRODUCT_NAME = 'Vizruna'
const PI_APP_REPOSITORY = 'https://github.com/justhil/pi-app'
const PI_APP_COMMIT = 'bcef920e3900a858b305c67c42a34e61779f977c'
const PI_GUI_REPOSITORY = 'https://github.com/minghinmatthewlam/pi-gui'
const PI_GUI_COMMIT = '48ed3025868ddb9fd359cd1fc19b7ac48916cb39'
const SHA256 = /^[a-f0-9]{64}$/i
const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/
const FORBIDDEN_KEYS = new Set([
  'apikey',
  'accesskey',
  'password',
  'secret',
  'clientsecret',
  'token',
  'authorization',
  'cookie',
  'privatekey',
  'credentialvalue',
  'proxyurl',
])
const FORBIDDEN_VALUE_PATTERNS = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/i,
  /\bsk-[A-Za-z0-9_-]{12,}/,
  /\b(?:ghp|github_pat)_[A-Za-z0-9_]{12,}/i,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
]

const nonEmpty = z.string().trim().min(1).max(500)
const timestamp = z.string().datetime({ offset: true })
const sha256 = z.string().regex(SHA256)
const passed = z.literal('passed')
const evidenceReference = nonEmpty

const candidateSchema = z.object({
  product: z.literal(PRODUCT_NAME),
  version: nonEmpty,
  commit: z.string().regex(/^[a-f0-9]{40}$/i),
  recordedAt: timestamp,
}).strict()

const licenseSchema = z.object({
  status: z.literal('approved'),
  reviewer: nonEmpty,
  reviewedAt: timestamp,
  piApp: z.object({
    sourceRepository: z.literal(PI_APP_REPOSITORY),
    sourceCommit: z.literal(PI_APP_COMMIT),
    commercialUseApproved: z.literal(true),
    redistributionApproved: z.literal(true),
    decisionReference: evidenceReference,
  }).strict(),
  piGui: z.object({
    sourceRepository: z.literal(PI_GUI_REPOSITORY),
    sourceCommit: z.literal(PI_GUI_COMMIT),
    useMode: z.literal('behavior-reimplementation'),
    copiedSourceFiles: z.literal(0),
    licenseAndAttributionReviewed: z.literal(true),
    decisionReference: evidenceReference,
  }).strict(),
  inventories: z.object({
    noticeReviewed: z.literal(true),
    thirdPartyDependenciesReviewed: z.literal(true),
    sbomReviewed: z.literal(true),
  }).strict(),
  decisionReference: evidenceReference,
}).strict()

const macReleaseSchema = z.object({
  status: passed,
  testedAt: timestamp,
  builder: nonEmpty,
  reviewer: nonEmpty,
  candidateRunId: z.string().regex(/^[0-9]+$/),
  developerIdTeam: z.string().trim().min(2).max(32),
  notaryRequestId: nonEmpty,
  dmgSha256: sha256,
  zipSha256: sha256,
  checks: z.object({
    codesign: z.literal(true),
    appGatekeeper: z.literal(true),
    appStapler: z.literal(true),
    dmgGatekeeper: z.literal(true),
    dmgStapler: z.literal(true),
  }).strict(),
  evidenceReference,
}).strict()

const cleanDeviceSchema = z.object({
  status: passed,
  testedAt: timestamp,
  tester: nonEmpty,
  reviewer: nonEmpty,
  deviceModel: nonEmpty,
  macOSVersion: nonEmpty,
  downloadSha256Matches: z.literal(true),
  installPassed: z.literal(true),
  gatekeeperLaunchPassed: z.literal(true),
  coreFlowPassed: z.literal(true),
  upgradeFromVersion: nonEmpty,
  upgradePassed: z.literal(true),
  uninstallPassed: z.literal(true),
  userDataPreserved: z.literal(true),
  diagnosticsRedacted: z.literal(true),
  evidenceReference,
}).strict()

const providerBaseSchema = z.object({
  provider: nonEmpty,
  model: nonEmpty,
  testedAt: timestamp,
  tester: nonEmpty,
  modelReplyObserved: z.literal(true),
  inferenceSent: z.literal(true),
  otherAppsUnaffected: z.literal(true),
  responseSha256: sha256,
  routingAuditEventId: nonEmpty,
  evidenceReference,
}).strict()

const providerSchema = z.discriminatedUnion('category', [
  providerBaseSchema.extend({
    category: z.literal('international'),
    routeMode: z.literal('profile'),
    proxyProtocol: z.enum(['http', 'https', 'socks5', 'socks5h']),
  }).strict(),
  providerBaseSchema.extend({
    category: z.literal('china'),
    routeMode: z.literal('direct'),
    noProxyEffective: z.literal(true),
  }).strict(),
])

const trialDaySchema = z.object({
  date: z.string().regex(DATE_ONLY),
  tester: nonEmpty,
  completedTasks: z.number().int().min(1),
  crashCount: z.number().int().min(0),
  dataLossCount: z.literal(0),
  credentialLeakCount: z.literal(0),
  proxyMisrouteCount: z.literal(0),
  openS0: z.literal(0),
  openS1: z.literal(0),
  issueIds: z.array(nonEmpty).max(100),
}).strict()

const trialConcurrencySchema = z.object({
  realProviderInference: z.literal(true),
  agentStartAttempts: z.number().int().min(20),
  successfulAgentStarts: z.number().int().min(0),
  maxConcurrentAgents: z.number().int().min(4).max(16),
  uiRemainedInteractive: z.literal(true),
  stateCrossTalkCount: z.literal(0),
  evidenceReference,
}).strict()

const trialSchema = z.object({
  status: passed,
  startedAt: timestamp,
  endedAt: timestamp,
  coordinator: nonEmpty,
  days: z.array(trialDaySchema).min(7),
  concurrency: trialConcurrencySchema,
  evidenceReference,
}).strict()

const recoverySchema = z.object({
  status: passed,
  testedAt: timestamp,
  tester: nonEmpty,
  reviewer: nonEmpty,
  injectedFailure: nonEmpty,
  applicationRecovered: z.literal(true),
  jsonlVerified: z.literal(true),
  sqliteVerified: z.literal(true),
  gitVerified: z.literal(true),
  noDataLoss: z.literal(true),
  evidenceReference,
}).strict()

const participantSchema = z.object({
  id: z.string().regex(/^P-0[1-5]$/),
  userRole: z.enum([
    'business-product',
    'software-engineer',
    'it-implementation',
    'technical-manager',
  ]),
  projectDeveloper: z.boolean(),
  completedAt: timestamp,
  scenarios: z.object({
    installation: z.literal(true),
    providerRouting: z.literal(true),
    codeEvidence: z.literal(true),
    worktreeAgent: z.literal(true),
    recovery: z.literal(true),
  }).strict(),
  internationalProviderPassed: z.literal(true),
  chinaProviderPassed: z.literal(true),
  diagnosticsRedacted: z.literal(true),
  openS0: z.literal(0),
  openS1: z.literal(0),
  recommendation: z.literal('go'),
  evidenceReference,
}).strict()

const openS2Schema = z.object({
  id: nonEmpty,
  owner: nonEmpty,
  workaround: nonEmpty,
  targetVersion: nonEmpty,
}).strict()

const pilotSchema = z.object({
  status: passed,
  coordinator: nonEmpty,
  participants: z.array(participantSchema).min(3).max(5),
  openS2: z.array(openS2Schema).max(100),
  evidenceReference,
}).strict()

const signoffSchema = z.object({
  role: z.enum(['engineering', 'test', 'product', 'security-legal']),
  signer: nonEmpty,
  signedAt: timestamp,
  decision: z.literal('go'),
  evidenceReference,
}).strict()

export const releaseEvidenceSchema = z.object({
  schemaVersion: z.literal(1),
  candidate: candidateSchema,
  license: licenseSchema,
  macRelease: macReleaseSchema,
  cleanDevice: cleanDeviceSchema,
  providers: z.array(providerSchema).min(2),
  trial: trialSchema,
  recovery: recoverySchema,
  pilot: pilotSchema,
  signoffs: z.array(signoffSchema).min(4),
}).strict().superRefine((value, context) => {
  const addChronologyIssue = (path, message) => {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path,
      message,
    })
  }
  const candidateTime = Date.parse(value.candidate.recordedAt)
  const macReleaseTime = Date.parse(value.macRelease.testedAt)
  const cleanDeviceTime = Date.parse(value.cleanDevice.testedAt)
  const trialStartTime = Date.parse(value.trial.startedAt)
  const trialEndTime = Date.parse(value.trial.endedAt)
  const recoveryTime = Date.parse(value.recovery.testedAt)

  if (macReleaseTime < candidateTime) {
    addChronologyIssue(
      ['macRelease', 'testedAt'],
      'signed candidate cannot predate the frozen candidate record',
    )
  }
  if (cleanDeviceTime < macReleaseTime) {
    addChronologyIssue(
      ['cleanDevice', 'testedAt'],
      'clean-device validation cannot predate the signed candidate',
    )
  }
  if (value.cleanDevice.upgradeFromVersion === value.candidate.version) {
    addChronologyIssue(
      ['cleanDevice', 'upgradeFromVersion'],
      'upgrade source must differ from the candidate version',
    )
  }
  for (const [index, provider] of value.providers.entries()) {
    if (Date.parse(provider.testedAt) < candidateTime) {
      addChronologyIssue(
        ['providers', index, 'testedAt'],
        'Provider validation cannot predate the frozen candidate',
      )
    }
  }
  if (trialStartTime < macReleaseTime) {
    addChronologyIssue(
      ['trial', 'startedAt'],
      'seven-day trial cannot start before the signed candidate exists',
    )
  }
  if (recoveryTime < trialStartTime) {
    addChronologyIssue(
      ['recovery', 'testedAt'],
      'recovery drill cannot predate the candidate trial',
    )
  }
  for (const [index, participant] of value.pilot.participants.entries()) {
    if (Date.parse(participant.completedAt) < macReleaseTime) {
      addChronologyIssue(
        ['pilot', 'participants', index, 'completedAt'],
        'pilot completion cannot predate the signed candidate',
      )
    }
  }

  const finalEvidenceTime = Math.max(
    Date.parse(value.license.reviewedAt),
    macReleaseTime,
    cleanDeviceTime,
    ...value.providers.map((provider) => Date.parse(provider.testedAt)),
    trialEndTime,
    recoveryTime,
    ...value.pilot.participants.map((participant) =>
      Date.parse(participant.completedAt),
    ),
  )
  for (const [index, signoff] of value.signoffs.entries()) {
    if (Date.parse(signoff.signedAt) < finalEvidenceTime) {
      addChronologyIssue(
        ['signoffs', index, 'signedAt'],
        'final Go signoff cannot predate release evidence completion',
      )
    }
  }

  if (value.macRelease.builder === value.macRelease.reviewer) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['macRelease', 'reviewer'],
      message: 'release builder and reviewer must be different people',
    })
  }
  if (value.cleanDevice.tester === value.cleanDevice.reviewer) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['cleanDevice', 'reviewer'],
      message: 'clean-device tester and reviewer must be different people',
    })
  }
  if (value.recovery.tester === value.recovery.reviewer) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['recovery', 'reviewer'],
      message: 'recovery tester and reviewer must be different people',
    })
  }

  const providerCategories = new Set(value.providers.map((entry) => entry.category))
  for (const required of ['international', 'china']) {
    if (!providerCategories.has(required)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['providers'],
        message: `missing ${required} real-inference evidence`,
      })
    }
  }

  const trialDates = value.trial.days.map((entry) => entry.date)
  if (new Set(trialDates).size !== trialDates.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['trial', 'days'],
      message: 'trial day records must use distinct calendar dates',
    })
  }
  const startedAt = Date.parse(value.trial.startedAt)
  const endedAt = Date.parse(value.trial.endedAt)
  if (endedAt - startedAt < 6 * 24 * 60 * 60 * 1_000) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['trial', 'endedAt'],
      message: 'seven-day trial must span at least seven calendar days',
    })
  }
  const startDate = value.trial.startedAt.slice(0, 10)
  const endDate = value.trial.endedAt.slice(0, 10)
  if (trialDates.some((date) => date < startDate || date > endDate)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['trial', 'days'],
      message: 'trial day records must fall between startedAt and endedAt',
    })
  }
  const concurrency = value.trial.concurrency
  if (concurrency.successfulAgentStarts > concurrency.agentStartAttempts) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['trial', 'concurrency', 'successfulAgentStarts'],
      message: 'successful Agent starts cannot exceed attempted starts',
    })
  } else if (
    concurrency.successfulAgentStarts / concurrency.agentStartAttempts <
    0.95
  ) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['trial', 'concurrency', 'successfulAgentStarts'],
      message: 'real Agent startup success rate must be at least 95%',
    })
  }

  const participantIds = value.pilot.participants.map((entry) => entry.id)
  if (new Set(participantIds).size !== participantIds.length) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pilot', 'participants'],
      message: 'pilot participant IDs must be unique',
    })
  }
  if (value.pilot.participants.every((entry) => entry.projectDeveloper)) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['pilot', 'participants'],
      message: 'pilot cannot consist only of project developers',
    })
  }
  for (const requiredRole of [
    'business-product',
    'software-engineer',
    'it-implementation',
  ]) {
    if (!value.pilot.participants.some((entry) => entry.userRole === requiredRole)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['pilot', 'participants'],
        message: `pilot is missing required user role: ${requiredRole}`,
      })
    }
  }

  const signoffRoles = value.signoffs.map((entry) => entry.role)
  for (const requiredRole of [
    'engineering',
    'test',
    'product',
    'security-legal',
  ]) {
    if (signoffRoles.filter((role) => role === requiredRole).length !== 1) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['signoffs'],
        message: `exactly one ${requiredRole} Go signoff is required`,
      })
    }
  }
})

function normalizeKey(key) {
  return key.replace(/[^A-Za-z0-9]/g, '').toLowerCase()
}

function forbiddenKey(key) {
  const normalized = normalizeKey(key)
  return (
    FORBIDDEN_KEYS.has(normalized) ||
    [...FORBIDDEN_KEYS].some(
      (forbidden) =>
        normalized.endsWith(forbidden) &&
        !normalized.endsWith(`${forbidden}count`),
    )
  )
}

function valueContainsAuthenticatedUrl(value) {
  try {
    const parsed = new URL(value)
    return !!(parsed.username || parsed.password)
  } catch {
    return false
  }
}

export function findSensitiveEvidence(value, path = '$', findings = []) {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      findSensitiveEvidence(entry, `${path}[${index}]`, findings),
    )
    return findings
  }
  if (value && typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      const childPath = `${path}.${key}`
      if (forbiddenKey(key)) {
        findings.push(`${childPath}: forbidden secret-bearing field name`)
      }
      findSensitiveEvidence(entry, childPath, findings)
    }
    return findings
  }
  if (
    typeof value === 'string' &&
    (
      FORBIDDEN_VALUE_PATTERNS.some((pattern) => pattern.test(value)) ||
      valueContainsAuthenticatedUrl(value)
    )
  ) {
    findings.push(
      `${path}: value resembles a credential, authenticated URL, or private key`,
    )
  }
  return findings
}

const REQUIREMENTS = [
  ['license', 'Open-source license approval'],
  ['macRelease', 'Developer ID signing and notarization'],
  ['cleanDevice', 'Clean-device install, upgrade, and uninstall'],
  ['providers', 'International proxy and China direct real inference'],
  ['trial', 'Seven-day internal trial'],
  ['recovery', 'Real abnormal-recovery drill'],
  ['pilot', 'Three-to-five-person pilot'],
  ['signoffs', 'Engineering, test, product, and security/legal signoff'],
]

function issueMessage(issue) {
  const location = issue.path.length > 0 ? issue.path.join('.') : '$'
  return `${location}: ${issue.message}`
}

function requirementStatus(id, issues, secrets) {
  const sectionIssues = issues.filter((issue) => issue.path[0] === id)
  const sectionSecrets = secrets.filter((finding) =>
    finding.startsWith(`$.${id}`),
  )
  const errors = [
    ...sectionIssues.map(issueMessage),
    ...sectionSecrets,
  ]
  return {
    id,
    status: errors.length === 0 ? 'pass' : 'fail',
    errors,
  }
}

export function evaluateReleaseEvidence(raw, expected) {
  const sensitiveFindings = findSensitiveEvidence(raw)
  const parsed = releaseEvidenceSchema.safeParse(raw)
  const schemaIssues = parsed.success ? [] : parsed.error.issues
  const candidateErrors = []
  if (raw?.candidate?.version !== expected.version) {
    candidateErrors.push(
      `candidate.version must equal package version ${expected.version}`,
    )
  }
  if (raw?.candidate?.commit !== expected.commit) {
    candidateErrors.push(
      `candidate.commit must equal frozen commit ${expected.commit}`,
    )
  }
  const candidateIssues = schemaIssues.filter(
    (issue) => issue.path[0] === 'candidate',
  )
  const requirements = [
    {
      id: 'candidate',
      label: 'Frozen candidate identity',
      status:
        candidateIssues.length === 0 && candidateErrors.length === 0
          ? 'pass'
          : 'fail',
      errors: [
        ...candidateIssues.map(issueMessage),
        ...candidateErrors,
      ],
    },
    {
      id: 'evidenceSecurity',
      label: 'Evidence contains no credentials or private keys',
      status: sensitiveFindings.length === 0 ? 'pass' : 'fail',
      errors: sensitiveFindings,
    },
    ...REQUIREMENTS.map(([id, label]) => ({
      ...requirementStatus(id, schemaIssues, sensitiveFindings),
      label,
    })),
  ]
  const errors = [
    ...sensitiveFindings,
    ...schemaIssues.map(issueMessage),
    ...candidateErrors,
  ]
  return {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    expectedCandidate: {
      product: PRODUCT_NAME,
      version: expected.version,
      commit: expected.commit,
    },
    result: errors.length === 0 ? 'go' : 'no-go',
    requirements,
    errors,
  }
}

export function createReleaseEvidenceTemplate({ version, commit, now }) {
  return {
    schemaVersion: 1,
    candidate: {
      product: PRODUCT_NAME,
      version,
      commit,
      recordedAt: now,
    },
    license: {
      status: null,
      reviewer: '',
      reviewedAt: '',
      piApp: {
        sourceRepository: PI_APP_REPOSITORY,
        sourceCommit: PI_APP_COMMIT,
        commercialUseApproved: null,
        redistributionApproved: null,
        decisionReference: '',
      },
      piGui: {
        sourceRepository: PI_GUI_REPOSITORY,
        sourceCommit: PI_GUI_COMMIT,
        useMode: 'behavior-reimplementation',
        copiedSourceFiles: 0,
        licenseAndAttributionReviewed: false,
        decisionReference: '',
      },
      inventories: {
        noticeReviewed: false,
        thirdPartyDependenciesReviewed: false,
        sbomReviewed: false,
      },
      decisionReference: '',
    },
    macRelease: {
      status: null,
      testedAt: '',
      builder: '',
      reviewer: '',
      candidateRunId: '',
      developerIdTeam: '',
      notaryRequestId: '',
      dmgSha256: '',
      zipSha256: '',
      checks: {
        codesign: false,
        appGatekeeper: false,
        appStapler: false,
        dmgGatekeeper: false,
        dmgStapler: false,
      },
      evidenceReference: '',
    },
    cleanDevice: {
      status: null,
      testedAt: '',
      tester: '',
      reviewer: '',
      deviceModel: '',
      macOSVersion: '',
      downloadSha256Matches: false,
      installPassed: false,
      gatekeeperLaunchPassed: false,
      coreFlowPassed: false,
      upgradeFromVersion: '',
      upgradePassed: false,
      uninstallPassed: false,
      userDataPreserved: false,
      diagnosticsRedacted: false,
      evidenceReference: '',
    },
    providers: [],
    trial: {
      status: null,
      startedAt: '',
      endedAt: '',
      coordinator: '',
      days: [],
      concurrency: {
        realProviderInference: false,
        agentStartAttempts: 0,
        successfulAgentStarts: 0,
        maxConcurrentAgents: 0,
        uiRemainedInteractive: false,
        stateCrossTalkCount: 0,
        evidenceReference: '',
      },
      evidenceReference: '',
    },
    recovery: {
      status: null,
      testedAt: '',
      tester: '',
      reviewer: '',
      injectedFailure: '',
      applicationRecovered: false,
      jsonlVerified: false,
      sqliteVerified: false,
      gitVerified: false,
      noDataLoss: false,
      evidenceReference: '',
    },
    pilot: {
      status: null,
      coordinator: '',
      participants: [],
      openS2: [],
      evidenceReference: '',
    },
    signoffs: [],
  }
}

export function renderReleaseEvidenceMarkdown(report) {
  const rows = report.requirements
    .map(
      (requirement) =>
        `| ${requirement.label} | ${requirement.status === 'pass' ? 'Pass' : 'Fail'} | ${
          requirement.errors.length > 0
            ? requirement.errors.join('; ').replaceAll('|', '\\|')
            : 'Evidence complete'
        } |`,
    )
    .join('\n')
  return `# Vizruna release evidence gate

- Generated: ${report.generatedAt}
- Version: ${report.expectedCandidate.version}
- Commit: ${report.expectedCandidate.commit}
- Decision: **${report.result === 'go' ? 'Go' : 'No-Go'}**

| Gate | Status | Evidence result |
| --- | --- | --- |
${rows}

${
  report.errors.length > 0
    ? `## Blocking findings

${report.errors.map((error) => `- ${error}`).join('\n')}
`
    : 'All formal v0.1 release evidence is complete.\n'
}`
}
