const SENSITIVE_KEY =
  /(authorization|cookie|secret|password|passwd|token|api[-_]?key|credential|access[-_]?key|private[-_]?key)/i

const VALUE_PATTERNS: Array<[RegExp, string]> = [
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*\b/gi, 'Bearer [REDACTED]'],
  [/\b(sk|rk|pk)-[A-Za-z0-9_-]{12,}\b/g, '$1-[REDACTED]'],
  [/\b(gh[oprsu]_[A-Za-z0-9]{20,})\b/g, '[REDACTED_GITHUB_TOKEN]'],
  [
    /\b(https?|socks5h?):\/\/([^/\s:@]+):([^@\s/]+)@/gi,
    '$1://[REDACTED]:[REDACTED]@',
  ],
  [
    /\b(api[-_]?key|token|authorization|cookie|password)\s*[:=]\s*([^\s,;]+)/gi,
    '$1=[REDACTED]',
  ],
]

export interface RedactionResult<T> {
  value: T
  redactionCount: number
}

function scrubString(value: string, counter: { count: number }): string {
  let output = value
  for (const [pattern, replacement] of VALUE_PATTERNS) {
    output = output.replace(pattern, (match, ...args: unknown[]) => {
      counter.count += 1
      if (replacement.includes('$1')) {
        return replacement.replace('$1', String(args[0] ?? ''))
      }
      return replacement
    })
  }
  if (output.length > 4_000) output = `${output.slice(0, 4_000)}…[TRUNCATED]`
  return output
}

function visit(value: unknown, key: string, depth: number, counter: { count: number }): unknown {
  if (SENSITIVE_KEY.test(key)) {
    counter.count += 1
    return '[REDACTED]'
  }
  if (depth >= 8) return '[MAX_DEPTH]'
  if (Array.isArray(value)) {
    return value.map((item) => visit(item, '', depth + 1, counter))
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([entryKey, entryValue]) => [
        entryKey,
        visit(entryValue, entryKey, depth + 1, counter),
      ]),
    )
  }
  if (typeof value === 'string') return scrubString(value, counter)
  return value
}

export function redactSensitive<T>(value: T): RedactionResult<T> {
  const counter = { count: 0 }
  return {
    value: visit(value, '', 0, counter) as T,
    redactionCount: counter.count,
  }
}

