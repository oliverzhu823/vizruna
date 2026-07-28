import { randomUUID } from 'node:crypto'
import type { AuditEventInput, AuditEventRecord } from '@shared/audit-events'
import { sqliteIndex } from '../sqlite-index'
import type { AuditQuery, AuditQueryResult } from '@shared/reliability'
import { redactSensitive } from '../reliability/redaction'

export function createAuditEvent(input: AuditEventInput): AuditEventRecord {
  return {
    ...input,
    id: randomUUID(),
    timestamp: input.timestamp ?? Date.now(),
    details: redactSensitive(input.details ?? {}).value,
  }
}

export const auditRepository = {
  write(input: AuditEventInput): AuditEventRecord {
    const event = createAuditEvent(input)
    sqliteIndex.addAuditEvent(event)
    return event
  },

  list(limit = 500): AuditEventRecord[] {
    return sqliteIndex.queryAuditEvents({ limit }).events
  },

  query(query: AuditQuery = {}): AuditQueryResult {
    return sqliteIndex.queryAuditEvents(query)
  },
}
