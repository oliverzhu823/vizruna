import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  send: vi.fn(),
  spawn: vi.fn(),
}))

vi.mock('electron', () => ({
  BrowserWindow: {
    getFocusedWindow: () => ({
      isDestroyed: () => false,
      webContents: { send: mocks.send },
    }),
    getAllWindows: () => [],
  },
}))

vi.mock('node-pty', () => ({ spawn: mocks.spawn }))

import { TerminalService } from './terminal-service'

describe('TerminalService output batching', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mocks.send.mockReset()
    mocks.spawn.mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('coalesces burst output into one sequenced IPC event and attach snapshot', () => {
    let onData: (data: string) => void = () => {}
    let onExit: (event: { exitCode: number; signal?: number }) => void = () => {}
    mocks.spawn.mockReturnValue({
      onData: (handler: typeof onData) => {
        onData = handler
      },
      onExit: (handler: typeof onExit) => {
        onExit = handler
      },
      write: vi.fn(),
      resize: vi.fn(),
      kill: vi.fn(),
    })

    const service = new TerminalService()
    const created = service.create({ cwd: process.cwd(), cols: 80, rows: 24 })
    onData('first')
    onData(' second')

    expect(mocks.send).not.toHaveBeenCalled()
    vi.advanceTimersByTime(16)

    expect(mocks.send).toHaveBeenCalledTimes(1)
    expect(mocks.send).toHaveBeenCalledWith('ipc:terminal-data', {
      id: created.id,
      data: 'first second',
      sequence: 1,
    })
    expect(service.attach(created.id, process.cwd())).toEqual({
      data: 'first second',
      sequence: 1,
    })

    void onExit
    service.dispose()
  })
})
