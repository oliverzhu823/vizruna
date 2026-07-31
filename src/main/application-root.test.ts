import { describe, expect, it } from 'vitest'
import { join, resolve } from 'path'
import { resolveApplicationRoot } from './application-root'

describe('resolveApplicationRoot', () => {
  it('keeps a regular development or packaged application root', () => {
    const root = resolve('/tmp/vizruna')
    const paths = new Set([join(root, 'package.json'), join(root, 'out')])
    expect(resolveApplicationRoot(root, (path) => paths.has(path))).toBe(root)
  })

  it('normalizes a directly launched out/main entry back to the project root', () => {
    const root = resolve('/tmp/vizruna')
    const mainPath = join(root, 'out', 'main')
    const paths = new Set([join(root, 'package.json'), join(root, 'out')])
    expect(resolveApplicationRoot(mainPath, (path) => paths.has(path))).toBe(root)
  })
})
