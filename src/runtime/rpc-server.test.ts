import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { VizrunaHeadlessRuntime } from './headless-runtime'
import { RuntimeRpcServer } from './rpc-server'
import { RuntimeStore } from './runtime-store'

const roots: string[] = []
const servers: RuntimeRpcServer[] = []

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.stop()))
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

async function fixture(): Promise<{ origin: string; token: string }> {
  const root = mkdtempSync(join(tmpdir(), 'vizruna-rpc-'))
  roots.push(root)
  const server = new RuntimeRpcServer({
    token: 'test-secret-token',
    runtime: new VizrunaHeadlessRuntime(new RuntimeStore(root)),
  })
  servers.push(server)
  const state = await server.start()
  return { origin: `http://127.0.0.1:${state.port}`, token: server.token }
}

describe('Runtime RPC v1', () => {
  it('rejects unauthenticated requests and exposes authenticated capability negotiation', async () => {
    const { origin, token } = await fixture()
    expect((await fetch(`${origin}/api/v1/health`)).status).toBe(401)
    const response = await fetch(`${origin}/api/v1/health`, { headers: { Authorization: `Bearer ${token}` } })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ ok: true, rpcVersion: '1.0', piRuntimeVersion: '0.84.4' })
  })

  it('explains permissions through the stable RPC envelope', async () => {
    const { origin, token } = await fixture()
    const response = await fetch(`${origin}/api/v1/rpc`, {
      method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: 'permission-test', method: 'permission.explain', params: {
        mode: 'collaborate', requestedTools: ['read', 'write', 'bash'], approvedTools: [],
      } }),
    })
    expect(await response.json()).toMatchObject({
      id: 'permission-test', ok: true,
      result: { permission: { allowedTools: ['read', 'write'], deniedTools: ['bash'] } },
    })
  })
})
