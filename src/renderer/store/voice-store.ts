import { create } from 'zustand'
import { VoiceRecorder } from '@renderer/features/voice/recorder'
import { useAttachmentStore } from './attachment-store'

export type VoicePhase = 'idle' | 'recording' | 'transcribing'

interface VoiceState {
  phase: VoicePhase
  /** Zakładka, do której trafi transkrypcja. */
  targetTabId: string | null
  error: string | null

  start: (tabId: string) => Promise<void>
  stopAndTranscribe: () => Promise<void>
  cancel: () => void
  readLevels: (target: Uint8Array<ArrayBuffer>) => void
  dismissError: () => void
}

// Rekorder trzyma uchwyty do mikrofonu i kontekstu audio — musi przeżyć przerysowania Reacta,
// więc żyje poza stanem, jako pojedyncza instancja.
const recorder = new VoiceRecorder()

export const useVoiceStore = create<VoiceState>((set, get) => ({
  phase: 'idle',
  targetTabId: null,
  error: null,

  start: async (tabId) => {
    if (get().phase !== 'idle') return
    set({ error: null, targetTabId: tabId })

    try {
      await recorder.start()
      set({ phase: 'recording' })
    } catch (error) {
      set({ phase: 'idle', targetTabId: null, error: messageOf(error) })
    }
  },

  stopAndTranscribe: async () => {
    const { phase, targetTabId } = get()
    if (phase !== 'recording' || targetTabId === null) return

    set({ phase: 'transcribing' })
    try {
      const result = await recorder.stop()
      if (result === null) {
        set({ phase: 'idle', targetTabId: null })
        return
      }

      const text = (await window.api.speech.transcribe(result.wav)).trim()
      if (text !== '') {
        // Tekst ląduje w polu do edycji, nigdy prosto w terminalu (§8 planu).
        useAttachmentStore.getState().appendText(targetTabId, text)
      }
      set({ phase: 'idle', targetTabId: null })
    } catch (error) {
      set({ phase: 'idle', targetTabId: null, error: messageOf(error) })
    }
  },

  cancel: () => {
    recorder.cancel()
    set({ phase: 'idle', targetTabId: null })
  },

  readLevels: (target) => recorder.readLevels(target),
  dismissError: () => set({ error: null }),
}))

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
