#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

function fail(message) {
  console.error(`[mac-unsigned] ${message}`)
  process.exit(1)
}

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

if (process.platform !== 'darwin') fail('packaging must run on macOS')
if (process.arch !== 'arm64') {
  fail(`the current tester build requires Apple Silicon; current arch is ${process.arch}`)
}

const unsignedEnvironment = {
  CSC_IDENTITY_AUTO_DISCOVERY: 'false',
  PI_RELEASE_REQUIRE_NOTARIZATION: '0',
  APPLE_ID: '',
  APPLE_APP_SPECIFIC_PASSWORD: '',
  APPLE_TEAM_ID: '',
  APPLE_API_KEY: '',
  APPLE_API_KEY_ID: '',
  APPLE_API_ISSUER: '',
  APPLE_KEYCHAIN_PROFILE: '',
}

run('npm', ['run', 'icon:export'])
run('npm', ['run', 'build'])
run(
  'npx',
  ['--no-install', 'electron-builder', '--mac', '--arm64', '--publish', 'never'],
  unsignedEnvironment,
)
run(process.execPath, ['scripts/verify-macos-unsigned-prerelease.mjs'])
