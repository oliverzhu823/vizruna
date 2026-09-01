import { describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createContextGovernor } from '../worker/context-governor'

describe('Context Governor', () => {
  it('spills large text results and keeps a bounded head/tail reference', () => {
    const agentDir = mkdtempSync(join(tmpdir(), 'vizruna-context-'))
    const governor = createContextGovernor(agentDir, 100)
    let handler: ((event: Record<string, unknown>) => unknown) | undefined
    const inline = governor.extension as unknown as { factory: (api: { on: (_event: string, callback: typeof handler) => void }) => void }
    inline.factory({ on: (_event, callback) => { handler = callback } })
    const original = `head-${'x'.repeat(200)}-tail`
    const result = handler?.({
      type: 'tool_result', toolName: 'bash', toolCallId: '1', input: {},
      content: [{ type: 'text', text: original }], isError: false,
    }) as { content: Array<{ text: string }>; details: { vizrunaContextSpill: { filePath: string } } }

    const filePath = result.details.vizrunaContextSpill.filePath
    expect(existsSync(filePath)).toBe(true)
    expect(readFileSync(filePath, 'utf8')).toBe(original)
    expect(result.content[0].text).toContain('Vizruna Context Governor')
    expect(statSync(filePath).mode & 0o077).toBe(0)
    expect(governor.snapshot()).toMatchObject({ spillCount: 1, spilledChars: original.length })
  })
})
