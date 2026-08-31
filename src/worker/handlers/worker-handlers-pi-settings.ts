import { switchPiSessionModel, type PiModelRegistryLike } from '@shared/pi-model-registry'
import { errorMessage } from '@shared/error-message'
import type { WorkerIncomingMessage } from '../worker-port-types.js'
import type { WorkerReply } from '../worker-handler-types.js'
import { patchPiCompactionTokens, type SettingsManagerLike } from '../worker-compaction-patch.js'
import { st, baseEvent, emit } from '../worker-runtime.js'

export async function handleGetpisettings(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          if (!st.sdk) {
            reply({ type: 'getPiSettings-done', settings: {} })
            return
          }
          const sm = st.session?.settingsManager
            ?? st.sdk.SettingsManager.create(st.currentCwd || process.cwd(), st.sdk.getAgentDir())
          const compaction = sm.getCompactionSettings()
          const retry = sm.getRetrySettings()
          const branchSummary = sm.getBranchSummarySettings()
          reply({
            type: 'getPiSettings-done',
            settings: {
              defaultProvider: sm.getDefaultProvider(),
              defaultModel: sm.getDefaultModel(),
              defaultThinkingLevel: sm.getDefaultThinkingLevel(),
              steeringMode: sm.getSteeringMode(),
              followUpMode: sm.getFollowUpMode(),
              transport: sm.getTransport(),
              compactionEnabled: compaction.enabled,
              compactionReserveTokens: compaction.reserveTokens,
              compactionKeepRecentTokens: compaction.keepRecentTokens,
              retryEnabled: retry.enabled,
              retryMaxRetries: retry.maxRetries,
              retryBaseDelayMs: retry.baseDelayMs,
              branchSummaryReserveTokens: branchSummary.reserveTokens,
              branchSummarySkipPrompt: branchSummary.skipPrompt,
              httpIdleTimeoutMs: sm.getHttpIdleTimeoutMs(),
              shellPath: sm.getShellPath(),
              shellCommandPrefix: sm.getShellCommandPrefix(),
              npmCommand: sm.getNpmCommand(),
              imageAutoResize: sm.getImageAutoResize(),
              showImages: sm.getShowImages(),
              blockImages: sm.getBlockImages(),
              hideThinkingBlock: sm.getHideThinkingBlock(),
              enableSkillCommands: sm.getEnableSkillCommands(),
              quietStartup: sm.getQuietStartup(),
              defaultProjectTrust: sm.getDefaultProjectTrust(),
              treeFilterMode: sm.getTreeFilterMode(),
              doubleEscapeAction: sm.getDoubleEscapeAction(),
              enabledModels: sm.getEnabledModels(),
              packages: sm.getPackages(),
              extensionPaths: sm.getExtensionPaths(),
              skillPaths: sm.getSkillPaths(),
              sessionDir: sm.getSessionDir(),
              isProjectTrusted: sm.isProjectTrusted(),
              desktopSkillOverrides:
                (sm.getGlobalSettings() as { desktopSkillOverrides?: Record<string, boolean> })
                  ?.desktopSkillOverrides ?? {},
            },
          })
        } catch (e: unknown) {
          reply({ type: 'error', error: `getPiSettings failed: ${errorMessage(e)}` })
        }
        return
}


