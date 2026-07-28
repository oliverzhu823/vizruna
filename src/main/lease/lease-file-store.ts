import {
  chmod,
  open,
  readFile,
  rename,
  stat,
  unlink,
  writeFile,
} from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import type { FileHandle } from 'node:fs/promises'
import type { SessionLeaseRecord } from '@shared/session-lease'
import { sessionLeaseRecordSchema } from '@shared/session-lease'
import { normalizeSessionKey } from '../worker-session-key'

export interface LeaseFileReadResult {
  record: SessionLeaseRecord | null
  parseError?: string
}

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms))

function errorCode(error: unknown): string {
  return String((error as NodeJS.ErrnoException)?.code || '')
}

export class LeaseFileStore {
  constructor(
    private readonly coordinationTimeoutMs = 2_000,
    private readonly staleCoordinationLockMs = 5_000,
  ) {}

  leasePath(sessionFile: string): string {
    return `${normalizeSessionKey(sessionFile)}.lease`
  }

  async read(sessionFile: string): Promise<LeaseFileReadResult> {
    const path = this.leasePath(sessionFile)
    try {
      const raw = await readFile(path, 'utf8')
      let value: unknown
      try {
        value = JSON.parse(raw)
      } catch (error) {
        return { record: null, parseError: `invalid JSON: ${(error as Error).message}` }
      }
      const parsed = sessionLeaseRecordSchema.safeParse(value)
      if (!parsed.success) {
        return { record: null, parseError: parsed.error.issues.map((issue) => issue.message).join('; ') }
      }
      return { record: parsed.data }
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return { record: null }
      throw error
    }
  }

  async write(sessionFile: string, record: SessionLeaseRecord): Promise<void> {
    const leasePath = this.leasePath(sessionFile)
    const tempPath = `${leasePath}.${process.pid}.${randomUUID()}.tmp`
    const payload = `${JSON.stringify(record, null, 2)}\n`
    await writeFile(tempPath, payload, { encoding: 'utf8', mode: 0o600, flag: 'wx' })
    try {
      await rename(tempPath, leasePath)
    } catch (error) {
      if (errorCode(error) !== 'EEXIST' && errorCode(error) !== 'EPERM') throw error
      await unlink(leasePath).catch((unlinkError) => {
        if (errorCode(unlinkError) !== 'ENOENT') throw unlinkError
      })
      await rename(tempPath, leasePath)
    } finally {
      await unlink(tempPath).catch(() => {})
    }
    await chmod(leasePath, 0o600).catch(() => {})
  }

  async remove(sessionFile: string): Promise<void> {
    await unlink(this.leasePath(sessionFile)).catch((error) => {
      if (errorCode(error) !== 'ENOENT') throw error
    })
  }

  async withCoordinationLock<T>(sessionFile: string, operation: () => Promise<T>): Promise<T> {
    const lockPath = `${this.leasePath(sessionFile)}.lock`
    const token = randomUUID()
    const deadline = Date.now() + this.coordinationTimeoutMs
    let handle: FileHandle | null = null

    while (!handle) {
      try {
        handle = await open(lockPath, 'wx', 0o600)
        await handle.writeFile(token, 'utf8')
      } catch (error) {
        if (errorCode(error) !== 'EEXIST') throw error
        const lockIsStale = await stat(lockPath)
          .then((entry) => Date.now() - entry.mtimeMs > this.staleCoordinationLockMs)
          .catch(() => false)
        if (lockIsStale) {
          await unlink(lockPath).catch(() => {})
          continue
        }
        if (Date.now() >= deadline) {
          throw new Error(`Timed out acquiring session lease coordination lock: ${lockPath}`)
        }
        await sleep(25)
      }
    }

    try {
      return await operation()
    } finally {
      await handle.close().catch(() => {})
      const currentToken = await readFile(lockPath, 'utf8').catch(() => '')
      if (currentToken === token) await unlink(lockPath).catch(() => {})
    }
  }
}

