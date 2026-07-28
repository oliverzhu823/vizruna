import { describe, expect, it } from 'vitest'
import {
  noProxyMatches,
  providerEnvironmentForRoute,
  type ProviderRoutingRuntime,
} from './provider-routing'

describe('providerEnvironmentForRoute', () => {
  it('forces direct providers to bypass every ambient proxy', () => {
    const runtime: ProviderRoutingRuntime = {
      routes: { deepseek: { mode: 'direct' } },
      systemProxyUrl: 'http://127.0.0.1:10809/',
    }

    expect(providerEnvironmentForRoute(runtime, 'deepseek')).toEqual({
      NO_PROXY: '*',
      no_proxy: '*',
    })
  })

  it('isolates an explicit provider profile from ambient NO_PROXY', () => {
    const runtime: ProviderRoutingRuntime = {
      routes: {
        'openai-codex': {
          mode: 'profile',
          proxyUrl: 'http://127.0.0.1:10809/',
        },
      },
    }

    expect(providerEnvironmentForRoute(runtime, 'openai-codex')).toEqual({
      HTTP_PROXY: 'http://127.0.0.1:10809/',
      HTTPS_PROXY: 'http://127.0.0.1:10809/',
      ALL_PROXY: 'http://127.0.0.1:10809/',
      http_proxy: 'http://127.0.0.1:10809/',
      https_proxy: 'http://127.0.0.1:10809/',
      all_proxy: 'http://127.0.0.1:10809/',
      NO_PROXY: '__pi_enterprise_no_bypass__',
      no_proxy: '__pi_enterprise_no_bypass__',
    })
  })

  it('applies a profile-specific NO_PROXY list', () => {
    const runtime: ProviderRoutingRuntime = {
      routes: {
        openai: {
          mode: 'profile',
          proxyUrl: 'socks5://127.0.0.1:10808/',
          noProxy: 'localhost,*.corp.example',
        },
      },
    }

    expect(providerEnvironmentForRoute(runtime, 'openai')).toMatchObject({
      ALL_PROXY: 'socks5://127.0.0.1:10808/',
      NO_PROXY: 'localhost,*.corp.example',
      no_proxy: 'localhost,*.corp.example',
    })
  })

  it('uses the detected system proxy only for system-mode providers', () => {
    const runtime: ProviderRoutingRuntime = {
      routes: {
        openai: { mode: 'system' },
        qwen: { mode: 'direct' },
      },
      systemProxyUrl: 'http://127.0.0.1:7890/',
      systemNoProxy: 'localhost',
    }

    expect(providerEnvironmentForRoute(runtime, 'openai').HTTPS_PROXY).toBe(
      'http://127.0.0.1:7890/',
    )
    expect(providerEnvironmentForRoute(runtime, 'openai').NO_PROXY).toBe('localhost')
    expect(providerEnvironmentForRoute(runtime, 'qwen')).toEqual({
      NO_PROXY: '*',
      no_proxy: '*',
    })
  })
})

describe('noProxyMatches', () => {
  it('matches wildcard, exact, subdomain, and port-qualified entries', () => {
    expect(noProxyMatches(new URL('https://api.example.com'), '*')).toBe(true)
    expect(
      noProxyMatches(
        new URL('https://api.corp.example'),
        'localhost,*.corp.example',
      ),
    ).toBe(true)
    expect(
      noProxyMatches(new URL('https://api.example.com:8443'), 'api.example.com:443'),
    ).toBe(false)
    expect(
      noProxyMatches(new URL('https://api.example.com'), 'api.example.com:443'),
    ).toBe(true)
  })
})
