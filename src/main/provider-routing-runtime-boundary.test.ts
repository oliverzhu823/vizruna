import { afterAll, describe, expect, it } from 'vitest'
import type { AgentSessionServices } from '@earendil-works/pi-coding-agent'
import type { ProviderRoutingRuntime } from '@shared/provider-routing'
import {
  disposeProviderRoutingTransport,
  installProviderRouting,
} from '../worker/provider-routing-runtime'

type ModelRuntime = AgentSessionServices['modelRuntime']

describe('Pi request provider routing boundary', () => {
  afterAll(async () => {
    await disposeProviderRoutingTransport()
  })

  it('resolves routing for the current provider on every request without mutating process.env', async () => {
    let runtime: ProviderRoutingRuntime = {
      routes: {
        openai: {
          mode: 'profile',
          proxyUrl: 'http://127.0.0.1:10809/',
        },
        deepseek: { mode: 'direct' },
      },
    }
    const originalHttpProxy = process.env.HTTP_PROXY
    const modelRuntime = {
      getAuth: async () => ({
        auth: { apiKey: 'test-key' },
        env: { PROVIDER_SCOPED: 'yes' },
      }),
    } as unknown as ModelRuntime

    installProviderRouting(modelRuntime, () => runtime)
    const openai = await modelRuntime.getAuth({
      provider: 'openai',
    } as never)
    expect(openai).toMatchObject({
      env: {
        PROVIDER_SCOPED: 'yes',
        HTTPS_PROXY: 'http://127.0.0.1:10809/',
        NO_PROXY: '__pi_enterprise_no_bypass__',
      },
    })

    const deepseek = await modelRuntime.getAuth({
      provider: 'deepseek',
    } as never)
    expect(deepseek).toMatchObject({
      env: { PROVIDER_SCOPED: 'yes', NO_PROXY: '*', no_proxy: '*' },
    })

    runtime = { routes: { openai: { mode: 'direct' } } }
    const changedWithoutRestart = await modelRuntime.getAuth({
      provider: 'openai',
    } as never)
    expect(changedWithoutRestart).toMatchObject({
      env: { NO_PROXY: '*' },
    })
    expect(process.env.HTTP_PROXY).toBe(originalHttpProxy)
  })

  it('preserves auth failures and installs only once', async () => {
    let calls = 0
    const modelRuntime = {
      getAuth: async () => {
        calls += 1
        return undefined
      },
    } as unknown as ModelRuntime
    const runtime = () =>
      ({
        routes: { openai: { mode: 'direct' } },
      }) satisfies ProviderRoutingRuntime

    installProviderRouting(modelRuntime, runtime)
    installProviderRouting(modelRuntime, runtime)
    await expect(
      modelRuntime.getAuth({ provider: 'openai' } as never),
    ).resolves.toBeUndefined()
    expect(calls).toBe(1)
  })
})
