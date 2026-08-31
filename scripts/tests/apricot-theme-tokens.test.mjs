import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles/globals.css'), 'utf8')
const sidebar = readFileSync(join(process.cwd(), 'src/renderer/src/features/workspace/project-sidebar.tsx'), 'utf8')

function apricotBlock(source) {
  const normalized = source.replace(/\r\n?/g, '\n')
  const start = normalized.indexOf('.apricot {')
  assert.ok(start >= 0, 'globals.css must define .apricot tokens')
  const end = normalized.indexOf('\n  }\n', start)
  assert.ok(end > start, 'could not slice .apricot block')
  return normalized.slice(start, end)
}

describe('apricot tiger reference sidebar palette', () => {
  it('uses one warm paper system with orange emphasis and fine borders', () => {
    const apricot = apricotBlock(css)
    assert.match(apricot, /--bg-base:\s*#fffdfa/i)
    assert.match(apricot, /--surface-sidebar:\s*#fbefe7/i)
    assert.match(apricot, /--brand:\s*#f1783f/i)
    assert.match(apricot, /--border-base:\s*#eaded5/i)
    assert.doesNotMatch(apricot, /--pastel-/i)
  })

  it('keeps semantic state colors independent from the sidebar skin', () => {
    const apricot = apricotBlock(css)
    assert.match(apricot, /--success-semantic:\s*#2f8a70/i)
    assert.match(apricot, /--danger-semantic:\s*#c95d55/i)
  })

  it('mounts the tiger once and lets the document theme class control visibility', () => {
    assert.match(sidebar, /className="apricot-mascot-slot/)
    assert.match(sidebar, /src="\/vizruna-tiger-mascot\.png"/)
    assert.doesNotMatch(sidebar, /theme\s*===\s*['"]apricot['"]/)
    assert.match(css, /\.apricot-mascot-slot\s*\{\s*display:\s*none;/)
    assert.match(css, /\.apricot \.apricot-mascot-slot\s*\{\s*display:\s*block;/)
  })
})
