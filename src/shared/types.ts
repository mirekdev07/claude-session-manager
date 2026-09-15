/** Typy współdzielone między main a rendererem. Nic tu nie importuje z Node ani z Electrona. */
import type { WhisperLanguage } from './i18n/locales'

/** Tryb uruchomienia procesu `claude`. Renderer wysyła tryb, main składa argv. */
export type PtyMode = 'new' | 'continue' | 'resume' | 'fork'

/** Wynik lokalizacji CLI Claude Code na maszynie użytkownika. */
export type ClaudeCliInfo =
  | { ok: true; executablePath: string; version: string; source: ClaudeCliSource }
  | { ok: false; error: ClaudeCliError; detail: string }

export type ClaudeCliSource = 'settings' | 'path' | 'npm-global' | 'fallback'

export type ClaudeCliError =
  | 'not-found'
  | 'not-executable'
  | 'version-check-failed'
  | 'version-check-timeout'

/** Żądanie utworzenia nowego terminala z procesem Claude Code. */
export interface PtyCreateRequest {
  /** Katalog roboczy procesu. Main waliduje, że istnieje i jest katalogiem. */
  cwd: string
  mode: PtyMode
  /** Wymagane dla `resume` i `fork`. */
  sessionId?: string
  cols: number
  rows: number
}

/** Uchwyt do żywego procesu, zwracany po utworzeniu. */
export interface PtyInfo {
  ptyId: string
  pid: number
  cwd: string
  mode: PtyMode
  /** Znane od razu przy `new` (nadajemy `--session-id`) i przy `resume`. Puste przy `continue` i `fork`. */
  sessionId: string | null
  startedAt: number
}

export type PtyStatus = 'running' | 'waiting' | 'closed' | 'error'

/** Zdarzenie zakończenia procesu — przekazywane do renderera. */
export interface PtyExitEvent {
  ptyId: string
  exitCode: number
  signal: number | null
}

/** Zmiana statusu Running/Waiting — wyliczana z aktywności strumienia, nie z parsowania TUI. */
export interface PtyStatusEvent {
  ptyId: string
  status: PtyStatus
}

/** Projekt = katalog na dysku. Aplikacja nigdy go nie usuwa (§4 planu). */
export interface Project {
  /** Ścieżka bezwzględna — pełni rolę identyfikatora. */
  path: string
  /** Nazwa do wyświetlenia: alias użytkownika albo nazwa katalogu. */
  name: string
  displayName: string | null
  isFavorite: boolean
  /** `true` dla projektów dodanych/przypiętych ręcznie; `false` dla samych wykrytych. */
  isTracked: boolean
  /** `false`, gdy katalog zniknął z dysku — wpis zostaje, ale jest wyszarzony. */
  exists: boolean
  sessionCount: number
  lastActivityAt: number | null
  gitBranch: string | null
  /** Liczba działających terminali tego projektu. */
  runningSessions: number
}

/** Rozmowa Claude Code powiązana z katalogiem. */
export interface ClaudeSession {
  sessionId: string
  /** Ścieżka do transkryptu — własność Claude Code, my tylko czytamy. */
  filePath: string
  projectPath: string | null
  /** Pierwszy prompt użytkownika. */
  title: string | null
  /** Nasza własna nazwa, nadana w aplikacji. */
  label: string | null
  gitBranch: string | null
  claudeVersion: string | null
  createdAt: number
  lastActivityAt: number
  sizeBytes: number
  isFavorite: boolean
  metrics: SessionMetrics
  notes: string | null
  tags: string[]
}

/** Metryki zliczone z transkryptu. Zera, dopóki plik nie został przetworzony. */
export interface SessionMetrics {
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
  /** Największe okno kontekstu w pojedynczym zapytaniu. */
  peakContext: number
  requestCount: number
  toolCallCount: number
}

export type SessionHealth = 'green' | 'yellow' | 'red'

export interface ToolUsage {
  toolName: string
  calls: number
  resultChars: number
}

