import { describe, expect, it } from 'vitest'
import {
  providerRouteSetSchema,
  providerRoutingDiagnoseSchema,
  proxyProfileDeleteSchema,
  proxyProfileSaveSchema,
} from './schemas'

describe('provider routing IPC schemas', () => {
  it('accepts a valid local HTTP proxy profile', () => {
    expect(
      proxyProfileSaveSchema.safeParse({
        name: 'V2RayN HTTP',
        protocol: 'http',
        host: '127.0.0.1',
        port: 10809,
      }).success,
    ).toBe(true)
  })

  it('accepts SOCKS5 and a bounded NO_PROXY list', () => {
    expect(
      proxyProfileSaveSchema.safeParse({
        name: 'V2RayN SOCKS',
        protocol: 'socks5',
        host: '127.0.0.1',
        port: 10808,
        noProxy: 'localhost,127.0.0.1,*.corp.example',
      }).success,
    ).toBe(true)
  })

  it('rejects URL schemes, invalid ports, unsupported protocols, and control characters', () => {
    expect(
      proxyProfileSaveSchema.safeParse({
        name: 'bad',
        protocol: 'socks4',
        host: 'http://127.0.0.1',
        port: 70_000,
      }).success,
    ).toBe(false)
    expect(
      proxyProfileSaveSchema.safeParse({
        name: 'bad bypass',
        protocol: 'socks5h',
        host: '127.0.0.1',
        port: 10808,
        noProxy: 'localhost\nHTTP_PROXY=attacker',
      }).success,
    ).toBe(false)
  })

  it('requires a profile ID for profile mode', () => {
    expect(
      providerRouteSetSchema.safeParse({
        provider: 'openai-codex',
        mode: 'profile',
      }).success,
    ).toBe(false)
    expect(
      providerRouteSetSchema.safeParse({
        provider: 'openai-codex',
        mode: 'direct',
      }).success,
    ).toBe(true)
  })

  it('requires explicit confirmation for profile deletion', () => {
    const id = 'c92b918a-84fe-49ba-8e79-6c4f9b3bcad5'
    expect(proxyProfileDeleteSchema.safeParse({ id, confirmed: true }).success).toBe(
      true,
    )
    expect(proxyProfileDeleteSchema.safeParse({ id, confirmed: false }).success).toBe(
      false,
    )
  })

  it('rejects unsafe provider identifiers', () => {
    expect(
      providerRoutingDiagnoseSchema.safeParse({ provider: '../openai' }).success,
    ).toBe(false)
  })
})
