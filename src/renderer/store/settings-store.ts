import { create } from 'zustand'
import type { AppSettings } from '@shared/settings'
import type { ClaudeCliInfo, SpeechStatus } from '@shared/types'
import { useAppStore } from './app-store'

interface DownloadState {
  modelId: string
  receivedBytes: number
  totalBytes: number | null
}

interface SettingsState {
  isOpen: boolean
  settings: AppSettings | null
  speech: SpeechStatus | null
  cli: ClaudeCliInfo | null
  download: DownloadState | null
  error: string | null

  open: () => Promise<void>
  close: () => void
  update: (patch: Partial<AppSettings>) => Promise<void>
  refreshSpeech: () => Promise<void>
  pickWhisperExecutable: () => Promise<void>
  downloadModel: (modelId: string) => Promise<void>
  cancelDownload: () => Promise<void>
  dismissError: () => void
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  isOpen: false,
  settings: null,
  speech: null,
  cli: null,
  download: null,
  error: null,

  open: async () => {
    set({ isOpen: true })
    const [settings, speech, cli] = await Promise.all([
      window.api.settings.get(),
      window.api.speech.status(),
      window.api.claude.info(),
    ])
    set({ settings, speech, cli })

    // Subskrypcja żyje tak długo jak okno ustawień; pobieranie modelu może trwać minuty.
    window.api.speech.onDownloadProgress((progress) => set({ download: progress }))
  },

  close: () => set({ isOpen: false }),

  update: async (patch) => {
    try {
      set({ settings: await window.api.settings.update(patch) })
      await get().refreshSpeech()
      // Rozmiar i krój czcionki terminala trzyma app-store, bo czyta je każdy panel.
      await useAppStore.getState().refreshAppearance()
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  refreshSpeech: async () => {
    set({ speech: await window.api.speech.status() })
  },

  pickWhisperExecutable: async () => {
    const path = await window.api.speech.pickExecutable()
    if (path === null) return
    set({ settings: await window.api.settings.get() })
    await get().refreshSpeech()
  },

  downloadModel: async (modelId) => {
    set({ error: null, download: { modelId, receivedBytes: 0, totalBytes: null } })
    try {
      await window.api.speech.downloadModel(modelId)
      set({ settings: await window.api.settings.get() })
      await get().refreshSpeech()
    } catch (error) {
      set({ error: messageOf(error) })
    } finally {
      set({ download: null })
    }
  },

  cancelDownload: async () => {
    await window.api.speech.cancelDownload()
    set({ download: null })
  },

  dismissError: () => set({ error: null }),
}))

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
