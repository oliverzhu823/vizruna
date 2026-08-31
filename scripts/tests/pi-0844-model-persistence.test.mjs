import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const packageJson = JSON.parse(readFileSync('package.json', 'utf8'))
const sessionHandlers = readFileSync(
  'src/worker/handlers/worker-handlers-session.ts',
  'utf8',
)
const settingsHandlers = readFileSync(
  'src/worker/handlers/worker-handlers-pi-settings.ts',
  'utf8',
)

describe('Pi 0.84.4 model persistence boundary', () => {
  it('pins the verified Pi runtime exactly', () => {
    assert.equal(packageJson.dependencies['@earendil-works/pi-ai'], '0.84.4')
    assert.equal(packageJson.dependencies['@earendil-works/pi-coding-agent'], '0.84.4')
  })

  it('keeps conversation model and thinking changes session-scoped', () => {
    assert.match(sessionHandlers, /session\.setModel\([\s\S]*?\{ persist: false \}\)/)
    assert.match(sessionHandlers, /setThinkingLevel\([\s\S]*?\{ persist: false \}/)
  })

  it('persists defaults only through the settings manager', () => {
    assert.match(settingsHandlers, /sm\.setDefaultModelAndProvider/)
    assert.match(settingsHandlers, /sm\.setDefaultThinkingLevel/)
    assert.match(settingsHandlers, /session\.setModel\([\s\S]*?\{ persist: false \}\)/)
  })
})
