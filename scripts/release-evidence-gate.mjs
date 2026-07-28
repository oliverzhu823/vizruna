#!/usr/bin/env node
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import {
  createReleaseEvidenceTemplate,
  evaluateReleaseEvidence,
  renderReleaseEvidenceMarkdown,
} from './lib/release-evidence.mjs'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const action = process.argv[2]
const fileArg = process.argv.find((entry) => entry.startsWith('--file='))
const outputArg = process.argv.find((entry) => entry.startsWith('--output='))
const force = process.argv.includes('--force')
const evidencePath = resolve(
  fileArg?.slice('--file='.length) ||
    join(root, 'release-evidence', `${pkg.version}.json`),
)
const outputDirectory = resolve(
  outputArg?.slice('--output='.length) ||
    join(root, 'dist', 'release-evidence'),
)
const commit = execFileSync('git', ['rev-parse', 'HEAD'], {
  cwd: root,
  encoding: 'utf8',
}).trim()

function fail(message) {
  console.error(`[release-evidence] ${message}`)
  process.exit(1)
}

if (action === 'init') {
  if (existsSync(evidencePath) && !force) {
    fail(`refusing to overwrite existing evidence file: ${evidencePath}`)
  }
  mkdirSync(dirname(evidencePath), { recursive: true, mode: 0o700 })
  const template = createReleaseEvidenceTemplate({
    version: pkg.version,
    commit,
    now: new Date().toISOString(),
  })
  writeFileSync(evidencePath, `${JSON.stringify(template, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  })
  chmodSync(evidencePath, 0o600)
  console.log(`[release-evidence] initialized local evidence file: ${evidencePath}`)
  console.log('[release-evidence] this file is ignored by Git; do not add credentials or raw model replies')
  process.exit(0)
}

if (!['check', 'status'].includes(action)) {
  fail(
    'usage: release-evidence-gate.mjs init|check|status [--file=PATH] [--output=DIR] [--force]',
  )
}
if (!existsSync(evidencePath)) {
  fail(
    `evidence file not found: ${evidencePath}; run npm run release:evidence:init first`,
  )
}

let evidence
try {
  evidence = JSON.parse(readFileSync(evidencePath, 'utf8'))
} catch (error) {
  fail(`could not parse evidence JSON: ${error instanceof Error ? error.message : String(error)}`)
}

const report = evaluateReleaseEvidence(evidence, {
  version: pkg.version,
  commit,
})
mkdirSync(outputDirectory, { recursive: true, mode: 0o700 })
const jsonPath = join(outputDirectory, `${pkg.version}-release-gate.json`)
const markdownPath = join(outputDirectory, `${pkg.version}-release-gate.md`)
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, {
  encoding: 'utf8',
  mode: 0o600,
})
writeFileSync(markdownPath, renderReleaseEvidenceMarkdown(report), {
  encoding: 'utf8',
  mode: 0o600,
})
chmodSync(jsonPath, 0o600)
chmodSync(markdownPath, 0o600)

console.log(`[release-evidence] decision=${report.result}`)
console.log(`[release-evidence] report=${jsonPath}`)
for (const requirement of report.requirements) {
  console.log(`[release-evidence] ${requirement.status} ${requirement.id}: ${requirement.label}`)
}
if (report.result !== 'go') {
  console.error(`[release-evidence] ${report.errors.length} blocking finding(s)`)
  if (action === 'check') process.exit(1)
}
