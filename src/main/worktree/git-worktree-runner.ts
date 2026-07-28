import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export interface GitCommandResult {
  ok: boolean
  stdout: string
  stderr: string
  exitCode: number
}

export interface GitCommandRunner {
  run(cwd: string, args: string[], options?: { timeoutMs?: number }): Promise<GitCommandResult>
}

function exitCode(error: unknown): number {
  const code = (error as { code?: unknown })?.code
  return typeof code === 'number' ? code : 1
}

export class ExecFileGitCommandRunner implements GitCommandRunner {
  async run(
    cwd: string,
    args: string[],
    options: { timeoutMs?: number } = {},
  ): Promise<GitCommandResult> {
    try {
      const result = await execFileAsync('git', args, {
        cwd,
        encoding: 'utf8',
        timeout: options.timeoutMs ?? 15_000,
        maxBuffer: 8 * 1024 * 1024,
        windowsHide: true,
      })
      return {
        ok: true,
        stdout: String(result.stdout ?? ''),
        stderr: String(result.stderr ?? ''),
        exitCode: 0,
      }
    } catch (error) {
      const detail = error as { stdout?: unknown; stderr?: unknown }
      return {
        ok: false,
        stdout: String(detail.stdout ?? ''),
        stderr: String(detail.stderr ?? (error as Error)?.message ?? ''),
        exitCode: exitCode(error),
      }
    }
  }
}

export interface GitWorktreeListEntry {
  path: string
  head?: string
  branchName?: string
  detached: boolean
  prunable: boolean
}

export function parseGitWorktreePorcelain(output: string): GitWorktreeListEntry[] {
  const entries: GitWorktreeListEntry[] = []
  let current: GitWorktreeListEntry | null = null
  const flush = () => {
    if (current?.path) entries.push(current)
    current = null
  }

  for (const line of output.split(/\r?\n/)) {
    if (!line.trim()) {
      flush()
      continue
    }
    if (line.startsWith('worktree ')) {
      flush()
      current = {
        path: line.slice('worktree '.length),
        detached: false,
        prunable: false,
      }
      continue
    }
    if (!current) continue
    if (line.startsWith('HEAD ')) current.head = line.slice('HEAD '.length)
    else if (line.startsWith('branch refs/heads/')) {
      current.branchName = line.slice('branch refs/heads/'.length)
    } else if (line === 'detached') current.detached = true
    else if (line === 'prunable' || line.startsWith('prunable ')) current.prunable = true
  }
  flush()
  return entries
}
