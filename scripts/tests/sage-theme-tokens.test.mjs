import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const css = readFileSync(join(process.cwd(), 'src/renderer/src/styles/globals.css'), 'utf8')

function sageBlock(source) {
  const start = source.indexOf('.sage {')
  assert.ok(start >= 0, 'globals.css must define .sage tokens')
  const end = source.indexOf('\n  }\n', start)
  assert.ok(end > start, 'could not slice .sage block')
  return source.slice(start, end)
}

describe('sage eye-care theme visual tokens', () => {
  it('uses low-saturation green surfaces and readable dark-green text', () => {
    const sage = sageBlock(css)
    assert.match(sage, /color-scheme:\s*light/)
    assert.match(sage, /--bg-base:\s*#f7faf7/i)
    assert.match(sage, /--surface-sidebar:\s*#eaf2ec/i)
    assert.match(sage, /--text-primary:\s*#25342b/i)
    assert.match(sage, /--border-base:\s*#d3e0d6/i)
    assert.doesNotMatch(sage, /--bg-base:\s*#fff(?:fff)?\b/i)
    assert.doesNotMatch(sage, /--text-primary:\s*#000(?:000)?\b/i)
  })

  it('defines focus, semantic, scrollbar, and code-tool colors', () => {
    const sage = sageBlock(css)
    assert.match(sage, /--focus-border:/)
    assert.match(sage, /--danger-semantic:/)
    assert.match(sage, /--scrollbar-thumb:/)
    assert.match(sage, /--tool-read:/)
  })
})
