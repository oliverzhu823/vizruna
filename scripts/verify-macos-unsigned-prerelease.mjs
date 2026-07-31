#!/usr/bin/env node
import assert from 'node:assert/strict'
import { existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const dist = resolve(process.argv[2] || join(root, 'dist'))
const appPath = join(dist, 'mac-arm64', 'Vizruna.app')
const infoPlistPath = join(appPath, 'Contents', 'Info.plist')
const artifacts = existsSync(dist) ? readdirSync(dist) : []
const dmgNames = artifacts.filter((name) => name.endsWith('-arm64.dmg'))
const zipNames = artifacts.filter((name) => name.endsWith('-arm64.zip'))

assert.ok(existsSync(appPath), `missing packaged app: ${appPath}`)
assert.ok(existsSync(infoPlistPath), `missing Info.plist: ${infoPlistPath}`)
assert.equal(dmgNames.length, 1, `expected one arm64 DMG, found ${dmgNames.length}`)
assert.equal(zipNames.length, 1, `expected one arm64 ZIP, found ${zipNames.length}`)

function command(commandName, args) {
  return spawnSync(commandName, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 8 * 1024 * 1024,
  })
}

const plist = command('plutil', [
  '-extract',
  'CFBundleIdentifier',
  'raw',
  '-o',
  '-',
  infoPlistPath,
])
assert.equal(plist.status, 0, plist.stderr)
assert.equal(plist.stdout.trim(), 'com.vizruna.desktop')

const signature = command('codesign', ['--display', '--verbose=4', appPath])
const signatureText = `${signature.stdout || ''}${signature.stderr || ''}`
assert.doesNotMatch(
  signatureText,
  /Authority=Developer ID Application:/,
  'tester build must not contain a Developer ID signature',
)

const gatekeeper = command('spctl', [
  '--assess',
  '--type',
  'execute',
  '--verbose=4',
  appPath,
])
assert.notEqual(
  gatekeeper.status,
  0,
  'unsigned tester build unexpectedly passed Gatekeeper assessment',
)

console.log(`[mac-unsigned] app identity verified: ${appPath}`)
console.log(`[mac-unsigned] no Developer ID signature: ${signatureText.trim() || 'unsigned'}`)
console.log(`[mac-unsigned] Gatekeeper rejection confirmed for documented first-launch flow`)
console.log(`[mac-unsigned] DMG: ${join(dist, dmgNames[0])}`)
console.log(`[mac-unsigned] ZIP: ${join(dist, zipNames[0])}`)
