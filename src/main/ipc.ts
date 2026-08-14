import { registerDialogHandlers } from './ipc/handlers/dialog'
import { registerWorkspaceFsHandlers } from './ipc/handlers/workspace-fs'
import { registerWorkspaceHandlers } from './ipc/handlers/workspace'
import { registerSessionHandlers } from './ipc/handlers/session'
import { registerPromptHandlers } from './ipc/handlers/prompt'
import { registerSettingsHandlers } from './ipc/handlers/settings'
import { registerWindowControlHandlers } from './ipc/handlers/window-controls'
import { registerModelRuntimeHandlers } from './ipc/handlers/model-runtime'
import { registerExtensionHandlers } from './ipc/handlers/extensions'
import { registerExtensionUiHandlers } from './ipc/handlers/extension-ui'
import { registerAdapterPanelHandlers } from './ipc/handlers/adapter-panels'
import { registerSkillsResourceHandlers } from './ipc/handlers/skills-resources'
import { registerReviewHandlers } from './ipc/handlers/review'
import { registerCommandsSlashHandlers } from './ipc/handlers/commands-slash'
import { registerAsrHandlers } from './ipc/handlers/asr'
import { registerPiSdkHandlers } from './ipc/handlers/pi-sdk'
import { registerWorktreeHandlers } from './ipc/handlers/worktree'
import { registerOrchestrationHandlers } from './ipc/handlers/orchestration'
import { registerReliabilityHandlers } from './ipc/handlers/reliability'
import { registerProviderRoutingHandlers } from './ipc/handlers/provider-routing'
import { registerProviderAuthHandlers } from './ipc/handlers/provider-auth'
import { registerTerminalHandlers } from './ipc/handlers/terminal'
import { registerAgentCaseHandlers } from './ipc/handlers/agent-case'
import { registerAgentEvaluationHandlers } from './ipc/handlers/agent-evaluation'
import { registerAgentProfileHandlers } from './ipc/handlers/agent-profile'
import { registerAgentVersionHandlers } from './ipc/handlers/agent-version'
import { registerAgentAssetHandlers } from './ipc/handlers/agent-asset'
import { registerAgentRunHandlers } from './ipc/handlers/agent-run'
import { registerSystemPromptPresetHandlers } from './ipc/handlers/system-prompt-preset'
import { registerPiInspectorHandlers } from './ipc/handlers/pi-inspector'
import { registerPiResourceCenterHandlers } from './ipc/handlers/pi-resource-center'

export { registerHandler, sendEvent } from './ipc/registry'

export function registerAllHandlers(): void {
  registerAgentAssetHandlers()
  registerAgentRunHandlers()
  registerAgentCaseHandlers()
  registerAgentEvaluationHandlers()
  registerAgentProfileHandlers()
  registerAgentVersionHandlers()
  registerSystemPromptPresetHandlers()
  registerDialogHandlers()
  registerWorkspaceFsHandlers()
  registerWorkspaceHandlers()
  registerSessionHandlers()
  registerPromptHandlers()
  registerSettingsHandlers()
  registerWindowControlHandlers()
  registerExtensionUiHandlers()
  registerModelRuntimeHandlers()
  registerExtensionHandlers()
  registerAdapterPanelHandlers()
  registerSkillsResourceHandlers()
  registerReviewHandlers()
  registerCommandsSlashHandlers()
  registerAsrHandlers()
  registerPiSdkHandlers()
  registerPiInspectorHandlers()
  registerPiResourceCenterHandlers()
  registerWorktreeHandlers()
  registerOrchestrationHandlers()
  registerReliabilityHandlers()
  registerProviderRoutingHandlers()
  registerProviderAuthHandlers()
  registerTerminalHandlers()
}
