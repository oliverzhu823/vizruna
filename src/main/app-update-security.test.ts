import { describe, expect, it } from 'vitest'
import {
  checksumForFile,
  sha256Matches,
  validateReleaseDownload,
} from './app-update-security'

const repository = 'oliverzhu823/vizruna'
const tag = 'v0.1.0-alpha.4'
const fileName = 'Vizruna-0.1.0-alpha.4-arm64.dmg'
const assetUrl = `https://github.com/${repository}/releases/download/${tag}/${fileName}`
const checksumUrl = `https://github.com/${repository}/releases/download/${tag}/SHA256SUMS.txt`

describe('app update security', () => {
  it('accepts matching assets from the configured official release', () => {
    expect(validateReleaseDownload({ assetUrl, checksumUrl, fileName, repository })).toEqual({
      assetUrl,
      checksumUrl,
      fileName,
      tag,
    })
  })

  it.each([
    ['foreign repository', assetUrl.replace(repository, 'attacker/vizruna'), checksumUrl],
    ['different release', assetUrl, checksumUrl.replace(tag, 'v9.9.9')],
    ['non-HTTPS URL', assetUrl.replace('https:', 'http:'), checksumUrl],
    ['unexpected checksum name', assetUrl, checksumUrl.replace('SHA256SUMS.txt', 'checksums.txt')],
    ['URL query', `${assetUrl}?download=1`, checksumUrl],
  ])('rejects %s', (_label, candidateAsset, candidateChecksum) => {
    expect(
      validateReleaseDownload({
        assetUrl: candidateAsset,
        checksumUrl: candidateChecksum,
        fileName,
        repository,
      }),
    ).toBeNull()
  })

  it('extracts one exact checksum and rejects ambiguity', () => {
    const digest = 'a'.repeat(64)
    expect(checksumForFile(`${digest}  ${fileName}\n`, fileName)).toBe(digest)
    expect(checksumForFile(`${digest}  other.dmg\n`, fileName)).toBeNull()
    expect(checksumForFile(`${digest}  ${fileName}\n${digest} *${fileName}\n`, fileName)).toBeNull()
    expect(checksumForFile(`${digest}  nested/${fileName}\n`, fileName)).toBeNull()
  })

  it('compares complete SHA-256 values', () => {
    expect(sha256Matches('a'.repeat(64), 'A'.repeat(64))).toBe(true)
    expect(sha256Matches('a'.repeat(64), 'b'.repeat(64))).toBe(false)
    expect(sha256Matches('short', 'short')).toBe(false)
  })
})