export async function handleSetpisettings(msg: WorkerIncomingMessage, reply: WorkerReply): Promise<void> {
        try {
          const sm = st.session?.settingsManager
            ?? st.sdk!.SettingsManager.create(st.currentCwd || process.cwd(), st.sdk!.getAgentDir())
          const patch = msg.patch || {}
          if (patch.defaultProvider !== undefined && patch.defaultModel !== undefined) {
            sm.setDefaultModelAndProvider(String(patch.defaultProvider), String(patch.defaultModel))
          } else if (patch.defaultProvider !== undefined) sm.setDefaultProvider(String(patch.defaultProvider))
          else if (patch.defaultModel !== undefined) sm.setDefaultModel(String(patch.defaultModel))
          const p = patch as Record<string, unknown>
          if (p.defaultThinkingLevel !== undefined) sm.setDefaultThinkingLevel(p.defaultThinkingLevel as Parameters<typeof sm.setDefaultThinkingLevel>[0])
          if (p.steeringMode !== undefined) sm.setSteeringMode(p.steeringMode as Parameters<typeof sm.setSteeringMode>[0])
          if (p.followUpMode !== undefined) sm.setFollowUpMode(p.followUpMode as Parameters<typeof sm.setFollowUpMode>[0])
          if (p.transport !== undefined) sm.setTransport(p.transport as Parameters<typeof sm.setTransport>[0])
          if (p.compactionEnabled !== undefined) sm.setCompactionEnabled(Boolean(p.compactionEnabled))
          patchPiCompactionTokens(sm as unknown as SettingsManagerLike, patch)
          if (p.shellPath !== undefined) sm.setShellPath(typeof p.shellPath === 'string' ? p.shellPath : undefined)
          if (p.imageAutoResize !== undefined) sm.setImageAutoResize(Boolean(p.imageAutoResize))
          if (p.enabledModels !== undefined) sm.setEnabledModels(Array.isArray(p.enabledModels) ? (p.enabledModels as string[]) : undefined)
          if (p.retryEnabled !== undefined) sm.setRetryEnabled(Boolean(p.retryEnabled))
          if (p.hideThinkingBlock !== undefined) sm.setHideThinkingBlock(Boolean(p.hideThinkingBlock))
          if (p.showImages !== undefined) sm.setShowImages(Boolean(p.showImages))
          if (p.blockImages !== undefined) sm.setBlockImages(Boolean(p.blockImages))
          if (p.enableSkillCommands !== undefined) sm.setEnableSkillCommands(Boolean(p.enableSkillCommands))
          if (p.quietStartup !== undefined) sm.setQuietStartup(Boolean(p.quietStartup))
          if (p.defaultProjectTrust !== undefined) sm.setDefaultProjectTrust(p.defaultProjectTrust as Parameters<typeof sm.setDefaultProjectTrust>[0])
          if (p.shellCommandPrefix !== undefined) sm.setShellCommandPrefix(typeof p.shellCommandPrefix === 'string' ? p.shellCommandPrefix : undefined)
          if (p.npmCommand !== undefined) sm.setNpmCommand(p.npmCommand as Parameters<typeof sm.setNpmCommand>[0])
          if (p.treeFilterMode !== undefined) sm.setTreeFilterMode(p.treeFilterMode as Parameters<typeof sm.setTreeFilterMode>[0])
          if (p.doubleEscapeAction !== undefined) sm.setDoubleEscapeAction(p.doubleEscapeAction as Parameters<typeof sm.setDoubleEscapeAction>[0])
          if (patch.httpIdleTimeoutMs !== undefined) sm.setHttpIdleTimeoutMs(Number(patch.httpIdleTimeoutMs))
          if (patch.isProjectTrusted === true) sm.setProjectTrusted(true)
          if (patch.isProjectTrusted === false) sm.setProjectTrusted(false)
          if (st.session && patch.defaultProvider !== undefined && patch.defaultModel !== undefined) {
            const provider = String(patch.defaultProvider)
            const modelId = String(patch.defaultModel)
            const session = st.session
            const model = await switchPiSessionModel({
              registry: session.modelRuntime as PiModelRegistryLike,
              provider,
              modelId,
              // The SettingsManager mutation above is the single persistence
              // point; applying it to the live session must not write again.
              setModel: (next) =>
                session.setModel(next as Parameters<typeof session.setModel>[0], { persist: false }),
              getCurrentModel: () => session.model,
            })
            emit({
              ...baseEvent(),
              type: 'run',
              phase: 'state',
              model,
              thinkingLevel: session.thinkingLevel,
            })
          }
          reply({ type: 'setPiSettings-done', ok: true })
        } catch (e: unknown) {
          reply({ type: 'error', error: `setPiSettings failed: ${errorMessage(e)}` })
        }
        return
}

