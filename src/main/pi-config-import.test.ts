import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { importPiConfig, inspectPiConfigImport } from './pi-config-import'

const roots: string[] = []

function fixture(): { sourceDir: string; targetDir: string } {
  const root = mkdtempSync(join(tmpdir(), 'vizruna-pi-import-'))
  roots.push(root)
  const sourceDir = join(root, 'source')
  const targetDir = join(root, 'target')
  mkdirSync(sourceDir)
  mkdirSync(targetDir)
  return { sourceDir, targetDir }
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('Pi configuration import', () => {
  it('reports only filenames and provider ids without exposing credential values', () => {
    const paths = fixture()
    writeFileSync(
      join(paths.sourceDir, 'auth.json'),
      JSON.stringify({
        'openai-codex': { type: 'oauth', access: 'private-token' },
        'zai-coding-cn': { type: 'api_key', key: 'private-key' },
      }),
    )

    const inspection = inspectPiConfigImport(paths)

    expect(inspection).toMatchObject({
      available: true,
      files: ['auth.json'],
      providers: ['openai-codex', 'zai-coding-cn'],
      targetHasConfig: false,
    })
    expect(JSON.stringify(inspection)).not.toContain('private-token')
    expect(JSON.stringify(inspection)).not.toContain('private-key')
  })

  it('imports validated files with restrictive permissions and backs up targets', () => {
    const paths = fixture()
    writeFileSync(
      join(paths.sourceDir, 'auth.json'),
      JSON.stringify({ 'openai-codex': { type: 'oauth', access: 'new-token' } }),
    )
    writeFileSync(
      join(paths.sourceDir, 'models.json'),
      JSON.stringify({ providers: { 'openai-codex': { models: [] } } }),
    )
    writeFileSync(join(paths.targetDir, 'auth.json'), JSON.stringify({ old: true }))

    const result = importPiConfig(paths)

    expect(result.imported).toEqual(['auth.json', 'models.json'])
    expect(result.backupFiles).toHaveLength(1)
    expect(result.backupFiles[0]).toMatch(/^auth\.json\.vizruna-import-backup-/)
    expect(JSON.parse(readFileSync(join(paths.targetDir, 'auth.json'), 'utf8'))).toEqual({
      'openai-codex': { type: 'oauth', access: 'new-token' },
    })
    expect(statSync(join(paths.targetDir, 'auth.json')).mode & 0o777).toBe(0o600)
  })

  it('rejects malformed source JSON before replacing the target', () => {
    const paths = fixture()
    writeFileSync(join(paths.sourceDir, 'auth.json'), '{ invalid')
    writeFileSync(join(paths.targetDir, 'auth.json'), JSON.stringify({ keep: true }))

    expect(() => importPiConfig(paths)).toThrow()
    expect(JSON.parse(readFileSync(join(paths.targetDir, 'auth.json'), 'utf8'))).toEqual({
      keep: true,
    })
  })
})
