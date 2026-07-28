import http from 'node:http'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import type { AgentSessionServices } from '@earendil-works/pi-coding-agent'
import type { ProviderRoutingRuntime } from '@shared/provider-routing'
import {
  disposeProviderRoutingTransport,
  installProviderRouting,
} from '../worker/provider-routing-runtime'

type ModelRuntime = AgentSessionServices['modelRuntime']

async function listen(server: net.Server | http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Server did not bind to TCP')
  return address.port
}

async function close(server: net.Server | http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function createTestSocks5Server(onConnect: () => void): net.Server {
  return net.createServer((client) => {
    let buffer = Buffer.alloc(0)
    let state: 'greeting' | 'request' = 'greeting'

    const fail = () => client.destroy()
    const onData = (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk])
      while (true) {
        if (state === 'greeting') {
          if (buffer.length < 2) return
          const length = 2 + buffer[1]
          if (buffer.length < length || buffer[0] !== 5) return fail()
          buffer = buffer.subarray(length)
          client.write(Buffer.from([5, 0]))
          state = 'request'
          continue
        }

        if (buffer.length < 5 || buffer[0] !== 5 || buffer[1] !== 1) return
        const addressType = buffer[3]
        let host = ''
        let addressEnd = 0
        if (addressType === 1) {
          addressEnd = 8
          if (buffer.length < addressEnd + 2) return
          host = [...buffer.subarray(4, addressEnd)].join('.')
        } else if (addressType === 3) {
          const hostLength = buffer[4]
          addressEnd = 5 + hostLength
          if (buffer.length < addressEnd + 2) return
          host = buffer.subarray(5, addressEnd).toString('utf8')
        } else {
          return fail()
        }
        const port = buffer.readUInt16BE(addressEnd)
        const pending = buffer.subarray(addressEnd + 2)
        client.off('data', onData)
        onConnect()
        const upstream = net.createConnection({ host, port })
        upstream.once('connect', () => {
          client.write(Buffer.from([5, 0, 0, 1, 127, 0, 0, 1, 0, 0]))
          if (pending.length > 0) upstream.write(pending)
          client.pipe(upstream)
          upstream.pipe(client)
        })
        upstream.once('error', fail)
        client.once('error', () => upstream.destroy())
        return
      }
    }
    client.on('data', onData)
  })
}

describe('Worker provider routing transport', () => {
  afterEach(async () => {
    await disposeProviderRoutingTransport()
  })

  it('routes real fetch traffic through SOCKS5, then switches to direct and honors NO_PROXY', async () => {
    let socksConnections = 0
    const socksServer = createTestSocks5Server(() => {
      socksConnections += 1
    })
    const targetServer = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end('{"ok":true}')
    })
    const [socksPort, targetPort] = await Promise.all([
      listen(socksServer),
      listen(targetServer),
    ])
    let runtime: ProviderRoutingRuntime = {
      routes: {
        openai: {
          mode: 'profile',
          proxyUrl: `socks5://127.0.0.1:${socksPort}`,
        },
      },
    }
    const modelRuntime = {
      getAuth: async () => ({
        auth: { apiKey: 'test-key' },
      }),
    } as unknown as ModelRuntime
    installProviderRouting(modelRuntime, () => runtime)

    try {
      const proxiedAuth = await modelRuntime.getAuth({
        provider: 'openai',
      } as never)
      expect(proxiedAuth).toMatchObject({
        env: {
          NO_PROXY: '__pi_enterprise_no_bypass__',
        },
      })
      expect(new URL(proxiedAuth?.env?.HTTPS_PROXY || '').hostname).toBe(
        '127.0.0.1',
      )
      const proxiedResponse = await fetch(`http://127.0.0.1:${targetPort}/proxied`)
      expect(await proxiedResponse.json()).toEqual({ ok: true })
      expect(socksConnections).toBeGreaterThan(0)
      const afterProxy = socksConnections

      runtime = { routes: { openai: { mode: 'direct' } } }
      await modelRuntime.getAuth({ provider: 'openai' } as never)
      const directResponse = await fetch(`http://127.0.0.1:${targetPort}/direct`)
      expect(directResponse.status).toBe(200)
      expect(socksConnections).toBe(afterProxy)

      runtime = {
        routes: {
          openai: {
            mode: 'profile',
            proxyUrl: `socks5h://127.0.0.1:${socksPort}`,
            noProxy: '127.0.0.1',
          },
        },
      }
      const bypassAuth = await modelRuntime.getAuth({
        provider: 'openai',
      } as never)
      expect(bypassAuth).toMatchObject({
        env: { NO_PROXY: '127.0.0.1' },
      })
      const bypassResponse = await fetch(`http://127.0.0.1:${targetPort}/bypass`)
      expect(bypassResponse.status).toBe(200)
      expect(socksConnections).toBe(afterProxy)
    } finally {
      await disposeProviderRoutingTransport()
      await Promise.all([close(socksServer), close(targetServer)])
    }
  })
})
