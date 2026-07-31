import { app, shell } from 'electron'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { pipeline } from 'node:stream/promises'
import { Readable } from 'node:stream'
import log from 'electron-log'
import { errorMessage } from '@shared/error-message'
import type { AppUpdateDownloadProgress } from '@shared/app-update'
import {
  PRODUCT_PACKAGE_NAME,
  PRODUCT_USER_AGENT,
} from '@shared/product-identity'
import {
  MAX_CHECKSUM_BYTES,
  checksumForFile,
  sha256Matches,
  validateReleaseDownload,
} from './app-update-security'
import { getMainWindow } from './window'

export const APP_UPDATE_DOWNLOAD_PROGRESS_CHANNEL = 'ipc:app-update-download-progress'

let downloadInFlight = false

class UpdateDownloadError extends Error {
  constructor(readonly code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code)
  }
}

function sendProgress(payload: AppUpdateDownloadProgress): void {
  const win = getMainWindow()
  if (!win || win.isDestroyed()) return
  win.webContents.send(APP_UPDATE_DOWNLOAD_PROGRESS_CHANNEL, payload)
}

async function removeIfPresent(path: string): Promise<void> {
  try {
    await unlink(path)
  } catch {
    // Missing or already removed.
  }
}

async function fetchExpectedChecksum(checksumUrl: string, fileName: string): Promise<string> {
  let response: Response
  try {
    response = await fetch(checksumUrl, {
      headers: { 'User-Agent': PRODUCT_USER_AGENT, Accept: 'text/plain' },
      redirect: 'follow',
      signal: AbortSignal.timeout(30_000),
    })
  } catch (error: unknown) {
    throw new UpdateDownloadError('checksum_download_failed', errorMessage(error))
  }
  if (!response.ok) {
    throw new UpdateDownloadError('checksum_download_failed', `HTTP ${response.status}`)
  }
  const declaredSize = Number(response.headers.get('content-length') || 0)
  if (declaredSize > MAX_CHECKSUM_BYTES) {
    throw new UpdateDownloadError('checksum_manifest_invalid', 'manifest too large')
  }
  const manifest = await response.text()
  if (Buffer.byteLength(manifest, 'utf8') > MAX_CHECKSUM_BYTES) {
    throw new UpdateDownloadError('checksum_manifest_invalid', 'manifest too large')
  }
  const expected = checksumForFile(manifest, fileName)
  if (!expected) {
    throw new UpdateDownloadError('checksum_entry_missing')
  }
  return expected
}

/**
 * Remove quarantine only from the verified DMG downloaded into Vizruna's own temp directory.
 * This never changes system Gatekeeper settings and never touches the installed application.
 */
function clearVerifiedDmgQuarantine(path: string, fileName: string): void {
  if (process.platform !== 'darwin' || !fileName.toLowerCase().endsWith('.dmg')) return

  const listed = spawnSync('/usr/bin/xattr', [path], {
    encoding: 'utf8',
    shell: false,
  })
  if (listed.error || listed.status !== 0) {
    throw new UpdateDownloadError(
      'quarantine_inspection_failed',
      listed.error?.message || listed.stderr,
    )
  }
  const attributes = String(listed.stdout || '')
    .split(/\r?\n/)
    .map((value) => value.trim())
    .filter(Boolean)
  if (!attributes.includes('com.apple.quarantine')) return

  const cleared = spawnSync('/usr/bin/xattr', ['-d', 'com.apple.quarantine', path], {
    encoding: 'utf8',
    shell: false,
  })
  if (cleared.error || cleared.status !== 0) {
    throw new UpdateDownloadError(
      'quarantine_remove_failed',
      cleared.error?.message || cleared.stderr,
    )
  }
}

/**
 * Download release asset to temp and open it with the OS (starts installer / AppImage).
 * Non-blocking for UI via progress events; fails quietly if caller swallows errors.
 */
