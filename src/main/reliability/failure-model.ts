import type {
  FailureCode,
  FailureEnvelope,
  FailureStage,
} from '@shared/reliability'

interface FailureRule {
  pattern: RegExp
  code: FailureCode
  stage: FailureStage
  retryable: boolean
  userAction: string
}

const RULES: FailureRule[] = [
  {
    pattern: /\b(401|invalid[_ -]?api[_ -]?key|unauthori[sz]ed|authentication failed)\b/i,
    code: 'AUTHENTICATION_FAILED',
    stage: 'authentication',
    retryable: false,
    userAction: '检查该模型供应商的登录状态或 API Key，然后重新测试连接。',
  },
  {
    pattern: /\b((country|region|territory).*(unsupported|not supported|restricted|unavailable)|(unsupported|not supported|restricted|unavailable).*(country|region|territory))\b/i,
    code: 'REGION_RESTRICTED',
    stage: 'authentication',
    retryable: false,
    userAction: '检查该供应商的地区政策与当前路由出口；不要修改其他供应商的全局网络设置。',
  },
  {
    pattern: /\b(oauth|authorization).*(callback|redirect|state mismatch|missing authorization code)|\b(callback|redirect|state mismatch).*(oauth|authorization)\b/i,
    code: 'OAUTH_CALLBACK_FAILED',
    stage: 'authentication',
    retryable: true,
    userAction: '重新发起浏览器或设备码登录；仍失败时改用 API Key，并检查回调地址是否被防火墙阻止。',
  },
  {
    pattern: /\b(enotfound|econnrefused|econnreset|etimedout|network|fetch failed|socket hang up)\b/i,
    code: 'NETWORK_UNREACHABLE',
    stage: 'network',
    retryable: true,
    userAction: '检查该供应商的直连/系统代理/代理配置档，并重试连接诊断。',
  },
  {
    pattern: /\b(worker|utility process).*(exit(?:ed)?|crash(?:ed)?|terminated|closed)\b/i,
    code: 'WORKER_EXITED',
    stage: 'worker',
    retryable: true,
    userAction: '重新打开会话以启动新 Worker；诊断包会保留退出码与运行快照。',
  },
  {
    pattern: /\b(session|jsonl).*(externally modified|external change|changed by another process)\b/i,
    code: 'SESSION_EXTERNALLY_MODIFIED',
    stage: 'storage',
    retryable: false,
    userAction: '暂停当前会话写入，重新扫描会话并确认其他 Pi/CLI 进程已经停止。',
  },
  {
    pattern: /\b(worktree|git).*(not found|missing|unsafe|unavailable|failed)\b/i,
    code: 'WORKTREE_UNAVAILABLE',
    stage: 'worktree',
    retryable: false,
    userAction: '运行元数据对账，确认 Git 和磁盘状态后再决定重建或移除工作树。',
  },
  {
    pattern: /\b(enospc|no space left|disk full|read-only file system|eacces).*\b/i,
    code: 'DISK_WRITE_FAILED',
    stage: 'storage',
    retryable: false,
    userAction: '释放磁盘空间或修复目录权限，然后重试；不要删除 Pi 会话 JSONL。',
  },
  {
    pattern: /\b(sqlite_busy|database is locked|database table is locked)\b/i,
    code: 'SQLITE_BUSY',
    stage: 'storage',
    retryable: true,
    userAction: '关闭占用元数据库的其他进程后重试。',
  },
  {
    pattern: /\b(sqlite_corrupt|database disk image is malformed|file is not a database|integrity check failed)\b/i,
    code: 'SQLITE_CORRUPT',
    stage: 'recovery',
    retryable: false,
    userAction: '从已验证的元数据备份恢复；恢复不会修改 Pi 会话 JSONL。',
  },
  {
    pattern: /\b(timeout|timed out|deadline exceeded)\b/i,
    code: 'TIMEOUT',
    stage: 'unknown',
    retryable: true,
    userAction: '确认网络与 Worker 状态后重试，必要时提高任务超时时间。',
  },
  {
    pattern: /\b(cancelled|canceled|aborted|interrupted)\b/i,
    code: 'CANCELLED',
    stage: 'unknown',
    retryable: true,
    userAction: '确认任务仍有必要后重新开始。',
  },
]

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return 'Unknown failure'
  }
}

export function failureFromUnknown(
  error: unknown,
  fallbackStage: FailureStage = 'unknown',
  now = Date.now(),
): FailureEnvelope {
  const message = errorMessage(error).slice(0, 2_000)
  const rule = RULES.find((candidate) => candidate.pattern.test(message))
  if (rule) {
    return {
      code: rule.code,
      stage: rule.stage,
      message,
      retryable: rule.retryable,
      userAction: rule.userAction,
      timestamp: now,
    }
  }
  return {
    code: 'UNKNOWN',
    stage: fallbackStage,
    message,
    retryable: false,
    userAction: '导出脱敏诊断包并交由管理员分析。',
    timestamp: now,
  }
}