export interface LargeToolResult {
  toolName: string
  resultChars: number
  timestamp: number | null
}

/** Rozbicie zużycia kontekstu jednej sesji (Etap 10). */
export interface ContextBreakdown {
  sessionId: string
  tools: ToolUsage[]
  largestResults: LargeToolResult[]
  totalResultChars: number
  metrics: SessionMetrics
}

export type UsageWindow = '24h' | '7d' | '30d'

export interface ProjectUsage {
  projectPath: string
  projectName: string
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
  totalTokens: number
  requests: number
  sessionCount: number
  avgPeakContext: number
  maxPeakContext: number
}

export interface SearchHit {
  sessionId: string
  projectPath: string | null
  title: string | null
  role: 'user' | 'assistant'
  timestamp: number | null
  lastActivityAt: number
  /** Fragment z trafieniem oznaczonym znakami ⟦ ⟧. */
  snippet: string
}

/** Zakładka w postaci do zapisania i przywrócenia po restarcie. */
export interface SavedTab {
  projectPath: string
  sessionId: string | null
  mode: PtyMode
}

/** Zdarzenia wypychane z main do renderera poza strumieniem PTY. */
export type AppEvent =
  | { kind: 'sessions-changed'; projectPaths: string[] }
  | { kind: 'scan-progress'; scanned: number; total: number }

/** Skąd wziął się załącznik — wpływa tylko na nazwę pliku i komunikaty. */
export type AttachmentSource = 'clipboard' | 'drop' | 'picker'

/**
 * Obraz przygotowany do wysłania. Plik leży w cache aplikacji, nigdy w katalogu projektu (§13).
 */
export interface Attachment {
  id: string
  fileName: string
  /** Ścieżka bezwzględna w cache aplikacji. */
  filePath: string
  sizeBytes: number
  width: number
  height: number
  /** Miniatura jako `data:` URL — renderer nie ma dostępu do dysku. */
  thumbnailDataUrl: string
  source: AttachmentSource
}

/** Co aktualnie leży w schowku — decyduje, czy Ctrl+V wkleja tekst, czy dodaje obraz (§16). */
export type ClipboardContent =
  | { kind: 'empty' }
  | { kind: 'text'; text: string }
  | { kind: 'image' }
  | { kind: 'files'; paths: string[]; imagePaths: string[] }

/** Pojedynczy limit subskrypcji zwrócony przez `/usage`. */
export interface UsageLimit {
  /** Które okno: bieżąca sesja, tydzień (wszystkie modele), tydzień per model; `raw` — nierozpoznana etykieta. */
  kind: 'session' | 'week' | 'model' | 'raw'
  /** Nazwa modelu dla `model`, oryginalna etykieta dla `raw`, inaczej `null`. Etykietę składa renderer w swoim języku. */
  detail: string | null
  percentUsed: number
  /** Moment odnowienia w formie tekstowej, tak jak podaje go Claude Code. */
  resetsAt: string | null
}

export type UsageReport =
  | { ok: true; limits: UsageLimit[]; detail: string; fetchedAt: number }
  | { ok: false; error: string; fetchedAt: number }

/** Opis dostępnego modelu Whispera pokazywany w Ustawieniach. */
export interface WhisperModelInfo {
  id: string
  label: string
  approximateMB: number
  downloaded: boolean
  path: string
}

/** Stan konfiguracji silnika mowy. */
export interface SpeechStatus {
  /** `null` oznacza, że użytkownik nie wskazał jeszcze pliku wykonywalnego. */
  executablePath: string | null
  modelPath: string | null
  language: WhisperLanguage
  models: WhisperModelInfo[]
}

/** Postęp pobierania modelu; `totalBytes` bywa nieznany, gdy serwer nie poda rozmiaru. */
export interface SpeechDownloadProgress {
  modelId: string
  receivedBytes: number
  totalBytes: number | null
}

/** Sposób przekazania obrazu do działającej sesji Claude Code. */
export type InjectStrategy = 'bracketed-path' | 'clipboard-paste' | 'plain-path'
