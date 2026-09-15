import { create } from 'zustand'
import type { ClaudeSession, Project } from '@shared/types'
import { useTerminalStore } from './terminal-store'
import { tNow } from './i18n-store'

export type HandoffPhase = 'idle' | 'confirm' | 'generating' | 'preview' | 'starting'

interface HandoffState {
  phase: HandoffPhase
  session: ClaudeSession | null
  project: Project | null
  summary: string
  error: string | null

  /** Otwiera okno z ostrzeżeniem o koszcie; nic jeszcze nie wywołuje. */
  begin: (session: ClaudeSession, project: Project) => void
  generate: () => Promise<void>
  setSummary: (summary: string) => void
  /** Startuje nową sesję i wysyła podsumowanie jako pierwszy prompt. */
  launch: () => Promise<void>
  cancel: () => void
}

/** Ile czekać, aż TUI nowej sesji będzie gotowe przyjąć prompt. */
const READY_TIMEOUT_MS = 60_000

export const useHandoffStore = create<HandoffState>((set, get) => ({
  phase: 'idle',
  session: null,
  project: null,
  summary: '',
  error: null,

  begin: (session, project) => set({ phase: 'confirm', session, project, summary: '', error: null }),

  generate: async () => {
    const { session } = get()
    if (!session) return
    set({ phase: 'generating', error: null })
    try {
      const summary = await window.api.sessions.summarize(session.sessionId)
      set({ phase: 'preview', summary })
    } catch (error) {
      set({ phase: 'confirm', error: messageOf(error) })
    }
  },

  setSummary: (summary) => set({ summary }),

  launch: async () => {
    const { project, summary } = get()
    if (!project || summary.trim() === '') return
    set({ phase: 'starting', error: null })

    const terminal = useTerminalStore.getState()
    terminal.openTab({ projectPath: project.path, projectName: project.name, mode: 'new' })
    const tabId = useTerminalStore.getState().activeTabId
    if (tabId === null) {
      set({ phase: 'idle' })
      return
    }

    try {
      // Prompt można wysłać dopiero, gdy TUI wystartuje i zacznie czekać na input.
      const ptyId = await waitForReady(tabId)
      await window.api.images.send({ ptyId, attachmentIds: [], text: summary.trim(), submit: true })
      set({ phase: 'idle', session: null, project: null, summary: '' })
    } catch (error) {
      set({ phase: 'preview', error: messageOf(error) })
    }
  },

  cancel: () => set({ phase: 'idle', session: null, project: null, summary: '', error: null }),
}))

function waitForReady(tabId: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const check = (): boolean => {
      const tab = useTerminalStore.getState().tabs.find((candidate) => candidate.id === tabId)
      if (!tab) {
        reject(new Error(tNow('handoff.errTabClosed')))
        return true
      }
      if (tab.status === 'error' || tab.status === 'closed') {
        reject(new Error(tab.error ?? tNow('handoff.errSessionEnded')))
        return true
      }
      if (tab.info && tab.status === 'waiting') {
        resolve(tab.info.ptyId)
        return true
      }
      return false
    }

    if (check()) return
    const unsubscribe = useTerminalStore.subscribe(() => {
      if (check()) {
        unsubscribe()
        clearTimeout(timer)
      }
    })
    const timer = setTimeout(() => {
      unsubscribe()
      reject(new Error(tNow('handoff.errNotReady')))
    }, READY_TIMEOUT_MS)
  })
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
