#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

function command(command, args) {
  return spawnSync(command, args, {
    encoding: 'utf8',
    env: process.env,
    maxBuffer: 4 * 1024 * 1024,
  })
}

function fail(message) {
  console.error(`[mac-release] ${message}`)
  process.exit(1)
}

if (process.platform !== 'darwin') fail('release packaging must run on macOS')
if (process.arch !== 'arm64') {
  fail(`v0.1 release packaging requires Apple Silicon; current arch is ${process.arch}`)
}

const notary = command('xcrun', ['notarytool', '--version'])
if (notary.status !== 0) fail('xcrun notarytool is unavailable')

const identities = command('security', [
  'find-identity',
  '-v',
  '-p',
  'codesigning',
])
const hasInstalledIdentity =
  identities.status === 0 && /Developer ID Application:/.test(identities.stdout)
const hasCertificateBundle = Boolean(
  process.env.CSC_LINK && process.env.CSC_KEY_PASSWORD,
)
if (!hasInstalledIdentity && !hasCertificateBundle) {
  fail(
    'no Developer ID Application identity found; install one or provide CSC_LINK and CSC_KEY_PASSWORD',
  )
}

const appleIdCredentials =
  process.env.APPLE_ID &&
  process.env.APPLE_APP_SPECIFIC_PASSWORD &&
  process.env.APPLE_TEAM_ID
const apiKeyCredentials =
  process.env.APPLE_API_KEY &&
  process.env.APPLE_API_KEY_ID &&
  process.env.APPLE_API_ISSUER
const keychainCredentials = process.env.APPLE_KEYCHAIN_PROFILE
if (!appleIdCredentials && !apiKeyCredentials && !keychainCredentials) {
  fail(
    'notarization credentials missing; provide Apple ID, App Store Connect API key, or notarytool keychain profile credentials',
  )
}

console.log(
  `[mac-release] preflight passed: signing=${
    hasCertificateBundle ? 'CSC_LINK' : 'keychain'
  }, notarization=${
    appleIdCredentials
      ? 'apple-id'
      : apiKeyCredentials
        ? 'api-key'
        : 'keychain-profile'
  }`,
)
