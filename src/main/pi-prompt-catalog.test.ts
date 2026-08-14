import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { listAgentsContextFiles } from './pi-prompt-catalog'

const roots: string[] = []

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), 'vizruna-pi-context-'))
  roots.push(root)
  return root
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Pi context file discovery', () => {
  it('uses AGENTS.override.md for a directory and still layers ancestor context', () => {
    const root = temporaryRoot()
    const child = join(root, 'nested')
    mkdirSync(child)
    writeFileSync(join(root, 'AGENTS.md'), 'ancestor')
    writeFileSync(join(child, 'AGENTS.md'), 'regular child')
    writeFileSync(join(child, 'AGENTS.override.md'), 'override child')

    const projectItems = listAgentsContextFiles(child)
      .filter((item) => item.path?.startsWith(root))

    expect(projectItems.map((item) => item.path)).toEqual([
      join(root, 'AGENTS.md'),
      join(child, 'AGENTS.override.md'),
    ])
  })

  it('does not expose project context as effective before project trust', () => {
    const root = temporaryRoot()
    writeFileSync(join(root, 'AGENTS.override.md'), 'untrusted project instruction')

    expect(
      listAgentsContextFiles(root, false).some((item) => item.path?.startsWith(root)),
    ).toBe(false)
  })
})
