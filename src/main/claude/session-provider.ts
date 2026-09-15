/**
 * Wykrywa i opisuje sesje Claude Code.
 *
 * Claude Code nie udostępnia nieinteraktywnego API do listowania rozmów — `--resume`
 * bez argumentu otwiera interaktywny wybór, a `claude agents` dotyczy tylko sesji
 * uruchomionych w tle. Dlatego czytamy pliki transkryptów, izolując tę wiedzę
 * w jednej warstwie (§3 planu).
 *
 * Dwie warstwy odczytu:
 *   - nagłówek (`transcript-reader`) — tytuł, cwd, branch; wystarcza liście sesji,
 *   - przyrost (`transcript-metrics`) — tokeny, narzędzia, tekst do wyszukiwania;
 *     czytany tylko od bajtu, na którym skończył poprzedni przebieg.
 */
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, dirname, join } from 'node:path'
import type { Database } from 'better-sqlite3'
import type {
  ClaudeSession,
  ContextBreakdown,
  ProjectUsage,
  SearchHit,
  SessionMetrics,
  UsageWindow,
} from '@shared/types'
import { SessionCache, foldPolish, type CachedSessionRow } from '@main/storage/session-cache'
import { localDay, readTranscriptIncrement } from './transcript-metrics'
import { readSessionMetadata, type SessionMetadata } from './transcript-reader'

/** Katalog, w którym Claude Code trzyma transkrypty pogrupowane po projektach. */
export function claudeProjectsRoot(): string {
  return join(homedir(), '.claude', 'projects')
}

interface SessionMetaRow {
  session_id: string
  label: string | null
  is_favorite: number
  is_hidden: number
  notes: string | null
  tags: string | null
}

const WINDOW_DAYS: Record<UsageWindow, number> = { '24h': 1, '7d': 7, '30d': 30 }

export class ClaudeSessionProvider {
  private readonly cache: SessionCache

  constructor(private readonly db: Database) {
    this.cache = new SessionCache(db)
  }

  /**
   * Przechodzi cały katalog transkryptów i odświeża cache.
   *
   * Pliki niezmienione od ostatniego skanu są pomijane bez otwierania — przy 55 projektach
   * kolejne uruchomienia kosztują tyle, co samo `stat()`.
   *
   * @param onProgress wołane po każdym katalogu, do pokazania postępu w interfejsie
   */
  async scanAll(onProgress?: (scanned: number, total: number) => void): Promise<void> {
    const root = claudeProjectsRoot()

    let directories: string[]
    try {
      const entries = await readdir(root, { withFileTypes: true })
      directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
    } catch {
      return // brak katalogu = Claude Code jeszcze nie zapisał żadnej sesji
    }

    const seenFiles = new Set<string>()

    for (const [index, directory] of directories.entries()) {
      for (const filePath of await this.scanDirectory(join(root, directory))) {
        seenFiles.add(filePath)
      }
      onProgress?.(index + 1, directories.length)
    }

    // Transkrypty usunięte z dysku (np. przez `claude project purge`) muszą zniknąć z listy.
    for (const filePath of this.cache.allFilePaths()) {
      if (!seenFiles.has(filePath)) this.cache.remove(filePath)
    }
  }

  /**
   * Przetwarza jeden katalog projektu w dwóch fazach.
   *
   * Faza druga jest potrzebna, bo transkrypt bez `cwd` może leżeć przed tym, który tę
   * ścieżkę zawiera. Dopiero po przejrzeniu całego katalogu wiadomo, czym uzupełnić braki.
   *
   * @returns ścieżki wszystkich transkryptów w katalogu
   */
  private async scanDirectory(directory: string): Promise<string[]> {
    const files = await this.transcriptsIn(directory)
    const pending: Array<{ metadata: SessionMetadata; mtime: number }> = []
    let directoryCwd: string | null = null

    for (const filePath of files) {
      let stats
      try {
        stats = await stat(filePath)
      } catch {
        continue
      }

      const cached = this.cache.getFresh(filePath, stats.mtimeMs, stats.size)
      if (cached) {
        directoryCwd ??= cached.cwd
        // Plik świeży, ale metryki mogły nie być jeszcze liczone (np. pierwszy start po migracji).
        if (cached.parsed_bytes < stats.size) await this.updateMetrics(filePath, stats.size)
        continue
      }

      const metadata = await readSessionMetadata(filePath)
      if (!metadata) continue

      directoryCwd ??= metadata.cwd
      pending.push({ metadata, mtime: stats.mtimeMs })
    }

    for (const { metadata, mtime } of pending) {
      metadata.cwd ??= directoryCwd ?? this.cache.getCwdInDirectory(directory)
      this.cache.put(metadata, mtime)
      await this.updateMetrics(metadata.filePath, metadata.sizeBytes)
    }

    return files
  }

