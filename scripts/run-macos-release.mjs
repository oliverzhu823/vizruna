#!/usr/bin/env node
import { spawnSync } from 'node:child_process'

function run(command, args, extraEnv = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...extraEnv },
    shell: false,
  })
  if (result.error) throw result.error
  if (result.status !== 0) process.exit(result.status ?? 1)
}

run(process.execPath, ['scripts/macos-release-preflight.mjs'])
run('npm', ['run', 'icon:export'])
run('npm', ['run', 'build'])
run(
  'npx',
  [
    '--no-install',
    'electron-builder',
    '--mac',
    '--arm64',
    '--publish',
    'never',
  ],
  { PI_RELEASE_REQUIRE_NOTARIZATION: '1' },
)
run(process.execPath, ['scripts/verify-macos-release.mjs'])
