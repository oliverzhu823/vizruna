import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { describe, it } from 'node:test'

const read = (path) => readFileSync(path, 'utf8')

describe('Vizruna brand asset coverage', () => {
  it('keeps the desktop and renderer icons identical', () => {
    assert.equal(read('resources/icon.svg'), read('src/renderer/public/icon.svg'))
    assert.match(read('resources/icon.svg'), /aria-label="Vizruna"/)
    assert.match(read('resources/icon.svg'), /#9DBA86/)
  })

  it('uses the exported icon for every packaged desktop platform', () => {
    const builder = read('electron-builder.yml')
    assert.equal((builder.match(/icon: build\/icon\.png/g) || []).length, 3)
    assert.match(builder, /^productName: Vizruna$/m)
  })

  it('uses the Vizruna mark in both window chrome variants and session loading', () => {
    assert.match(read('src/renderer/src/components/app/immersive-chrome.tsx'), /VizrunaMark/)
    assert.match(read('src/renderer/src/components/app/top-bar.tsx'), /VizrunaMark/)
    assert.match(read('src/renderer/src/features/timeline/session-open-loading.tsx'), /pixel-vizruna-matrix/)
  })
})
