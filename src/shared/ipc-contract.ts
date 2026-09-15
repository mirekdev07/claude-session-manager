/**
 * Jedyne źródło prawdy dla nazw kanałów IPC i kształtu `window.api`.
 * Importowane przez main (rejestracja handlerów), preload (most) i renderer (typy) —
 * dzięki temu literówka w nazwie kanału jest błędem kompilacji, a nie cichą awarią.
 */
import type {
  AppEvent,
  Attachment,
  ClaudeCliInfo,
  ClaudeSession,
  ClipboardContent,
  ContextBreakdown,
  Project,
  ProjectUsage,
  SavedTab,
  SearchHit,
  UsageWindow,
  SpeechDownloadProgress,
  SpeechStatus,
  UsageReport,
  PtyCreateRequest,
  PtyExitEvent,
  PtyInfo,
  PtyStatusEvent,
} from './types'
import type { AppSettings } from './settings'

export const IPC = {
  claude: {
    info: 'claude:info',
  },
  usage: {
    get: 'usage:get',
    refresh: 'usage:refresh',
    byProject: 'usage:by-project',
  },
  clipboard: {
    writeText: 'clipboard:write-text',
  },
  app: {
    setActivePty: 'app:set-active-pty',
  },
  projects: {
    list: 'projects:list',
    add: 'projects:add',
    pickFolder: 'projects:pick-folder',
    remove: 'projects:remove',
    rename: 'projects:rename',
    setFavorite: 'projects:set-favorite',
    openFolder: 'projects:open-folder',
    openInEditor: 'projects:open-in-editor',
  },
  sessions: {
    listForProject: 'sessions:list-for-project',
    listRecent: 'sessions:list-recent',
    rescan: 'sessions:rescan',
    setLabel: 'sessions:set-label',
    setFavorite: 'sessions:set-favorite',
    removeFromIndex: 'sessions:remove-from-index',
    setNotes: 'sessions:set-notes',
    setTags: 'sessions:set-tags',
    contextBreakdown: 'sessions:context-breakdown',
    search: 'sessions:search',
    summarize: 'sessions:summarize',
    exportMarkdown: 'sessions:export-markdown',
  },
  tabs: {
    save: 'tabs:save',
    load: 'tabs:load',
  },
  images: {
    readClipboard: 'images:read-clipboard',
    addFromClipboard: 'images:add-from-clipboard',
    addFromPaths: 'images:add-from-paths',
    addFromBytes: 'images:add-from-bytes',
    pick: 'images:pick',
    discard: 'images:discard',
    send: 'images:send',
    captureScreen: 'images:capture-screen',
  },
  speech: {
    status: 'speech:status',
    pickExecutable: 'speech:pick-executable',
    downloadModel: 'speech:download-model',
    cancelDownload: 'speech:cancel-download',
    transcribe: 'speech:transcribe',
  },
  settings: {
    get: 'settings:get',
    update: 'settings:update',
  },
  pty: {
    create: 'pty:create',
    write: 'pty:write',
    resize: 'pty:resize',
    kill: 'pty:kill',
  },
} as const

/** Kanały push main → renderer. Dane PTY mają własny kanał per proces, żeby nie filtrować w rendererze. */
export const PUSH = {
  ptyData: (ptyId: string) => `pty:data:${ptyId}`,
  ptyExit: 'pty:exit',
  ptyStatus: 'pty:status',
  appEvent: 'app:event',
  speechProgress: 'speech:progress',
  usageChanged: 'usage:changed',
  /** Powiadomienie systemowe zostało kliknięte — renderer ma pokazać tę zakładkę. */
  focusPty: 'app:focus-pty',
} as const

