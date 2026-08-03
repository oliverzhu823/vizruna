import { timingSafeEqual } from 'node:crypto'

export function constantTimeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left)
  const b = Buffer.from(right)
  return a.length === b.length && timingSafeEqual(a, b)
}

export function readCookie(cookieHeader: string | undefined, name: string): string | null {
  for (const part of String(cookieHeader || '').split(';')) {
    const [key, ...value] = part.trim().split('=')
    if (key !== name) continue
    try {
      return decodeURIComponent(value.join('='))
    } catch {
      return null
    }
  }
  return null
}

export function isExpectedLoopbackHost(hostHeader: string | undefined, port: number): boolean {
  return hostHeader === `127.0.0.1:${port}`
}

export function isSameOriginRequest(input: {
  originHeader?: string
  secFetchSite?: string
  expectedOrigin: string
}): boolean {
  if (input.originHeader && input.originHeader !== input.expectedOrigin) return false
  return input.secFetchSite !== 'cross-site'
}
