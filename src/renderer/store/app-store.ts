import { create } from 'zustand'
import type { ClaudeCliInfo, ClaudeSession, Project } from '@shared/types'
import type { HealthThresholds } from '@renderer/lib/health'

interface ScanProgress {
  scanned: number
  total: number
}

export type SessionFilter = 'all' | 'favorites' | 'heavy' | 'today'

interface AppState {
  cli: ClaudeCliInfo | null
  projects: Project[]
  projectQuery: string
  selectedProjectPath: string | null
  sessions: ClaudeSession[]
  sessionsLoading: boolean
  scanProgress: ScanProgress | null
  error: string | null
  /** Wygląd terminala — czytany raz przy starcie i odświeżany po zmianie w Ustawieniach. */
  appearance: { fontSize: number; fontFamily: string }
  /** Progi zdrowia sesji z Ustawień. */
  thresholds: HealthThresholds
  sessionFilter: SessionFilter
  tagFilter: string | null
  /** Sesja wskazana z wyszukiwarki — podświetlona na liście do następnego kliknięcia. */
  highlightedSessionId: string | null

  init: () => Promise<void>
  setProjectQuery: (query: string) => void
  selectProject: (path: string | null) => Promise<void>
  refreshProjects: () => Promise<void>
  refreshSessions: () => Promise<void>
  addProject: () => Promise<void>
  removeProject: (path: string) => Promise<void>
  renameProject: (path: string, displayName: string | null) => Promise<void>
  toggleProjectFavorite: (project: Project) => Promise<void>
  openProjectFolder: (path: string) => Promise<void>
  toggleSessionFavorite: (session: ClaudeSession) => Promise<void>
  setSessionLabel: (sessionId: string, label: string | null) => Promise<void>
  setSessionNotes: (sessionId: string, notes: string | null) => Promise<void>
  setSessionTags: (sessionId: string, tags: string[]) => Promise<void>
  removeSessionFromIndex: (sessionId: string) => Promise<void>
  setSessionFilter: (filter: SessionFilter) => void
  setTagFilter: (tag: string | null) => void
  highlightSession: (sessionId: string | null) => void
  refreshAppearance: () => Promise<void>
  dismissError: () => void
}

export const useAppStore = create<AppState>((set, get) => ({
  cli: null,
  projects: [],
  projectQuery: '',
  selectedProjectPath: null,
  sessions: [],
  sessionsLoading: false,
  scanProgress: null,
  error: null,
  appearance: { fontSize: 13, fontFamily: "'Cascadia Code', Consolas, monospace" },
  thresholds: { warnAt: 100_000, dangerAt: 150_000 },
  sessionFilter: 'all',
  tagFilter: null,
  highlightedSessionId: null,

  init: async () => {
    const [cli, projects] = await Promise.all([window.api.claude.info(), window.api.projects.list()])
    set({ cli, projects })
    await get().refreshAppearance()

    window.api.events.on((event) => {
      if (event.kind === 'scan-progress') {
        const done = event.scanned >= event.total
        set({ scanProgress: done ? null : event })
        // Skan wypełnia cache stopniowo, więc lista projektów rośnie w trakcie.
        void get().refreshProjects()
        if (done) void get().refreshSessions()
        return
      }

      const selected = get().selectedProjectPath
      if (selected !== null && event.projectPaths.includes(selected)) {
        void get().refreshSessions()
      }
      void get().refreshProjects()
    })
  },

  setProjectQuery: (projectQuery) => set({ projectQuery }),

  selectProject: async (path) => {
    set({ selectedProjectPath: path, sessions: [], tagFilter: null })
    if (path !== null) await get().refreshSessions()
  },

  refreshProjects: async () => {
    set({ projects: await window.api.projects.list() })
  },

  refreshSessions: async () => {
    const path = get().selectedProjectPath
    if (path === null) {
      set({ sessions: [] })
      return
    }
    set({ sessionsLoading: true })
    try {
      set({ sessions: await window.api.sessions.listForProject(path) })
    } finally {
      set({ sessionsLoading: false })
    }
  },

  addProject: async () => {
    const path = await window.api.projects.pickFolder()
    if (path === null) return
    try {
      set({ projects: await window.api.projects.add(path) })
      await get().selectProject(path)
    } catch (error) {
      set({ error: messageOf(error) })
    }
  },

  removeProject: async (path) => {
    set({ projects: await window.api.projects.remove(path) })
    if (get().selectedProjectPath === path) await get().selectProject(null)
  },

  renameProject: async (path, displayName) => {
    set({ projects: await window.api.projects.rename(path, displayName) })
  },

  toggleProjectFavorite: async (project) => {
    set({ projects: await window.api.projects.setFavorite(project.path, !project.isFavorite) })
  },

  openProjectFolder: async (path) => {
    const error = await window.api.projects.openFolder(path)
    if (error !== null) set({ error })
  },

  toggleSessionFavorite: async (session) => {
    await window.api.sessions.setFavorite(session.sessionId, !session.isFavorite)
    await get().refreshSessions()
  },

  setSessionLabel: async (sessionId, label) => {
    await window.api.sessions.setLabel(sessionId, label)
    await get().refreshSessions()
  },

  setSessionNotes: async (sessionId, notes) => {
    await window.api.sessions.setNotes(sessionId, notes)
    await get().refreshSessions()
  },

  setSessionTags: async (sessionId, tags) => {
    await window.api.sessions.setTags(sessionId, tags)
    await get().refreshSessions()
  },

  removeSessionFromIndex: async (sessionId) => {
    await window.api.sessions.removeFromIndex(sessionId)
    await get().refreshSessions()
  },

  setSessionFilter: (sessionFilter) => set({ sessionFilter }),
  setTagFilter: (tagFilter) => set({ tagFilter }),
  highlightSession: (highlightedSessionId) => set({ highlightedSessionId }),

  refreshAppearance: async () => {
    const settings = await window.api.settings.get()
    set({
      appearance: {
        fontSize: settings.terminalFontSize,
        fontFamily: settings.terminalFontFamily,
      },
      thresholds: { warnAt: settings.healthWarnAt, dangerAt: settings.healthDangerAt },
    })
  },

  dismissError: () => set({ error: null }),
}))

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
