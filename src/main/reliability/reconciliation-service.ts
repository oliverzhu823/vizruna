import { access } from 'node:fs/promises'
import type {
  ReconciliationIssue,
  ReconciliationSnapshot,
} from '@shared/reliability'
import { sqliteIndex } from '../sqlite-index'
import { getManagedWorktreeService } from '../worktree/managed-worktree-instance'

async function missing(path: string | undefined): Promise<boolean> {
  if (!path) return true
  return access(path)
    .then(() => false)
    .catch(() => true)
}

export async function buildReconciliationSnapshot(
  rootWorkspacePath?: string,
): Promise<ReconciliationSnapshot> {
  const service = getManagedWorktreeService()
  const result = await service.reconcile(rootWorkspacePath)
  const issues: ReconciliationIssue[] = []
  for (const worktree of result.worktrees) {
    if (worktree.status !== 'missing') continue
    issues.push({
      kind: 'missing-worktree-directory',
      severity: 'error',
      resourceId: worktree.id,
      path: worktree.worktreePath,
      message: 'SQLite 记录存在，但磁盘目录或 Git worktree 登记缺失。',
      suggestion: '先检查磁盘与 Git 状态；确认无未合并成果后再显式移除或重建。',
    })
  }
  for (const entry of result.unregistered) {
    issues.push({
      kind: 'unregistered-git-worktree',
      severity: 'warning',
      resourceId: entry.worktreePath,
      path: entry.worktreePath,
      message: 'Git 中存在受管目录内的 worktree，但 SQLite 没有对应记录。',
      suggestion: '核对来源并由管理员决定登记或清理；系统不会自动删除。',
    })
  }

  const relationships = sqliteIndex.listAgentRelationships(
    rootWorkspacePath ? { rootWorkspacePath } : undefined,
  )
  for (const relationship of relationships) {
    if (await missing(relationship.childWorkspacePath)) {
      issues.push({
        kind: 'missing-child-workspace',
        severity: 'error',
        resourceId: relationship.id,
        path: relationship.childWorkspacePath,
        message: '子 Agent 关系仍存在，但其工作目录已缺失。',
        suggestion: '保留关系与审计证据；检查对应 worktree 后再重试或取消任务。',
      })
    }
    if (relationship.childSessionFile && (await missing(relationship.childSessionFile))) {
      issues.push({
        kind: 'missing-child-session',
        severity: 'warning',
        resourceId: relationship.id,
        path: relationship.childSessionFile,
        message: '子 Agent 的会话文件路径已缺失。',
        suggestion: '不要重写主会话；可从任务证据判断是否需要重新执行子任务。',
      })
    }
  }

  return {
    generatedAt: Date.now(),
    issues,
    worktrees: result.worktrees,
    note: '对账只更新可观察状态并给出建议，不会删除 Git worktree、分支或 Pi JSONL。',
  }
}

