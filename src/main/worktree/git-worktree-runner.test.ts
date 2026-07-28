import { describe, expect, it } from 'vitest'
import { parseGitWorktreePorcelain } from './git-worktree-runner'

describe('parseGitWorktreePorcelain', () => {
  it('parses main, branch, detached and prunable entries', () => {
    const entries = parseGitWorktreePorcelain(
      [
        'worktree /repo',
        'HEAD abc123',
        'branch refs/heads/main',
        '',
        'worktree /repo worktrees/task',
        'HEAD def456',
        'branch refs/heads/pi-agent/task',
        'prunable gitdir file points to non-existent location',
        '',
        'worktree /detached',
        'HEAD 999999',
        'detached',
        '',
      ].join('\n'),
    )
    expect(entries).toEqual([
      {
        path: '/repo',
        head: 'abc123',
        branchName: 'main',
        detached: false,
        prunable: false,
      },
      {
        path: '/repo worktrees/task',
        head: 'def456',
        branchName: 'pi-agent/task',
        detached: false,
        prunable: true,
      },
      {
        path: '/detached',
        head: '999999',
        detached: true,
        prunable: false,
      },
    ])
  })
})
