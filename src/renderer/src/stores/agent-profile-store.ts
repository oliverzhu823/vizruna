import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { AgentProfile, AgentPromptMode } from '@shared/agent-profile'
import type {
  ConversationConfigBinding,
  ConversationConfigSelection,
  SystemPromptPreset,
} from '@shared/system-prompt-preset'
import { ipcClient } from '@renderer/lib/ipc-client'

export type TemporarySystemPrompt = {
  name: string
  systemPrompt: string
  promptMode: AgentPromptMode
}

type AgentProfileState = {
  profiles: AgentProfile[]
  promptPresets: SystemPromptPreset[]
  loading: boolean
  loaded: boolean
  promptPresetsLoading: boolean
  promptPresetsLoaded: boolean
  selectedProfileId: string | null
  selectedPromptPresetId: string | null
  temporaryPrompt: TemporarySystemPrompt | null
  activeBinding: ConversationConfigBinding | null
  bindingLoading: boolean
  loadProfiles: (force?: boolean) => Promise<void>
  loadPromptPresets: (force?: boolean) => Promise<void>
  selectProfile: (profileId: string | null) => void
  selectPromptPreset: (presetId: string | null) => void
  selectTemporaryPrompt: (prompt: TemporarySystemPrompt | null) => void
  selectGeneral: () => void
  selectedConversationConfig: () => ConversationConfigSelection | undefined
  prepareNewConversation: () => void
  consumeTemporaryPrompt: () => void
  setActiveBinding: (binding: ConversationConfigBinding | null) => void
  setBindingLoading: (loading: boolean) => void
}

let profileLoadPromise: Promise<void> | null = null
let promptPresetLoadPromise: Promise<void> | null = null

export const useAgentProfileStore = create<AgentProfileState>()(
  persist(
    (set, get) => ({
      profiles: [],
      promptPresets: [],
      loading: false,
      loaded: false,
      promptPresetsLoading: false,
      promptPresetsLoaded: false,
      selectedProfileId: null,
      selectedPromptPresetId: null,
      temporaryPrompt: null,
      activeBinding: null,
      bindingLoading: false,

      loadProfiles: async (force = false) => {
        if (profileLoadPromise) return profileLoadPromise
        if (get().loaded && !force) return
        profileLoadPromise = (async () => {
          set({ loading: true })
          try {
            const response = await ipcClient.invoke('agentProfile.list', {})
            const profiles = (response?.profiles ?? []) as AgentProfile[]
            const selectedProfileId = get().selectedProfileId
            set({
              profiles,
              loaded: true,
              selectedProfileId:
                selectedProfileId && profiles.some((profile) => profile.id === selectedProfileId)
                  ? selectedProfileId
                  : null,
            })
          } finally {
            set({ loading: false })
          }
        })()
        try {
          await profileLoadPromise
        } finally {
          profileLoadPromise = null
        }
      },

      loadPromptPresets: async (force = false) => {
        if (promptPresetLoadPromise) return promptPresetLoadPromise
        if (get().promptPresetsLoaded && !force) return
        promptPresetLoadPromise = (async () => {
          set({ promptPresetsLoading: true })
          try {
            const response = await ipcClient.invoke('systemPromptPreset.list', {})
            const promptPresets = (response?.presets ?? []) as SystemPromptPreset[]
            const selectedPromptPresetId = get().selectedPromptPresetId
            set({
              promptPresets,
              promptPresetsLoaded: true,
              selectedPromptPresetId:
                selectedPromptPresetId &&
                promptPresets.some((preset) => preset.id === selectedPromptPresetId)
                  ? selectedPromptPresetId
                  : null,
            })
          } finally {
            set({ promptPresetsLoading: false })
          }
        })()
        try {
          await promptPresetLoadPromise
        } finally {
          promptPresetLoadPromise = null
        }
      },

      selectProfile: (selectedProfileId) =>
        set({
          selectedProfileId,
          selectedPromptPresetId: null,
          temporaryPrompt: null,
        }),
      selectPromptPreset: (selectedPromptPresetId) =>
        set({
          selectedPromptPresetId,
          selectedProfileId: null,
          temporaryPrompt: null,
        }),
      selectTemporaryPrompt: (temporaryPrompt) =>
        set({
          temporaryPrompt,
          selectedProfileId: null,
          selectedPromptPresetId: null,
        }),
      selectGeneral: () =>
        set({
          selectedProfileId: null,
          selectedPromptPresetId: null,
          temporaryPrompt: null,
        }),
      selectedConversationConfig: () => {
        const state = get()
        if (state.temporaryPrompt) {
          return { kind: 'temporaryPrompt', ...state.temporaryPrompt }
        }
        if (state.selectedPromptPresetId) {
          return { kind: 'prompt', presetId: state.selectedPromptPresetId }
        }
        if (state.selectedProfileId) {
          return { kind: 'agent', profileId: state.selectedProfileId }
        }
        return undefined
      },
      prepareNewConversation: () => set({ activeBinding: null, bindingLoading: false }),
      consumeTemporaryPrompt: () => set({ temporaryPrompt: null }),
      setActiveBinding: (activeBinding) => set({ activeBinding, bindingLoading: false }),
      setBindingLoading: (bindingLoading) => set({ bindingLoading }),
    }),
    {
      name: 'vizruna-agent-profile-selection',
      partialize: (state) => ({
        selectedProfileId: state.selectedProfileId,
        selectedPromptPresetId: state.selectedPromptPresetId,
      }),
    },
  ),
)

export function selectedAgentProfile(): AgentProfile | null {
  const state = useAgentProfileStore.getState()
  if (!state.selectedProfileId) return null
  return state.profiles.find((profile) => profile.id === state.selectedProfileId) ?? null
}
