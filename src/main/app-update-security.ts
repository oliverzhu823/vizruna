import { timingSafeEqual } from 'node:crypto'
import {
  PRODUCT_UPDATE_REPOSITORY,
  PRODUCT_UPDATE_REPOSITORY_ENV,
} from '@shared/product-identity'

export const UPDATE_CHECKSUM_FILE_NAME = 'SHA256SUMS.txt'
export const MAX_CHECKSUM_BYTES = 256 * 1024

export type ValidatedReleaseDownload = {
  assetUrl: string
  checksumUrl: string
  fileName: string
  tag: string
}

function configuredRepository(): string {
  return String(
    process.env[PRODUCT_UPDATE_REPOSITORY_ENV] || PRODUCT_UPDATE_REPOSITORY,
  ).trim()
}

function safeSegment(raw: string): string | null {
  try {
    const decoded = decodeURIComponent(raw)
    if (!decoded || decoded.includes('/') || decoded.includes('\\') || decoded.includes('\0')) {
      return null
    }
    return decoded
  } catch {
    return null
  }
}

function parseReleaseAssetUrl(
  input: string,
  repository: string,
): { tag: string; fileName: string; url: string } | null {
  const repoParts = repository.split('/')
  if (repoParts.length !== 2 || repoParts.some((part) => !/^[A-Za-z0-9_.-]+$/.test(part))) {
    return null
  }

  let parsed: URL
  try {
    parsed = new URL(input)
  } catch {
    return null
  }
  if (
    parsed.protocol !== 'https:' ||
    parsed.hostname.toLowerCase() !== 'github.com' ||
    parsed.port ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    return null
  }

  const rawParts = parsed.pathname.split('/').slice(1)
  if (rawParts.length !== 6) return null
  const parts = rawParts.map(safeSegment)
  if (parts.some((part) => part === null)) return null
  const [owner, repo, releases, download, tag, fileName] = parts as string[]
  if (
    owner.toLowerCase() !== repoParts[0].toLowerCase() ||
    repo.toLowerCase() !== repoParts[1].toLowerCase() ||
    releases !== 'releases' ||
    download !== 'download'
  ) {
    return null
  }
  return { tag, fileName, url: parsed.toString() }
}

/**
 * Accept only an installer and checksum manifest from the same official GitHub Release.
 * The renderer supplies URLs, so the main process must not trust them without this check.
 */
export function validateReleaseDownload(input: {
  assetUrl: string
  checksumUrl: string
  fileName: string
  repository?: string
}): ValidatedReleaseDownload | null {
  const repository = input.repository ?? configuredRepository()
  const requestedName = String(input.fileName || '').trim()
  if (
    !requestedName ||
    requestedName.length > 180 ||
    !/^[A-Za-z0-9_.+()[\] -]+$/.test(requestedName) ||
    requestedName === '.' ||
    requestedName === '..'
  ) {
    return null
  }

  const asset = parseReleaseAssetUrl(String(input.assetUrl || '').trim(), repository)
  const checksum = parseReleaseAssetUrl(String(input.checksumUrl || '').trim(), repository)
  if (
    !asset ||
    !checksum ||
    asset.tag !== checksum.tag ||
    asset.fileName !== requestedName ||
    checksum.fileName !== UPDATE_CHECKSUM_FILE_NAME
  ) {
    return null
  }

  return {
    assetUrl: asset.url,
    checksumUrl: checksum.url,
    fileName: requestedName,
    tag: asset.tag,
  }
}

/** Return the one SHA-256 entry for fileName, rejecting missing or duplicate entries. */
export function checksumForFile(manifest: string, fileName: string): string | null {
  if (Buffer.byteLength(manifest, 'utf8') > MAX_CHECKSUM_BYTES) return null
  const matches: string[] = []
  for (const rawLine of manifest.split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(/^([a-fA-F0-9]{64})\s+\*?(.+)$/)
    if (!match) continue
    const listedName = match[2].trim().replace(/^\.\//, '')
    if (listedName === fileName) matches.push(match[1].toLowerCase())
  }
  return matches.length === 1 ? matches[0] : null
}

export function sha256Matches(expected: string, actual: string): boolean {
  if (!/^[a-fA-F0-9]{64}$/.test(expected) || !/^[a-fA-F0-9]{64}$/.test(actual)) {
    return false
  }
  return timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(actual, 'hex'))
}
