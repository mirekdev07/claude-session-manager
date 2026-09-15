import { create } from 'zustand'
import type { ClaudeSession, PtyExitEvent, PtyInfo, PtyMode, PtyStatus, SavedTab } from '@shared/types'
import type { MessageKey } from '@shared/i18n'
import { tNow } from './i18n-store'

/**
 * Jedna zakładka = jeden proces Claude Code.
 *
 * `id` jest nasze i stabilne przez cały czas życia zakładki; `info.ptyId` pojawia się
 * dopiero po starcie procesu i zmienia się przy restarcie. Rozdzielenie tych dwóch
 * identyfikatorów pozwala pokazać zakładkę zanim proces wystartuje i utrzymać ją
 * po jego zakończeniu.
 */
export interface TerminalTab {
  id: string
  projectPath: string
  projectName: string
  mode: PtyMode
  sessionId?: string
  title: string
  info: PtyInfo | null
  status: PtyStatus
  error: string | null
  exitCode: number | null
}

interface TerminalState {
  tabs: TerminalTab[]
  activeTabId: string | null
  /** Zakładka pokazywana obok aktywnej (split view). `null` = jeden panel. */
  splitTabId: string | null

  openTab: (params: {
    projectPath: string
    projectName: string
    mode: PtyMode
    session?: ClaudeSession
    sessionId?: string
  }) => void
  closeTab: (tabId: string) => void
  selectTab: (tabId: string) => void
  restartTab: (tabId: string) => void
  toggleSplit: (tabId: string) => void
  setInfo: (tabId: string, info: PtyInfo) => void
  setStatus: (tabId: string, status: PtyStatus) => void
  setExit: (tabId: string, event: PtyExitEvent) => void
  setError: (tabId: string, error: string) => void
  /** Zakładki w postaci do zapisania i przywrócenia po restarcie (Etap 12.1). */
  toSaved: () => SavedTab[]
}

const MODE_KEY: Record<PtyMode, MessageKey> = {
  new: 'tabs.mode.new',
  continue: 'tabs.mode.continue',
  resume: 'tabs.mode.resume',
  fork: 'tabs.mode.fork',
}

export const useTerminalStore = create<TerminalState>((set, get) => ({
  tabs: [],
  activeTabId: null,
  splitTabId: null,

  openTab: ({ projectPath, projectName, mode, session, sessionId }) => {
    const tab: TerminalTab = {
      id: crypto.randomUUID(),
      projectPath,
      projectName,
      mode,
      sessionId: session?.sessionId ?? sessionId,
      title: buildTitle(projectName, mode, session),
      info: null,
      status: 'running',
      error: null,
      exitCode: null,
    }
    set((state) => ({ tabs: [...state.tabs, tab], activeTabId: tab.id }))
  },

  closeTab: (tabId) => {
    set((state) => {
      const index = state.tabs.findIndex((tab) => tab.id === tabId)
      const tabs = state.tabs.filter((tab) => tab.id !== tabId)
      const splitTabId = state.splitTabId === tabId ? null : state.splitTabId

      if (state.activeTabId !== tabId) return { tabs, activeTabId: state.activeTabId, splitTabId }

      // Po zamknięciu aktywnej zakładki przechodzimy na sąsiednią, a nie na pierwszą.
      const neighbour = tabs[Math.min(index, tabs.length - 1)]
      const activeTabId = neighbour?.id ?? null
      return { tabs, activeTabId, splitTabId: splitTabId === activeTabId ? null : splitTabId }
    })
  },

  selectTab: (tabId) =>
    set((state) => ({
      activeTabId: tabId,
      // Ta sama zakładka nie może być jednocześnie po lewej i po prawej.
      splitTabId: state.splitTabId === tabId ? null : state.splitTabId,
    })),

  /** Nadaje zakładce nowy `id`, przez co XtermView montuje się od nowa i startuje świeży proces. */
  restartTab: (tabId) => {
    const tab = get().tabs.find((candidate) => candidate.id === tabId)
    if (!tab) return
    const restarted: TerminalTab = {
      ...tab,
      id: crypto.randomUUID(),
      info: null,
      status: 'running',
      error: null,
      exitCode: null,
    }
    set((state) => ({
      tabs: state.tabs.map((candidate) => (candidate.id === tabId ? restarted : candidate)),
      activeTabId: state.activeTabId === tabId ? restarted.id : state.activeTabId,
      splitTabId: state.splitTabId === tabId ? restarted.id : state.splitTabId,
    }))
  },

  toggleSplit: (tabId) =>
    set((state) => {
      if (state.splitTabId === tabId) return { splitTabId: null }
      if (state.activeTabId === tabId) {
        // Aktywna zakładka idzie na prawo, a na lewo wchodzi poprzednia sąsiednia.
        const other = state.tabs.find((tab) => tab.id !== tabId)
        return other ? { activeTabId: other.id, splitTabId: tabId } : {}
      }
      return { splitTabId: tabId }
    }),

  setInfo: (tabId, info) => patch(set, tabId, { info }),
  setStatus: (tabId, status) => patch(set, tabId, { status }),
  setExit: (tabId, event) => patch(set, tabId, { status: 'closed', exitCode: event.exitCode }),
  setError: (tabId, error) => patch(set, tabId, { status: 'error', error }),

  toSaved: () =>
    get().tabs.map((tab) => {
      const sessionId = tab.info?.sessionId ?? tab.sessionId ?? null
      // Nowa sesja ma po starcie znany identyfikator — po restarcie wracamy do niej przez resume.
      const mode: PtyMode = sessionId !== null && (tab.mode === 'new' || tab.mode === 'resume') ? 'resume' : 'continue'
      return { projectPath: tab.projectPath, sessionId, mode }
    }),
}))

type SetState = (updater: (state: TerminalState) => Partial<TerminalState>) => void

function patch(set: SetState, tabId: string, changes: Partial<TerminalTab>): void {
  set((state) => ({
    tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, ...changes } : tab)),
  }))
}

function buildTitle(projectName: string, mode: PtyMode, session?: ClaudeSession): string {
  const detail = session?.label ?? session?.title
  if (detail) {
    const short = detail.length > 28 ? `${detail.slice(0, 27)}…` : detail
    return `${projectName} · ${short}`
  }
  return `${projectName} · ${tNow(MODE_KEY[mode])}`
}
