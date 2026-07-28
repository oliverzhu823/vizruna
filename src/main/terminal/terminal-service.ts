import { BrowserWindow } from 'electron'
import { homedir } from 'node:os'
import { randomUUID } from 'node:crypto'
import { accessSync, constants, realpathSync, statSync } from 'node:fs'
import * as pty from 'node-pty'
import { selectTerminalShell } from './terminal-shell'
import type {
  TerminalAttachResponse,
  TerminalCreateRequest,
  TerminalCreateResponse,
} from '@shared/terminal'

const MAX_TERMINALS = 8
const MAX_BACKLOG = 128 * 1024
const OUTPUT_BATCH_MS = 16

type TerminalSession = {
  id: string
  cwd: string
  shell: string
  process: pty.IPty
  backlog: string
  pendingOutput: string[]
  outputTimer: ReturnType<typeof setTimeout> | null
  sequence: number
  exited: boolean
}

function terminalWindow(): BrowserWindow | undefined {
  return BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0]
}

function safeCwd(input?: string): string {
  const target = input?.trim() || homedir()
  const resolved = realpathSync(target)
  if (!statSync(resolved).isDirectory()) {
    throw new Error('TERMINAL_CWD_NOT_DIRECTORY')
  }
  return resolved
}

function loginShell(): string {
  return selectTerminalShell({
    platform: process.platform,
    shell: process.env.SHELL,
    comspec: process.env.COMSPEC,
    isExecutable: (path) => {
      try {
        accessSync(path, constants.X_OK)
        return true
      } catch {
        return false
      }
    },
  })
}

function shellArgs(shellPath: string): string[] {
  if (process.platform === 'win32') return []
  return shellPath.endsWith('/zsh') || shellPath.endsWith('/bash') ? ['-l'] : []
}

export class TerminalService {
  private readonly sessions = new Map<string, TerminalSession>()

  create(request: TerminalCreateRequest): TerminalCreateResponse {
    if (this.sessions.size >= MAX_TERMINALS) {
      throw new Error('TERMINAL_LIMIT_REACHED')
    }
    const cwd = safeCwd(request.cwd)
    const shell = loginShell()
    const id = randomUUID()
    const processHandle = pty.spawn(shell, shellArgs(shell), {
      name: 'xterm-256color',
      cols: Math.max(2, Math.min(400, request.cols || 80)),
      rows: Math.max(1, Math.min(200, request.rows || 24)),
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
        PI_DESKTOP_TERMINAL: '1',
      } as Record<string, string>,
    })
    const session: TerminalSession = {
      id,
      cwd,
      shell,
      process: processHandle,
      backlog: '',
      pendingOutput: [],
      outputTimer: null,
      sequence: 0,
      exited: false,
    }
    this.sessions.set(id, session)
    processHandle.onData((data) => {
      if (this.sessions.get(id) !== session) return
      session.pendingOutput.push(data)
      if (!session.outputTimer) {
        session.outputTimer = setTimeout(() => this.flushOutput(session), OUTPUT_BATCH_MS)
      }
    })
    processHandle.onExit(({ exitCode, signal }) => {
      if (this.sessions.get(id) !== session) return
      session.exited = true
      this.flushOutput(session)
      const marker = `\r\n[process exited: ${exitCode}]\r\n`
      this.emitOutput(session, marker)
      const win = terminalWindow()
      if (win && !win.isDestroyed()) {
        win.webContents.send('ipc:terminal-exit', { id, exitCode, signal })
      }
    })
    return { id, cwd, shell }
  }

  attach(id: string, cwd: string): TerminalAttachResponse {
    const session = this.required(id)
    this.assertWorkspace(session, cwd)
    return { data: session.backlog, sequence: session.sequence }
  }

  write(id: string, data: string, cwd: string): void {
    if (data.length > 64 * 1024) throw new Error('TERMINAL_INPUT_TOO_LONG')
    const session = this.required(id)
    this.assertWorkspace(session, cwd)
    if (session.exited) throw new Error('TERMINAL_PROCESS_EXITED')
    session.process.write(data)
  }

  resize(id: string, cols: number, rows: number, cwd: string): void {
    const session = this.required(id)
    this.assertWorkspace(session, cwd)
    if (session.exited) return
    session.process.resize(
      Math.max(2, Math.min(400, Math.floor(cols))),
      Math.max(1, Math.min(200, Math.floor(rows))),
    )
  }

  close(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    if (session.outputTimer) clearTimeout(session.outputTimer)
    session.outputTimer = null
    session.pendingOutput.length = 0
    if (session.exited) return
    try {
      session.process.kill()
    } catch {
      // Already exited.
    }
  }

  dispose(): void {
    for (const id of [...this.sessions.keys()]) this.close(id)
  }

  closeOutside(cwd: string): void {
    let trusted: string
    try {
      trusted = safeCwd(cwd)
    } catch {
      for (const id of [...this.sessions.keys()]) this.close(id)
      return
    }
    for (const session of [...this.sessions.values()]) {
      if (session.cwd !== trusted) this.close(session.id)
    }
  }

  private required(id: string): TerminalSession {
    const session = this.sessions.get(id)
    if (!session) throw new Error('TERMINAL_CLOSED')
    return session
  }

  private flushOutput(session: TerminalSession): void {
    if (session.outputTimer) clearTimeout(session.outputTimer)
    session.outputTimer = null
    if (session.pendingOutput.length === 0) return
    const data = session.pendingOutput.join('')
    session.pendingOutput.length = 0
    this.emitOutput(session, data)
  }

  private emitOutput(session: TerminalSession, data: string): void {
    session.sequence += 1
    session.backlog = `${session.backlog}${data}`.slice(-MAX_BACKLOG)
    const win = terminalWindow()
    if (win && !win.isDestroyed()) {
      win.webContents.send('ipc:terminal-data', {
        id: session.id,
        data,
        sequence: session.sequence,
      })
    }
  }

  private assertWorkspace(session: TerminalSession, cwd: string): void {
    if (session.cwd !== safeCwd(cwd)) {
      throw new Error('TERMINAL_WORKSPACE_CHANGED')
    }
  }
}

let instance: TerminalService | null = null

export function getTerminalService(): TerminalService {
  instance ??= new TerminalService()
  return instance
}
