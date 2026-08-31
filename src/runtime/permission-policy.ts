import type {
  RuntimePermissionDecision,
  RuntimePermissionMode,
} from '@shared/runtime-rpc-v1'

const READ_ONLY_TOOLS = new Set(['read', 'find', 'grep', 'ls'])
const COLLABORATIVE_TOOLS = new Set(['read', 'find', 'grep', 'ls', 'edit', 'write'])
const HIGH_RISK_TOOLS = new Set(['bash', 'powershell'])

function normalized(values: readonly string[] | undefined): string[] {
  return [...new Set((values || []).map((value) => value.trim()).filter(Boolean))]
}

export function resolveRuntimePermission(input: {
  mode?: RuntimePermissionMode
  requestedTools?: string[]
  approvedTools?: string[]
}): RuntimePermissionDecision {
  const mode = input.mode ?? 'collaborate'
  const requested = normalized(
    input.requestedTools?.length
      ? input.requestedTools
      : ['read', 'bash', 'edit', 'write', 'find', 'grep', 'ls'],
  )
  const approved = normalized(input.approvedTools)
  const approvedSet = new Set(approved)
  const allowed = requested.filter((tool) => {
    if (mode === 'observe') return READ_ONLY_TOOLS.has(tool)
    if (mode === 'collaborate') {
      return COLLABORATIVE_TOOLS.has(tool) || (HIGH_RISK_TOOLS.has(tool) && approvedSet.has(tool))
    }
    return true
  })
  return {
    mode,
    requestedTools: requested,
    allowedTools: allowed,
    deniedTools: requested.filter((tool) => !allowed.includes(tool)),
    approvedTools: approved,
  }
}

export const runtimePermissionPolicyTestApi = {
  READ_ONLY_TOOLS,
  COLLABORATIVE_TOOLS,
  HIGH_RISK_TOOLS,
}
