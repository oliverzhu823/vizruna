import { test, expect, _electron as electron } from '@playwright/test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const electronExecutable = require('electron') as string
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const mainEntry = path.join(root, 'out/main/index.js')

test.describe('real provider network routing (non-inference)', () => {
  test.skip(
    process.env.PI_REAL_NETWORK !== '1',
    'set PI_REAL_NETWORK=1 and PI_TEST_PROXY_URL to run local network acceptance',
  )

  test('international provider uses loopback proxy while China provider stays direct', async () => {
    const proxy = new URL(
      process.env.PI_TEST_PROXY_URL || 'http://127.0.0.1:10808',
    )
    if (!['http:', 'https:', 'socks5:', 'socks5h:'].includes(proxy.protocol)) {
      throw new Error('PI_TEST_PROXY_URL must use HTTP, HTTPS, SOCKS5, or SOCKS5H')
    }
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry],
      env: {
        ...process.env,
        PI_E2E: '1',
        ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      },
      timeout: 60_000,
    })
    try {
      const window = await app.firstWindow({ timeout: 45_000 })
      await window.waitForLoadState('domcontentloaded', { timeout: 45_000 })
      const result = await window.evaluate(
        async ({ proxyProtocol, proxyHost, proxyPort }) => {
          const api = (
            window as unknown as {
              piDesktop: {
                invoke: (
                  channel: string,
                  request: unknown,
                ) => Promise<unknown>
              }
            }
          ).piDesktop
          const initial = (await api.invoke(
            'ipc:providerRouting.get',
            {},
          )) as {
            config: {
              providers: Array<{ id: string }>
            }
          }
          const providerIds = initial.config.providers.map((provider) => provider.id)
          const international = ['openai-codex', 'openai'].find((id) =>
            providerIds.includes(id),
          )
          const china = ['deepseek', 'qwen', 'zai'].find((id) =>
            providerIds.includes(id),
          )
          if (!international || !china) {
            throw new Error(
              `Required provider fixtures missing: ${providerIds.join(', ')}`,
            )
          }
          const saved = (await api.invoke('ipc:proxyProfile.save', {
            name: 'Local acceptance proxy',
            protocol: proxyProtocol,
            host: proxyHost,
            port: proxyPort,
          })) as { profile: { id: string } }
          await api.invoke('ipc:providerRouting.set', {
            provider: international,
            mode: 'profile',
            profileId: saved.profile.id,
          })
          await api.invoke('ipc:providerRouting.set', {
            provider: china,
            mode: 'direct',
          })
          const internationalResult = (await api.invoke(
            'ipc:providerRouting.diagnose',
            { provider: international },
          )) as { result: Record<string, unknown> }
          const chinaResult = (await api.invoke(
            'ipc:providerRouting.diagnose',
            { provider: china },
          )) as { result: Record<string, unknown> }
          return {
            international,
            china,
            internationalResult: internationalResult.result,
            chinaResult: chinaResult.result,
          }
        },
        {
          proxyProtocol: proxy.protocol.slice(0, -1),
          proxyHost: proxy.hostname,
          proxyPort: Number(proxy.port),
        },
      )
      expect(result.internationalResult).toMatchObject({
        ok: true,
        route: { mode: 'profile' },
        credentialsSent: false,
        inferenceSent: false,
        systemProxyModified: false,
      })
      expect(result.chinaResult).toMatchObject({
        ok: true,
        route: { mode: 'direct' },
        credentialsSent: false,
        inferenceSent: false,
        systemProxyModified: false,
      })
    } finally {
      await app.close()
    }
  })
})
