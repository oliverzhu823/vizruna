// AppEvent - Unified event model for Renderer/Main/Worker
import type { OrchestrationEvent } from './orchestration'

export interface AppEventBase {
  seq: number
  workspaceId: string
  sessionId?: string
  /** pi session JSONL path — stable routing key across UI / Worker */
  sessionFile?: string
  runId?: string
  turnId?: string
  timestamp: number
}

export interface MessageEvent extends AppEventBase {
  type: 'message'
  role: 'user' | 'assistant' | 'system'
  phase: 'start' | 'delta' | 'end'
  text?: string
  /** assistant 流：正文 vs 思维链 */
  contentKind?: 'text' | 'thinking'
  /** pi JSONL entry id（跳转 /tree 用） */
  sessionEntryId?: string
}

export interface ToolEvent extends AppEventBase {
  type: 'tool'
  toolCallId: string
  toolName: string
  phase: 'start' | 'update' | 'end'
  input?: unknown
  output?: unknown
  details?: unknown
  isError?: boolean
}

export interface RunContextSnapshot {
  /** Pi AgentSession.getContextUsage() estimate at this exact run boundary. */
  tokens: number | null
  contextWindow: number
  percent: number | null
  messageCount: number
  capturedAt: number
}

export interface RunResourceItem {
  name: string
  source?: string
  path?: string
}

/** Resources exposed by the live Pi AgentSession for this run, not catalog discovery. */
export interface RunResourceEvidence {
  capturedAt: number
  activeTools: RunResourceItem[]
  skills: RunResourceItem[]
  promptTemplates: RunResourceItem[]
  extensions: RunResourceItem[]
  contextFiles: RunResourceItem[]
  systemPromptSources: RunResourceItem[]
}

export interface FileEvent extends AppEventBase {
  type: 'file'
  source: 'edit' | 'write' | 'bash-diff' | 'git'
  path: string
  changeType: 'added' | 'modified' | 'deleted' | 'renamed'
}

export interface RunEvent extends AppEventBase {
  type: 'run'
  phase: 'started' | 'running' | 'idle' | 'failed' | 'cancelled' | 'state'
  model?: string
  thinkingLevel?: string
  /**
   * SDK could not restore the session's saved model (missing registry entry / auth)
   * and fell back to another model. Surface in UI — do not leave as worker-only log.
   */
  modelFallbackMessage?: string
  usage?: {
    input: number
    output: number
    cacheRead: number
    cacheWrite: number
    cost: number
  }
  toolStats?: {
    total: number
    running: number
    failed: number
  }
  contextSnapshot?: RunContextSnapshot
  resourceEvidence?: RunResourceEvidence
}

export interface CompactionEvent extends AppEventBase {
  type: 'compaction'
  phase: 'start' | 'end'
  tokensBefore?: number
  tokensSaved?: number
  summary?: string
}

// B-layer slash command dispatch (R0-1): observable slash execution
export interface SlashEvent extends AppEventBase {
  type: 'slash'
  command: string
  status: 'dispatched' | 'ok' | 'error' | 'info'
  text?: string
}

/** pi AgentSession queue_update：运行中已入队的 steer / follow-up（对齐 TUI 输入框上方淡色展示） */
export interface QueueEvent extends AppEventBase {
  type: 'queue'
  steering: string[]
  followUp: string[]
}

/** Agent 轮次失败 / 中止 / 重试耗尽（时间线 error 卡片） */
export interface AgentErrorEvent extends AppEventBase {
  type: 'agent_error'
  text: string
  kind?: 'error' | 'aborted' | 'retry'
  stopReason?: string
}

// SDK 安装进度（设置页 UI 用，与会话无关，不继承 AppEventBase）
export interface SdkInstallProgressEvent {
  type: 'sdk-install-progress'
  version: string
  line?: string
  done?: boolean
  error?: string
}

export interface SessionLeaseEvent extends AppEventBase {
  type: 'lease'
  phase: 'lost'
  snapshot: import('./session-lease').SessionLeaseSnapshot
}

export type AppEvent =
  | MessageEvent
  | ToolEvent
  | FileEvent
  | RunEvent
  | CompactionEvent
  | SlashEvent
  | QueueEvent
  | AgentErrorEvent
  | SessionLeaseEvent
  | OrchestrationEvent
  | SdkInstallProgressEvent

export const APP_EVENT_CHANNEL = 'app:event'
