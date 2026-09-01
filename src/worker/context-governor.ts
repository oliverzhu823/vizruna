import type { InlineExtension } from '@earendil-works/pi-coding-agent'
import { createHash, randomUUID } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const DEFAULT_THRESHOLD = 48_000
const HEAD_CHARS = 12_000
const TAIL_CHARS = 4_000

export interface ContextGovernorSnapshot {
  version: 1
  thresholdChars: number
  spillCount: number
  spilledChars: number
  retainedChars: number
  lastSpillAt?: number
}

const safeToolName = (value: string): string =>
  value.replace(/[^a-zA-Z0-9_-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'tool'

/**
 * Keep large tool output available on disk without forcing every byte into the
 * model context. The original result is never sent to telemetry and spill files
 * are owner-readable only. Pi's own compaction remains authoritative.
 */
export function createContextGovernor(agentDir: string, thresholdChars = DEFAULT_THRESHOLD): {
  extension: InlineExtension
  snapshot: () => ContextGovernorSnapshot
} {
  const spillRoot = join(agentDir, 'vizruna', 'context-spill')
  let spillCount = 0
  let spilledChars = 0
  let retainedChars = 0
  let lastSpillAt: number | undefined

  const extension: InlineExtension = {
    name: 'vizruna-context-governor',
    hidden: true,
    factory: (pi) => {
      pi.on('tool_result', (event) => {
        // Skill instructions must remain complete; images already use compact references.
        if (event.toolName === 'skill_load' || event.content.some((item) => item.type !== 'text')) return
        const text = event.content.map((item) => item.type === 'text' ? item.text : '').join('\n')
        if (text.length <= thresholdChars) return

        mkdirSync(spillRoot, { recursive: true, mode: 0o700 })
        const id = randomUUID()
        const filePath = join(spillRoot, `${Date.now()}-${safeToolName(event.toolName)}-${id}.txt`)
        writeFileSync(filePath, text, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
        const head = text.slice(0, HEAD_CHARS)
        const tail = text.slice(-TAIL_CHARS)
        const omitted = Math.max(0, text.length - head.length - tail.length)
        const replacement = [
          head,
          '',
          `[Vizruna Context Governor: ${omitted.toLocaleString()} characters omitted from the live context.]`,
          `Complete local result: ${filePath}`,
          `SHA-256: ${createHash('sha256').update(text).digest('hex')}`,
          '',
          tail,
        ].join('\n')
        spillCount += 1
        spilledChars += text.length
        retainedChars += replacement.length
        lastSpillAt = Date.now()
        return {
          content: [{ type: 'text' as const, text: replacement }],
          details: {
            vizrunaContextSpill: {
              filePath,
              originalChars: text.length,
              retainedChars: replacement.length,
              omittedChars: omitted,
            },
          },
        }
      })
    },
  }

  return {
    extension,
    snapshot: () => ({
      version: 1,
      thresholdChars,
      spillCount,
      spilledChars,
      retainedChars,
      ...(lastSpillAt ? { lastSpillAt } : {}),
    }),
  }
}