  /** Odświeża pojedynczy plik — używane przez watcher po zmianie na dysku. */
  async refresh(filePath: string): Promise<void> {
    let stats
    try {
      stats = await stat(filePath)
    } catch {
      this.cache.remove(filePath)
      return
    }

    const fresh = this.cache.getFresh(filePath, stats.mtimeMs, stats.size)
    if (fresh) {
      if (fresh.parsed_bytes < stats.size) await this.updateMetrics(filePath, stats.size)
      return
    }

    const metadata = await readSessionMetadata(filePath)
    if (!metadata) return

    metadata.cwd ??= this.cache.getCwdInDirectory(dirname(filePath))
    this.cache.put(metadata, stats.mtimeMs)
    await this.updateMetrics(filePath, stats.size)
  }

  /**
   * Dolicza metryki z fragmentu dopisanego od ostatniego przebiegu.
   *
   * Plik mniejszy niż zapamiętany offset oznacza skrócenie lub podmianę — wtedy liczymy od zera.
   */
  private async updateMetrics(filePath: string, sizeBytes: number): Promise<void> {
    const state = this.cache.getMetricsState(filePath)
    if (!state) return

    let from = state.parsedBytes
    let reset = false
    if (from > sizeBytes) {
      from = 0
      reset = true
    }
    if (!reset && from >= sizeBytes) return

    try {
      const delta = await readTranscriptIncrement(filePath, from, reset ? {} : state.pendingTools)
      this.cache.applyIncrement(filePath, state.sessionId, delta, reset)
      if (state.cwd !== null) this.cache.backfillCwd(state.sessionId, state.cwd)
    } catch {
      // Plik mógł zniknąć w trakcie odczytu — następny przebieg to wyprostuje.
    }
  }

  forget(filePath: string): void {
    this.cache.remove(filePath)
  }

  /** Do którego projektu należy dany transkrypt. `null`, gdy plik nie jest jeszcze w cache. */
  projectPathForTranscript(filePath: string): string | null {
    return this.cache.getCwd(filePath)
  }

  listForProject(projectPath: string): ClaudeSession[] {
    return this.decorate(this.cache.listByCwd(projectPath))
  }

  listRecent(limit = 20): ClaudeSession[] {
    return this.decorate(this.cache.listRecent(limit))
  }

  getSession(sessionId: string): ClaudeSession | null {
    const row = this.cache.getBySession(sessionId)
    return row ? (this.decorate([row])[0] ?? null) : null
  }

  /** Katalogi robocze, w których istnieje choć jedna sesja — podstawa auto-discovery projektów. */
  summarizeProjects(): Array<{ path: string; sessionCount: number; lastActivityAt: number }> {
    return this.cache.summarizeByCwd().map((row) => ({
      path: row.cwd,
      sessionCount: row.session_count,
      lastActivityAt: row.last_activity_at,
    }))
  }

  // --- analityka (Etapy 8c i 10) ---

  contextBreakdown(sessionId: string): ContextBreakdown | null {
    const row = this.cache.getBySession(sessionId)
    if (!row) return null

    const tools = this.cache.toolUsage(sessionId).map((usage) => ({
      toolName: usage.tool_name,
      calls: usage.calls,
      resultChars: usage.result_chars,
    }))

    return {
      sessionId,
      tools,
      largestResults: this.cache.largestResults(sessionId).map((result) => ({
        toolName: result.tool_name,
        resultChars: result.result_chars,
        timestamp: result.ts,
      })),
      totalResultChars: tools.reduce((sum, tool) => sum + tool.resultChars, 0),
      metrics: metricsOf(row),
    }
  }

  usageByProject(window: UsageWindow, displayName: (path: string) => string | null): ProjectUsage[] {
    const since = localDay(Date.now() - (WINDOW_DAYS[window] - 1) * 86_400_000)
    return this.cache.usageByProject(since).map((row) => ({
      projectPath: row.cwd,
      projectName: displayName(row.cwd) ?? basename(row.cwd),
      inputTokens: row.input_tokens,
      cacheCreationTokens: row.cache_creation_tokens,
      cacheReadTokens: row.cache_read_tokens,
      outputTokens: row.output_tokens,
      totalTokens: row.input_tokens + row.cache_creation_tokens + row.cache_read_tokens + row.output_tokens,
      requests: row.requests,
      sessionCount: row.session_count,
      avgPeakContext: row.avg_peak_context,
      maxPeakContext: row.max_peak_context,
    }))
  }

  // --- wyszukiwanie (Etap 9) ---

  search(query: string, limit = 50): SearchHit[] {
    const prepared = toFtsQuery(query)
    if (prepared === '') return []

    return this.cache.search(prepared, limit).map((hit) => ({
      sessionId: hit.session_id,
      projectPath: hit.cwd,
      title: hit.title,
      role: hit.role === 'assistant' ? 'assistant' : 'user',
      timestamp: hit.ts,
      lastActivityAt: hit.last_activity_at,
      snippet: hit.snippet,
    }))
  }

  searchIndexSize(): number {
    return this.cache.searchIndexSize()
  }

  // --- nasze własne dane o sesjach (§25 planu) ---

  setLabel(sessionId: string, label: string | null): void {
    this.upsertMeta(sessionId, { label })
  }

