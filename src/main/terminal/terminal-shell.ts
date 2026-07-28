export type TerminalPlatform = NodeJS.Platform

export function selectTerminalShell(options: {
  platform: TerminalPlatform
  shell?: string
  comspec?: string
  isExecutable: (path: string) => boolean
}): string {
  if (options.platform === 'win32') {
    return options.comspec?.trim() || 'powershell.exe'
  }

  const configured = options.shell?.trim()
  if (configured?.startsWith('/') && options.isExecutable(configured)) {
    return configured
  }

  const fallbacks =
    options.platform === 'darwin'
      ? ['/bin/zsh', '/bin/bash', '/bin/sh']
      : ['/bin/bash', '/bin/sh', '/bin/zsh']
  return fallbacks.find(options.isExecutable) || '/bin/sh'
}
