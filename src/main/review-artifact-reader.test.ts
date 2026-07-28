import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { readReviewArtifactText } from './review-artifact-reader'

const cleanupPaths: string[] = []

afterEach(() => {
  for (const path of cleanupPaths.splice(0)) rmSync(path, { recursive: true, force: true })
})

describe('readReviewArtifactText', () => {
  it('reads a generated text artifact from a local temporary directory', () => {
    const directory = mkdtempSync(join(tmpdir(), 'pi-review-artifact-'))
    cleanupPaths.push(directory)
    const file = join(directory, 'report.md')
    writeFileSync(file, '# HBM report\n')

    expect(readReviewArtifactText({ path: file, workspaceRoot: '/workspace' })).toMatchObject({
      ok: true,
      content: '# HBM report\n',
    })
  })

  it('does not expose arbitrary files outside the workspace and temporary roots', () => {
    expect(readReviewArtifactText({ path: '/etc/hosts', workspaceRoot: '/workspace' })).toEqual({
      ok: false,
      error: 'outside_allowed_roots',
    })
  })
})
