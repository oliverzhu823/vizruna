import {
  appendFileSync,
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { join } from 'node:path'
import type {
  RuntimeEvaluationRecordV1,
  RuntimeEventEnvelopeV1,
  RuntimeRunRecord,
} from '@shared/runtime-rpc-v1'
import { getRuntimeStateDirectory } from './runtime-paths'

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 })
  try { chmodSync(path, 0o700) } catch { /* Windows */ }
}

function atomicJson(path: string, value: unknown): void {
  ensureDirectory(getRuntimeStateDirectory())
  const temporary = `${path}.${process.pid}.tmp`
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 })
  renameSync(temporary, path)
  try { chmodSync(path, 0o600) } catch { /* Windows */ }
}

function readJson<T>(path: string): T | null {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T
  } catch {
    return null
  }
}

export class RuntimeStore {
  readonly root: string
  private readonly runsDirectory: string
  private readonly evaluationsDirectory: string
  private readonly eventsPath: string
  private readonly auditPath: string

  constructor(root = getRuntimeStateDirectory()) {
    this.root = root
    this.runsDirectory = join(root, 'runs')
    this.evaluationsDirectory = join(root, 'evaluations')
    this.eventsPath = join(root, 'events.jsonl')
    this.auditPath = join(root, 'audit.jsonl')
    ensureDirectory(this.runsDirectory)
    ensureDirectory(this.evaluationsDirectory)
  }

  saveRun(run: RuntimeRunRecord): RuntimeRunRecord {
    atomicJson(join(this.runsDirectory, `${run.id}.json`), run)
    return run
  }

  getRun(id: string): RuntimeRunRecord | null {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(id)) return null
    return readJson<RuntimeRunRecord>(join(this.runsDirectory, `${id}.json`))
  }

  listRuns(limit = 50): RuntimeRunRecord[] {
    return readdirSync(this.runsDirectory)
      .filter((file) => file.endsWith('.json'))
      .flatMap((file) => {
        const value = readJson<RuntimeRunRecord>(join(this.runsDirectory, file))
        return value ? [value] : []
      })
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, Math.max(1, Math.min(500, limit)))
  }

  saveEvaluation(record: RuntimeEvaluationRecordV1): RuntimeEvaluationRecordV1 {
    atomicJson(join(this.evaluationsDirectory, `${record.id}.json`), record)
    return record
  }

  getEvaluation(id: string): RuntimeEvaluationRecordV1 | null {
    if (!/^[A-Za-z0-9-]{1,100}$/.test(id)) return null
    return readJson<RuntimeEvaluationRecordV1>(join(this.evaluationsDirectory, `${id}.json`))
  }

  appendEvent(event: RuntimeEventEnvelopeV1): void {
    ensureDirectory(this.root)
    appendFileSync(this.eventsPath, `${JSON.stringify(event)}\n`, { mode: 0o600 })
  }

  listEvents(options: { after?: number; runId?: string; limit?: number } = {}): RuntimeEventEnvelopeV1[] {
    if (!existsSync(this.eventsPath)) return []
    const after = Math.max(0, Number(options.after || 0))
    const limit = Math.max(1, Math.min(5_000, Number(options.limit || 1_000)))
    const lines = readFileSync(this.eventsPath, 'utf8').split('\n').filter(Boolean)
    const events: RuntimeEventEnvelopeV1[] = []
    for (const line of lines) {
      try {
        const event = JSON.parse(line) as RuntimeEventEnvelopeV1
        if (event.id <= after) continue
        if (options.runId && event.runId !== options.runId) continue
        events.push(event)
      } catch {
        // Ignore a partial final line after an interrupted write.
      }
    }
    return events.slice(-limit)
  }

  nextEventId(): number {
    const last = this.listEvents({ limit: 1 })[0]
    return (last?.id || 0) + 1
  }

  audit(input: Record<string, unknown>): void {
    ensureDirectory(this.root)
    appendFileSync(
      this.auditPath,
      `${JSON.stringify({ timestamp: Date.now(), ...input })}\n`,
      { mode: 0o600 },
    )
  }

  writeServerState(state: Record<string, unknown>): string {
    const path = join(this.root, 'server.json')
    atomicJson(path, state)
    return path
  }

  readServerState<T extends Record<string, unknown>>(): T | null {
    return readJson<T>(join(this.root, 'server.json'))
  }

  clearServerState(): void {
    rmSync(join(this.root, 'server.json'), { force: true })
  }
}
