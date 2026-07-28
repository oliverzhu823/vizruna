import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import test from 'node:test'

const root = process.cwd()
const source = readFileSync(join(root, 'src/main/worker-manager.ts'), 'utf8')
const appSource = readFileSync(join(root, 'src/renderer/src/app/app.tsx'), 'utf8')

test('authentication reload recovery shares Worker lifecycle serialization', () => {
  assert.match(
    source,
    /reloadAuthentication\(\)[\s\S]*this\.lifecycleChain\.then\(\(\) => this\.reloadAuthenticationUnlocked\(\)\)/,
  )
  assert.match(source, /await this\.lifecycleChain\.catch\(\(\) => undefined\)/)
  assert.match(source, /enqueueSlotAuthenticationReload\(slot: WorkerSlot\)/)
})

test('background authentication recovery does not steal foreground', () => {
  assert.match(
    source,
    /ensureSessionWorkerUnlocked\(sessionFile, cwd, \{\s*foreground: wasForeground,\s*\}\)/,
  )
  assert.match(source, /const makeForeground = options\?\.foreground !== false/)
})

test('provider authorization UI remains mounted on the settings page', () => {
  const settingsStart = appSource.indexOf("if (view === 'settings')")
  const settingsReturn = appSource.indexOf('\n    return (', settingsStart)
  const mainStart = appSource.indexOf('\n  return (', settingsReturn + 1)
  assert.notEqual(settingsStart, -1)
  assert.notEqual(settingsReturn, -1)
  assert.notEqual(mainStart, -1)

  const settingsBranch = appSource.slice(settingsStart, mainStart)
  assert.match(
    settingsBranch,
    /<ProviderAuthFlowHost onFlowStarted=\{handleProviderAuthFlowStarted\} \/>/,
  )
  assert.match(settingsBranch, /<AppToaster \/>/)
})
