#!/usr/bin/env node
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const dist = resolve(process.argv[2] || join(root, 'dist'))
const appPath = join(dist, 'mac-arm64', 'Vizruna.app')
const artifacts = existsSync(dist) ? readdirSync(dist) : []
const dmgName = artifacts.find((name) => name.endsWith('-arm64.dmg'))
const zipName = artifacts.find((name) => name.endsWith('-arm64.zip'))
assert.ok(existsSync(appPath), `missing packaged app: ${appPath}`)
assert.ok(dmgName, 'missing arm64 DMG')
assert.ok(zipName, 'missing arm64 ZIP')
const dmgPath = join(dist, dmgName)

function checked(command, args, label) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  })
  if (result.status !== 0) {
    throw new Error(
      `${label} failed\n${result.stdout || ''}${result.stderr || ''}`,
    )
  }
  return `${result.stdout || ''}${result.stderr || ''}`
}

checked(
  'codesign',
  ['--verify', '--deep', '--strict', '--verbose=2', appPath],
  'codesign verification',
)
const signature = checked(
  'codesign',
  ['--display', '--verbose=4', appPath],
  'signature inspection',
)
assert.match(signature, /Authority=Developer ID Application:/)
assert.doesNotMatch(signature, /TeamIdentifier=not set/)
checked(
  'spctl',
  ['--assess', '--type', 'execute', '--verbose=4', appPath],
  'Gatekeeper app assessment',
)
checked('xcrun', ['stapler', 'validate', appPath], 'app notarization ticket')
checked('xcrun', ['stapler', 'validate', dmgPath], 'DMG notarization ticket')
checked(
  'spctl',
  [
    '--assess',
    '--type',
    'open',
    '--context',
    'context:primary-signature',
    '--verbose=4',
    dmgPath,
  ],
  'Gatekeeper DMG assessment',
)

console.log(`[mac-release] Developer ID signature verified: ${appPath}`)
console.log(`[mac-release] notarization tickets and Gatekeeper verified: ${dmgPath}`)
console.log(`[mac-release] stapled app archive present: ${join(dist, zipName)}`)