  setFavorite(sessionId: string, isFavorite: boolean): void {
    this.upsertMeta(sessionId, { is_favorite: isFavorite ? 1 : 0 })
  }

  setNotes(sessionId: string, notes: string | null): void {
    this.upsertMeta(sessionId, { notes })
  }

  setTags(sessionId: string, tags: string[]): void {
    const cleaned = [...new Set(tags.map((tag) => tag.trim().toLowerCase()).filter((tag) => tag !== ''))]
    this.upsertMeta(sessionId, { tags: cleaned.length > 0 ? JSON.stringify(cleaned) : null })
  }

  /** Usuwa sesję z indeksu aplikacji. Transkrypt Claude Code zostaje nietknięty (§5 planu). */
  hideFromIndex(sessionId: string): void {
    this.upsertMeta(sessionId, { is_hidden: 1 })
  }

  // --- wewnętrzne ---

  private async transcriptsIn(directory: string): Promise<string[]> {
    try {
      const entries = await readdir(directory, { withFileTypes: true })
      return entries
        .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
        .map((entry) => join(directory, entry.name))
    } catch {
      return []
    }
  }

  /** Łączy dane z transkryptów z naszymi etykietami, ulubionymi, notatkami i tagami. */
  private decorate(rows: CachedSessionRow[]): ClaudeSession[] {
    if (rows.length === 0) return []

    const placeholders = rows.map(() => '?').join(',')
    const meta = new Map(
      this.db
        .prepare<string[], SessionMetaRow>(
          `SELECT * FROM session_meta WHERE session_id IN (${placeholders})`
        )
        .all(...rows.map((row) => row.session_id))
        .map((row) => [row.session_id, row])
    )

    return rows
      .filter((row) => meta.get(row.session_id)?.is_hidden !== 1)
      .map((row) => {
        const own = meta.get(row.session_id)
        return {
          sessionId: row.session_id,
          filePath: row.file_path,
          projectPath: row.cwd,
          title: row.title,
          label: own?.label ?? null,
          gitBranch: row.git_branch,
          claudeVersion: row.claude_version,
          createdAt: row.created_at,
          lastActivityAt: row.last_activity_at,
          sizeBytes: row.size,
          isFavorite: own?.is_favorite === 1,
          metrics: metricsOf(row),
          notes: own?.notes ?? null,
          tags: parseTags(own?.tags ?? null),
        }
      })
  }

  /**
   * Aktualizuje tylko te kolumny, które faktycznie podano.
   *
   * Świadomie bez `COALESCE` — przy nim `label: null` znaczyłoby "nie zmieniaj",
   * więc nie dałoby się skasować raz nadanej etykiety.
   */
  private upsertMeta(sessionId: string, patch: Partial<Omit<SessionMetaRow, 'session_id'>>): void {
    this.db.prepare('INSERT OR IGNORE INTO session_meta (session_id) VALUES (?)').run(sessionId)

    const assignments: string[] = []
    const params: Record<string, unknown> = { session_id: sessionId }

    for (const column of ['label', 'is_favorite', 'is_hidden', 'notes', 'tags'] as const) {
      if (!(column in patch)) continue
      assignments.push(`${column} = @${column}`)
      params[column] = patch[column] ?? null
    }
    if (assignments.length === 0) return

    this.db
      .prepare(`UPDATE session_meta SET ${assignments.join(', ')} WHERE session_id = @session_id`)
      .run(params)
  }
}

function metricsOf(row: CachedSessionRow): SessionMetrics {
  return {
    inputTokens: row.input_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    cacheReadTokens: row.cache_read_tokens,
    outputTokens: row.output_tokens,
    peakContext: row.peak_context,
    requestCount: row.request_count,
    toolCallCount: row.tool_call_count,
  }
}

function parseTags(raw: string | null): string[] {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as unknown
    return Array.isArray(parsed) ? parsed.filter((tag): tag is string => typeof tag === 'string') : []
  } catch {
    return []
  }
}

/**
 * Zamienia wpisany tekst na zapytanie FTS5.
 *
 * Składnia FTS traktuje kropki, myślniki i cudzysłowy specjalnie — użytkownik wpisujący
 * `webhook-handler` dostałby błąd zamiast wyników. Każde słowo otaczamy cudzysłowami
 * i dodajemy `*`, żeby trafiały też prefiksy (`webhook` znajdzie `webhooki`).
 *
 * Szukamy w obu kolumnach: `text` (oryginał) i `folded` (z `ł` złożonym do `l`), a słowa
 * zapytania składamy tak samo. Dzięki temu `poprawilem` trafia `Poprawiłem`. Podświetlenie
 * pochodzi z oryginału, więc dla słów z `ł` trafienie jest, ale bez wyróżnienia.
 */
function toFtsQuery(input: string): string {
  const terms = input
    .split(/\s+/)
    .map((word) => foldPolish(word.replace(/"/g, '').trim()))
    .filter((word) => word !== '')
    .map((word) => `"${word}"*`)
  return terms.length === 0 ? '' : `{text folded} : (${terms.join(' ')})`
}
