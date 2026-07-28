import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { AuditEventInput } from '@shared/audit-events'
import { LeaseFileStore } from './lease-file-store'
import {
  SessionLeaseConflictError,
  SessionLeaseService,
} from './session-lease-service'

const temporaryDirectories: string[] = []

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'pi-enterprise-lease-'))
  temporaryDirectories.push(directory)
  const sessionFile = join(directory, 'session.jsonl')
  await writeFile(sessionFile, '{"type":"session"}\n')
  return { directory, sessionFile, store: new LeaseFileStore(1_000, 1_000) }
}

function service(
  store: LeaseFileStore,
  instanceId: string,
  options: Partial<ConstructorParameters<typeof SessionLeaseService>[0]> = {},
) {
  return new SessionLeaseService({
    store,
    instanceId,
    hostname: 'test-host',
    pid: process.pid,
    heartbeatMs: 60_000,
    ...options,
  })
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => rm(directory, { recursive: true })))
})

describe('SessionLeaseService', () => {
  it('allows at most one writer under a concurrent race', async () => {
    const { sessionFile, store } = await fixture()
    const first = service(store, '11111111-1111-4111-8111-111111111111')
    const second = service(store, '22222222-2222-4222-8222-222222222222')

    const results = await Promise.all([first.acquire(sessionFile), second.acquire(sessionFile)])
    expect(results.filter((result) => result.acquired)).toHaveLength(1)
    expect(results.filter((result) => !result.acquired)).toHaveLength(1)
    await first.releaseAll()
    await second.releaseAll()
  })

  it('releases immediately for the next writer', async () => {
    const { sessionFile, store } = await fixture()
    const first = service(store, '11111111-1111-4111-8111-111111111111')
    const second = service(store, '22222222-2222-4222-8222-222222222222')

    expect((await first.acquire(sessionFile)).acquired).toBe(true)
    await first.release(sessionFile)
    expect((await second.acquire(sessionFile)).acquired).toBe(true)
    await second.releaseAll()
  })

  it('survives 100 startup/exit cycles without silently taking over a live owner', async () => {
    const { sessionFile, store } = await fixture()

    for (let cycle = 0; cycle < 100; cycle += 1) {
      const owner = service(
        store,
        `11111111-1111-4111-8111-${String(cycle).padStart(12, '0')}`,
      )
      const contender = service(
        store,
        `22222222-2222-4222-8222-${String(cycle).padStart(12, '0')}`,
      )

      expect((await owner.acquire(sessionFile)).acquired).toBe(true)
      const blocked = await contender.acquire(sessionFile)
      expect(blocked).toMatchObject({
        acquired: false,
        snapshot: {
          disposition: 'active-foreign',
          record: { instanceId: owner.instanceId },
        },
      })
      expect((await owner.ensureOwned(sessionFile)).record?.instanceId).toBe(
        owner.instanceId,
      )

      await owner.releaseAll()
      expect((await contender.acquire(sessionFile)).acquired).toBe(true)
      expect((await contender.ensureOwned(sessionFile)).record?.instanceId).toBe(
        contender.instanceId,
      )
      await contender.releaseAll()
      expect((await contender.inspect(sessionFile)).disposition).toBe('available')
    }
  })

  it('requires explicit confirmation to recover a dead same-host owner', async () => {
    const { sessionFile, store } = await fixture()
    const first = service(store, '11111111-1111-4111-8111-111111111111')
    expect((await first.acquire(sessionFile)).acquired).toBe(true)

    const recovering = service(
      store,
      '22222222-2222-4222-8222-222222222222',
      { isPidAlive: () => false },
    )
    const blocked = await recovering.acquire(sessionFile)
    expect(blocked).toMatchObject({
      acquired: false,
      snapshot: { disposition: 'stale', reason: 'same-host-dead-pid' },
    })
    expect((await recovering.acquire(sessionFile, { confirmedTakeover: true })).acquired).toBe(true)
    await first.releaseAll()
    await recovering.releaseAll()
  })

  it('never silently replaces an active owner and audits a confirmed takeover', async () => {
    const { sessionFile, store } = await fixture()
    const audit: AuditEventInput[] = []
    const first = service(store, '11111111-1111-4111-8111-111111111111')
    const second = service(
      store,
      '22222222-2222-4222-8222-222222222222',
      {
        audit: (event) => {
          audit.push(event)
        },
      },
    )

    await first.acquire(sessionFile)
    expect((await second.acquire(sessionFile)).acquired).toBe(false)
    expect((await second.acquire(sessionFile, { confirmedTakeover: true })).acquired).toBe(true)
    expect(audit).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ action: 'lease.acquire', outcome: 'blocked' }),
        expect.objectContaining({ action: 'lease.takeover', outcome: 'success' }),
      ]),
    )
    await first.releaseAll()
    await second.releaseAll()
  })

  it('detects replacement on refresh and calls the loss handler', async () => {
    const { sessionFile, store } = await fixture()
    const onLeaseLost = vi.fn()
    const first = service(
      store,
      '11111111-1111-4111-8111-111111111111',
      { onLeaseLost },
    )
    const second = service(store, '22222222-2222-4222-8222-222222222222')

    await first.acquire(sessionFile)
    await second.acquire(sessionFile, { confirmedTakeover: true })
    await expect(first.refreshNow(sessionFile)).rejects.toBeInstanceOf(SessionLeaseConflictError)
    expect(onLeaseLost).toHaveBeenCalledOnce()
    await first.releaseAll()
    await second.releaseAll()
  })

  it('treats a corrupt lease as recoverable only by confirmed takeover', async () => {
    const { sessionFile, store } = await fixture()
    await writeFile(store.leasePath(sessionFile), '{not-json')
    const owner = service(store, '11111111-1111-4111-8111-111111111111')

    const blocked = await owner.acquire(sessionFile)
    expect(blocked).toMatchObject({
      acquired: false,
      snapshot: { disposition: 'corrupt', reason: 'invalid-record' },
    })
    expect((await owner.acquire(sessionFile, { confirmedTakeover: true })).acquired).toBe(true)
    expect(JSON.parse(await readFile(store.leasePath(sessionFile), 'utf8'))).toMatchObject({
      instanceId: owner.instanceId,
    })
    await owner.releaseAll()
  })
})
