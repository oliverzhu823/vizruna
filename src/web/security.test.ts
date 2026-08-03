import { describe, expect, it } from 'vitest'
import {
  constantTimeEqual,
  isExpectedLoopbackHost,
  isSameOriginRequest,
  readCookie,
} from './security'

describe('Vizruna-web local security boundary', () => {
  it('accepts only the exact bound loopback Host header', () => {
    expect(isExpectedLoopbackHost('127.0.0.1:43117', 43117)).toBe(true)
    expect(isExpectedLoopbackHost('localhost:43117', 43117)).toBe(false)
    expect(isExpectedLoopbackHost('evil.example', 43117)).toBe(false)
    expect(isExpectedLoopbackHost('127.0.0.1:43118', 43117)).toBe(false)
  })

  it('rejects cross-origin and cross-site browser requests', () => {
    const expectedOrigin = 'http://127.0.0.1:43117'
    expect(isSameOriginRequest({ expectedOrigin, originHeader: expectedOrigin, secFetchSite: 'same-origin' })).toBe(true)
    expect(isSameOriginRequest({ expectedOrigin })).toBe(true)
    expect(isSameOriginRequest({ expectedOrigin, originHeader: 'https://evil.example' })).toBe(false)
    expect(isSameOriginRequest({ expectedOrigin, secFetchSite: 'cross-site' })).toBe(false)
  })

  it('parses session cookies without throwing on malformed encoding', () => {
    expect(readCookie('a=1; vizruna_web_session=hello%20world', 'vizruna_web_session')).toBe('hello world')
    expect(readCookie('vizruna_web_session=%E0%A4%A', 'vizruna_web_session')).toBeNull()
  })

  it('compares launch and session credentials exactly', () => {
    expect(constantTimeEqual('same-token', 'same-token')).toBe(true)
    expect(constantTimeEqual('same-token', 'other-token')).toBe(false)
    expect(constantTimeEqual('short', 'longer')).toBe(false)
  })
})
