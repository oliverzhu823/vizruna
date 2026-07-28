import { z } from 'zod'
import { registerHandlerWithSchema } from '../registry'
import { getTerminalService } from '../../terminal/terminal-service'
import { authorizeTrustedCwd } from '../../trusted-workspace'

const idSchema = z.string().uuid()

function trustedTerminalCwd(): string {
  const authorized = authorizeTrustedCwd(undefined)
  if (!authorized.ok) throw new Error('TERMINAL_WORKSPACE_REQUIRED')
  return authorized.cwd
}

export function registerTerminalHandlers(): void {
  const service = getTerminalService()
  registerHandlerWithSchema(
    'ipc:terminal.create',
    z.object({
      cwd: z.string().max(4096).optional(),
      cols: z.number().int().min(2).max(400).optional(),
      rows: z.number().int().min(1).max(200).optional(),
    }),
    async (request) => {
      const authorized = authorizeTrustedCwd(request.cwd)
      if (!authorized.ok) {
        throw new Error(
          authorized.error === 'no_trusted_workspace'
            ? 'TERMINAL_WORKSPACE_REQUIRED'
            : 'TERMINAL_CWD_NOT_TRUSTED',
        )
      }
      return service.create({ ...request, cwd: authorized.cwd })
    },
  )
  registerHandlerWithSchema(
    'ipc:terminal.attach',
    z.object({ id: idSchema }),
    async ({ id }) => service.attach(id, trustedTerminalCwd()),
  )
  registerHandlerWithSchema(
    'ipc:terminal.write',
    z.object({ id: idSchema, data: z.string().max(64 * 1024) }),
    async ({ id, data }) => {
      service.write(id, data, trustedTerminalCwd())
      return { ok: true }
    },
  )
  registerHandlerWithSchema(
    'ipc:terminal.resize',
    z.object({
      id: idSchema,
      cols: z.number().int().min(2).max(400),
      rows: z.number().int().min(1).max(200),
    }),
    async ({ id, cols, rows }) => {
      service.resize(id, cols, rows, trustedTerminalCwd())
      return { ok: true }
    },
  )
  registerHandlerWithSchema(
    'ipc:terminal.close',
    z.object({ id: idSchema }),
    async ({ id }) => {
      service.close(id)
      return { ok: true }
    },
  )
}
