export interface TerminalCreateRequest {
  cwd?: string
  cols?: number
  rows?: number
}

export interface TerminalCreateResponse {
  id: string
  cwd: string
  shell: string
}

export interface TerminalAttachResponse {
  data: string
  sequence: number
}

export interface TerminalDataEvent {
  id: string
  data: string
  sequence: number
}

export interface TerminalExitEvent {
  id: string
  exitCode: number
  signal?: number
}
