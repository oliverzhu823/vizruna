import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

const [
  channels,
  schemas,
  handlers,
  service,
  sqlite,
  redaction,
  panel,
] = await Promise.all([
  readFile('packages/shared/ipc-channels.ts', 'utf8'),
  readFile('src/main/ipc/schemas.ts', 'utf8'),
  readFile('src/main/ipc/handlers/reliability.ts', 'utf8'),
  readFile('src/main/reliability/reliability-service.ts', 'utf8'),
  readFile('src/main/sqlite-index.ts', 'utf8'),
  readFile('src/main/reliability/redaction.ts', 'utf8'),
  readFile(
    'src/renderer/src/features/settings/reliability-settings-panel.tsx',
    'utf8',
  ),
])

test('M4 reliability channels are allowlisted and schema validated', () => {
  for (const channel of [
    'ipc:reliability.snapshot',
    'ipc:audit.query',
    'ipc:audit.export',
    'ipc:diagnostics.preview',
    'ipc:diagnostics.export',
    'ipc:metadataBackup.create',
    'ipc:metadataBackup.restore',
  ]) {
    assert.match(channels, new RegExp(channel.replace('.', '\\.')))
    assert.match(handlers, new RegExp(`'${channel.replace('.', '\\.')}'`))
  }
  assert.match(schemas, /confirmation:\s*z\.literal\('RESTORE_METADATA'\)/)
})

test('diagnostics excludes conversations and applies key plus value redaction', () => {
  assert.doesNotMatch(service, /session-messages-from-disk|readSession.*JSONL/i)
  assert.match(service, /Pi JSONL conversation bodies/)
  assert.match(service, /complete prompts and model responses/)
  assert.match(service, /redactSensitive\(rawSnapshot\)/)
  assert.match(redaction, /Bearer/)
  assert.match(redaction, /socks5h?/)
  assert.match(redaction, /authorization\|cookie\|secret\|password/)
})

test('metadata recovery validates integrity and preserves a rollback backup', () => {
  assert.match(sqlite, /createBackupFromDb\(current, 'pre-restore'\)/)
  assert.match(sqlite, /integrityForDbPath\(known\.path\)/)
  assert.match(sqlite, /restoreTemp/)
  assert.match(sqlite, /renameSync\(displaced, activePath\)/)
  assert.match(sqlite, /createBackupFromDb\(db, 'migration'\)/)
  assert.match(service, /piJsonlModified:\s*false/)
})

test('renderer requires diagnostics preview and typed restore confirmation', () => {
  assert.match(panel, /disabled=\{busy != null \|\| !preview\}/)
  assert.match(panel, /confirmation !== 'RESTORE_METADATA'/)
  assert.match(panel, /diagnostics\.preview/)
  assert.match(panel, /metadataBackup\.restore/)
})

