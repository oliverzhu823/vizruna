import http from 'node:http'
import net from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'
import { getGlobalDispatcher, setGlobalDispatcher, Agent } from 'undici'
import type { ProviderRoutingRuntime } from '@shared/provider-routing'
import { withProviderAuthNetwork } from './auth-network-scope'

async function listen(server: http.Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      server.off('error', reject)
      resolve()
    })
  })
  const address = server.address()
  if (!address || typeof address === 'string') {
    throw new Error('Server did not bind to TCP')
  }
  return address.port
}

async function close(server: http.Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

function tunnelingProxy(onConnect: () => void): http.Server {
  const proxy = http.createServer((_request, response) => {
    response.writeHead(502)
    response.end()
  })
  proxy.on('connect', (request, clientSocket, head) => {
    const [host, portText] = String(request.url).split(':')
    const upstream = net.createConnection(
      { host, port: Number(portText) },
      () => {
        onConnect()
        clientSocket.write('HTTP/1.1 200 Connection Established\r\n\r\n')
        if (head.length > 0) upstream.write(head)
        upstream.pipe(clientSocket)
        clientSocket.pipe(upstream)
      },
    )
    upstream.on('error', () => clientSocket.destroy())
    clientSocket.on('error', () => upstream.destroy())
  })
  return proxy
}

describe('Provider auth network scope', () => {
  const originalDispatcher = getGlobalDispatcher()

  afterEach(() => {
    setGlobalDispatcher(originalDispatcher)
  })

  it('uses only the selected provider route without replacing the global dispatcher', async () => {
    let proxyConnections = 0
    const target = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('target')
    })
    const proxy = tunnelingProxy(() => {
      proxyConnections += 1
    })
    const [targetPort, proxyPort] = await Promise.all([
      listen(target),
      listen(proxy),
    ])
    const previous = new Agent()
    setGlobalDispatcher(previous)
    const runtime: ProviderRoutingRuntime = {
      routes: {
        openai: {
          mode: 'profile',
          proxyUrl: `http://127.0.0.1:${proxyPort}`,
        },
        deepseek: { mode: 'direct' },
      },
    }

    try {
      const proxied = await withProviderAuthNetwork(
        runtime,
        'openai',
        async () => {
          expect(getGlobalDispatcher()).toBe(previous)
          const response = await fetch(
            `http://127.0.0.1:${targetPort}/openai-login`,
          )
          return response.text()
        },
      )
      expect(proxied).toBe('target')
      expect(proxyConnections).toBeGreaterThan(0)
      expect(getGlobalDispatcher()).toBe(previous)

      const afterOpenAi = proxyConnections
      await withProviderAuthNetwork(runtime, 'deepseek', async () => {
        const response = await fetch(
          `http://127.0.0.1:${targetPort}/deepseek-login`,
        )
        expect(await response.text()).toBe('target')
      })
      expect(proxyConnections).toBe(afterOpenAi)
      expect(getGlobalDispatcher()).toBe(previous)
    } finally {
      await previous.close()
      await Promise.all([close(target), close(proxy)])
    }
  })

  it('restores the dispatcher when the login request fails', async () => {
    const previous = new Agent()
    setGlobalDispatcher(previous)
    const runtime: ProviderRoutingRuntime = {
      routes: { openai: { mode: 'direct' } },
    }

    await expect(
      withProviderAuthNetwork(runtime, 'openai', async () => {
        expect(getGlobalDispatcher()).toBe(previous)
        throw new Error('token exchange failed')
      }),
    ).rejects.toThrow('token exchange failed')
    expect(getGlobalDispatcher()).toBe(previous)
    await previous.close()
  })

  it('does not route concurrent unscoped Main requests through the login proxy', async () => {
    let proxyConnections = 0
    const target = http.createServer((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/plain' })
      response.end('target')
    })
    const proxy = tunnelingProxy(() => {
      proxyConnections += 1
    })
    const [targetPort, proxyPort] = await Promise.all([
      listen(target),
      listen(proxy),
    ])
    const previous = new Agent()
    setGlobalDispatcher(previous)
    const runtime: ProviderRoutingRuntime = {
      routes: {
        openai: {
          mode: 'profile',
          proxyUrl: `http://127.0.0.1:${proxyPort}`,
        },
      },
    }
    let releaseLogin!: () => void
    const loginGate = new Promise<void>((resolve) => {
      releaseLogin = resolve
    })

    try {
      const loginRequest = withProviderAuthNetwork(
        runtime,
        'openai',
        async () => {
          await loginGate
          return fetch(`http://127.0.0.1:${targetPort}/login`)
        },
      )
      const unscoped = await fetch(
        `http://127.0.0.1:${targetPort}/update-check`,
      )
      expect(await unscoped.text()).toBe('target')
      expect(proxyConnections).toBe(0)

      releaseLogin()
      expect((await loginRequest).status).toBe(200)
      expect(proxyConnections).toBeGreaterThan(0)
      expect(getGlobalDispatcher()).toBe(previous)
    } finally {
      releaseLogin()
      await previous.close()
      await Promise.all([close(target), close(proxy)])
    }
  })
})