export async function downloadAndLaunchUpdate(opts: {
  url: string
  fileName: string
  checksumUrl: string
}): Promise<{ ok: boolean; path?: string; error?: string }> {
  if (downloadInFlight) {
    return { ok: false, error: 'download_in_progress' }
  }
  const validated = validateReleaseDownload({
    assetUrl: String(opts.url || '').trim(),
    checksumUrl: String(opts.checksumUrl || '').trim(),
    fileName: String(opts.fileName || '').trim(),
  })
  if (!validated) {
    return { ok: false, error: 'untrusted_release_source' }
  }

  downloadInFlight = true
  const dir = join(app.getPath('temp'), `${PRODUCT_PACKAGE_NAME}-updates`)
  const dest = join(dir, validated.fileName)
  let receivedBytes = 0
  let totalBytes = 0
  let launched = false

  try {
    await mkdir(dir, { recursive: true })
    await removeIfPresent(dest)

    sendProgress({
      phase: 'verifying',
      receivedBytes: 0,
      totalBytes: 0,
      percent: -1,
      fileName: validated.fileName,
    })
    const expectedChecksum = await fetchExpectedChecksum(
      validated.checksumUrl,
      validated.fileName,
    )

    sendProgress({
      phase: 'downloading',
      receivedBytes: 0,
      totalBytes: 0,
      percent: 0,
      fileName: validated.fileName,
    })

    const response = await fetch(validated.assetUrl, {
      headers: { 'User-Agent': PRODUCT_USER_AGENT, Accept: 'application/octet-stream' },
      redirect: 'follow',
      signal: AbortSignal.timeout(15 * 60_000),
    })
    if (!response.ok || !response.body) {
      throw new UpdateDownloadError('installer_download_failed', `HTTP ${response.status}`)
    }

    const totalHeader = response.headers.get('content-length')
    totalBytes = totalHeader ? Number(totalHeader) || 0 : 0
    const hash = createHash('sha256')

    const nodeStream = Readable.fromWeb(response.body as import('node:stream/web').ReadableStream)
    nodeStream.on('data', (chunk: Buffer | string) => {
      const data = typeof chunk === 'string' ? Buffer.from(chunk) : chunk
      hash.update(data)
      receivedBytes += data.length
      const percent =
        totalBytes > 0 ? Math.min(100, Math.floor((receivedBytes / totalBytes) * 100)) : -1
      sendProgress({
        phase: 'downloading',
        receivedBytes,
        totalBytes,
        percent,
        fileName: validated.fileName,
      })
    })

    await pipeline(nodeStream, createWriteStream(dest))
    sendProgress({
      phase: 'verifying',
      receivedBytes,
      totalBytes: totalBytes || receivedBytes,
      percent: 100,
      fileName: validated.fileName,
    })
    const actualChecksum = hash.digest('hex')
    if (!sha256Matches(expectedChecksum, actualChecksum)) {
      throw new UpdateDownloadError('checksum_mismatch')
    }

    sendProgress({
      phase: 'preparing',
      receivedBytes,
      totalBytes: totalBytes || receivedBytes,
      percent: 100,
      fileName: validated.fileName,
    })
    clearVerifiedDmgQuarantine(dest, validated.fileName)

    sendProgress({
      phase: 'launching',
      receivedBytes,
      totalBytes: totalBytes || receivedBytes,
      percent: 100,
      fileName: validated.fileName,
    })

    const openError = await shell.openPath(dest)
    if (openError) {
      throw new UpdateDownloadError('installer_open_failed', openError)
    }
    launched = true

    sendProgress({
      phase: 'done',
      receivedBytes,
      totalBytes: totalBytes || receivedBytes,
      percent: 100,
      fileName: validated.fileName,
    })
    log.info('[Updater] launched installer:', dest)
    return { ok: true, path: dest }
  } catch (error: unknown) {
    const detail = errorMessage(error)
    const code = error instanceof UpdateDownloadError ? error.code : 'installer_download_failed'
    if (!launched) await removeIfPresent(dest)
    log.warn('[Updater] download/launch failed:', detail)
    sendProgress({
      phase: 'error',
      receivedBytes,
      totalBytes,
      percent: -1,
      fileName: validated.fileName,
      error: code,
    })
    return { ok: false, error: code }
  } finally {
    downloadInFlight = false
  }
}