/** Kształt `window.api` wystawianego przez preload. */
export interface RendererApi {
  claude: {
    info(): Promise<ClaudeCliInfo>
  }
  clipboard: {
    /** Kopiuje tekst do systemowego schowka. Renderer nie ma bezpośredniego dostępu (§24). */
    writeText(text: string): Promise<void>
  }
  app: {
    /** Która zakładka jest widoczna — main wycisza powiadomienia dla niej, gdy okno ma fokus. */
    setActivePty(ptyId: string | null): Promise<void>
    onFocusPty(listener: (ptyId: string) => void): () => void
  }
  usage: {
    /** Ostatni odczyt bez odpytywania CLI; `null` gdy jeszcze nie było żadnego. */
    get(): Promise<UsageReport | null>
    /** Wymusza świeży odczyt. Trwa ok. 3 s i nie zużywa limitu. */
    refresh(): Promise<UsageReport>
    onChange(listener: (report: UsageReport) => void): () => void
    /** Zużycie per projekt z lokalnych transkryptów — bez API, bez kosztu. */
    byProject(window: UsageWindow): Promise<ProjectUsage[]>
  }
  projects: {
    list(): Promise<Project[]>
    /** Otwiera systemowy wybór katalogu; `null` gdy użytkownik anulował. */
    pickFolder(): Promise<string | null>
    add(path: string): Promise<Project[]>
    /** Usuwa wyłącznie z listy w aplikacji — katalog na dysku zostaje. */
    remove(path: string): Promise<Project[]>
    rename(path: string, displayName: string | null): Promise<Project[]>
    setFavorite(path: string, isFavorite: boolean): Promise<Project[]>
    /** `null` przy powodzeniu, inaczej komunikat błędu. */
    openFolder(path: string): Promise<string | null>
    /** Otwiera katalog w VS Code (albo innym edytorze z PATH); `null` przy powodzeniu. */
    openInEditor(path: string): Promise<string | null>
  }
  sessions: {
    listForProject(projectPath: string): Promise<ClaudeSession[]>
    listRecent(limit?: number): Promise<ClaudeSession[]>
    /** Pełny przegląd katalogu transkryptów; kosztowny tylko przy pierwszym uruchomieniu. */
    rescan(): Promise<void>
    setLabel(sessionId: string, label: string | null): Promise<void>
    setFavorite(sessionId: string, isFavorite: boolean): Promise<void>
    /** Ukrywa sesję w aplikacji. Transkrypt Claude Code zostaje nietknięty. */
    removeFromIndex(sessionId: string): Promise<void>
    setNotes(sessionId: string, notes: string | null): Promise<void>
    setTags(sessionId: string, tags: string[]): Promise<void>
    /** Rozbicie zużycia kontekstu sesji na narzędzia; `null` gdy sesja nieznana. */
    contextBreakdown(sessionId: string): Promise<ContextBreakdown | null>
    /** Wyszukiwanie pełnotekstowe po wszystkich rozmowach. */
    search(query: string): Promise<SearchHit[]>
    /** Generuje handoff przez `claude -p`. Kosztuje jedno wywołanie modelu. */
    summarize(sessionId: string): Promise<string>
    /** Zapisuje rozmowę jako Markdown; zwraca ścieżkę albo `null` gdy anulowano. */
    exportMarkdown(sessionId: string): Promise<string | null>
  }
  tabs: {
    save(tabs: SavedTab[]): Promise<void>
    load(): Promise<SavedTab[]>
  }
  images: {
    /** Co leży w schowku — decyduje, czy Ctrl+V wkleja tekst, czy dodaje obraz. */
    readClipboard(): Promise<ClipboardContent>
    addFromClipboard(): Promise<Attachment>
    addFromPaths(paths: string[]): Promise<{ attachments: Attachment[]; skipped: string[] }>
    addFromBytes(fileName: string, bytes: Uint8Array): Promise<Attachment>
    /** Otwiera systemowy wybór plików; pusta lista gdy anulowano. */
    pick(): Promise<{ attachments: Attachment[]; skipped: string[] }>
    discard(attachmentId: string): Promise<void>
    /** Zrzut fragmentu ekranu do załączników; `null` gdy anulowano. */
    captureScreen(): Promise<Attachment | null>
    /** Wysyła obrazy i tekst do wskazanego terminala. */
    send(params: {
      ptyId: string
      attachmentIds: string[]
      text: string
      submit: boolean
    }): Promise<void>
  }
  speech: {
    status(): Promise<SpeechStatus>
    /** Otwiera wybór pliku i zapisuje ścieżkę w ustawieniach; `null` gdy anulowano. */
    pickExecutable(): Promise<string | null>
    /** Pobiera model i ustawia go jako aktywny. Postęp przychodzi przez `onDownloadProgress`. */
    downloadModel(modelId: string): Promise<string>
    cancelDownload(): Promise<void>
    /** @param wav zawartość pliku WAV 16 kHz mono */
    transcribe(wav: Uint8Array): Promise<string>
    onDownloadProgress(listener: (progress: SpeechDownloadProgress) => void): () => void
  }
  settings: {
    get(): Promise<AppSettings>
    update(patch: Partial<AppSettings>): Promise<AppSettings>
  }
  pty: {
    create(req: PtyCreateRequest): Promise<PtyInfo>
    write(ptyId: string, data: string): Promise<void>
    resize(ptyId: string, cols: number, rows: number): Promise<void>
    kill(ptyId: string): Promise<void>
    /** Zwraca funkcję odsubskrybowującą. */
    onData(ptyId: string, listener: (chunk: string) => void): () => void
    onExit(listener: (event: PtyExitEvent) => void): () => void
    onStatus(listener: (event: PtyStatusEvent) => void): () => void
  }
  events: {
    on(listener: (event: AppEvent) => void): () => void
  }
}
