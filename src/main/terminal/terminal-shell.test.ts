import { describe, expect, it } from 'vitest'
import { selectTerminalShell } from './terminal-shell'

describe('selectTerminalShell', () => {
  it('ignores POSIX SHELL on Windows', () => {
    expect(
      selectTerminalShell({
        platform: 'win32',
        shell: '/usr/bin/bash',
        comspec: 'C:\\Windows\\System32\\cmd.exe',
        isExecutable: () => true,
      }),
    ).toBe('C:\\Windows\\System32\\cmd.exe')
  })

  it('uses a valid configured POSIX shell', () => {
    expect(
      selectTerminalShell({
        platform: 'darwin',
        shell: '/opt/homebrew/bin/fish',
        isExecutable: (path) => path === '/opt/homebrew/bin/fish',
      }),
    ).toBe('/opt/homebrew/bin/fish')
  })

  it('falls back to bash then sh on Linux', () => {
    expect(
      selectTerminalShell({
        platform: 'linux',
        isExecutable: (path) => path === '/bin/sh',
      }),
    ).toBe('/bin/sh')
  })
})
