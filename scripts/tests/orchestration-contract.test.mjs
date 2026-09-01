import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = process.cwd()
const read = (path) => readFileSync(join(root, path), 'utf8')

describe('M3 orchestration contracts', () => {
  it('registers the six bounded Pi child-agent tools', () => {
    const source = read('src/worker/orchestration-tools.ts')
    for (const name of [
      'create_child_agent',
      'list_child_agents',
      'read_child_agent',
      'send_message_to_child_agent',
      'stop_child_agent',
      'wait_for_child_agents',
    ]) {
      assert.match(source, new RegExp(`name:\\s*['"]${name}['"]`))
    }
    assert.match(
      read('src/worker/worker-runtime.ts'),
      /customTools:\s*\[\.\.\.createOrchestrationTools\(\),\s*\.\.\.skillDiscovery\.customTools\]/,
    )
  })

  it('persists relationships and evidence outside Pi JSONL', () => {
    const sqlite = read('src/main/sqlite-index.ts')
    assert.match(sqlite, /CREATE TABLE IF NOT EXISTS agent_relationship/)
    assert.match(sqlite, /CREATE TABLE IF NOT EXISTS orchestration_evidence/)
    assert.match(sqlite, /last_worker_event_sequence/)
    assert.doesNotMatch(
      read('src/main/orchestration/orchestration-service.ts'),
      /appendFile|writeFile/,
    )
  })

  it('routes renderer mutations through schemas and trusted repository checks', () => {
    const schemas = read('src/main/ipc/schemas.ts')
    const handlers = read('src/main/ipc/handlers/orchestration.ts')
    assert.match(schemas, /orchestrationCreateSchema/)
    assert.match(schemas, /orchestrationResumeSchema/)
    assert.match(handlers, /assertTrustedRelationship/)
    assert.match(handlers, /trustedRepositoryRoot/)
  })

  it('cascades parent abort and keeps orchestration state out of UI persistence', () => {
    assert.match(
      read('src/main/ipc/handlers/prompt.ts'),
      /cancelChildrenForParent\(sessionFile\)/,
    )
    const store = read('src/renderer/src/stores/ui-store.ts')
    const partialize =
      store.match(/partialize:\s*\(s\)\s*=>\s*\(\{([\s\S]*?)\}\),/)?.[1] || ''
    assert.doesNotMatch(partialize, /orchestration/)
  })
})
