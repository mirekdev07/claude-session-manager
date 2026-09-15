/**
 * Cache metadanych i metryk transkryptów.
 *
 * Skanowanie 55 katalogów przy każdym otwarciu listy byłoby zauważalne, a same pliki
 * zmieniają się rzadko. Wpis jest ważny dopóki zgadzają się `mtime` i `size` — dowolna
 * zmiana treści zmienia oba, więc nie potrzeba haszowania zawartości.
 *
 * Metryki tokenów są doliczane przyrostowo (patrz `transcript-metrics`): `parsed_bytes`
 * mówi, do którego bajtu plik został już przetworzony.
 */
import type { Database } from 'better-sqlite3'
import type { SessionMetadata } from '@main/claude/transcript-reader'
import type { TranscriptIncrement } from '@main/claude/transcript-metrics'

export interface CachedSessionRow {
  file_path: string
  mtime: number
  size: number
  session_id: string
  cwd: string | null
  git_branch: string | null
  claude_version: string | null
  title: string | null
  created_at: number
  last_activity_at: number
  parsed_bytes: number
  input_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
  output_tokens: number
  peak_context: number
  request_count: number
  tool_call_count: number
  first_activity_at: number | null
  pending_tools: string | null
}

export interface MetricsState {
  sessionId: string
  cwd: string | null
  parsedBytes: number
  pendingTools: Record<string, string>
}

export interface ToolUsageRow {
  tool_name: string
  calls: number
  result_chars: number
}

export interface LargeResultRow {
  tool_name: string
  result_chars: number
  ts: number | null
}

export interface ProjectUsageRow {
  cwd: string
  input_tokens: number
  cache_creation_tokens: number
  cache_read_tokens: number
  output_tokens: number
  requests: number
  session_count: number
  avg_peak_context: number
  max_peak_context: number
}

export interface SearchHitRow {
  session_id: string
  ts: number | null
  role: string
  snippet: string
  cwd: string | null
  title: string | null
  last_activity_at: number
}

/**
 * Sesje bez ani jednego promptu użytkownika i o znikomym rozmiarze to zwykle procesy,
 * które zmarły zaraz po starcie. Nie ma czego w nich wznawiać, więc nie zaśmiecają listy.
 * Warunek jest wspólny dla listowania i statystyk, żeby licznik zgadzał się z tym, co widać.
 */
const NON_EMPTY = '(title IS NOT NULL OR size >= 1024)'

/** Ile największych wyników narzędzi trzymamy na sesję. */
const LARGE_RESULTS_PER_SESSION = 12

export class SessionCache {
  constructor(private readonly db: Database) {}

  /** Zwraca wpis tylko wtedy, gdy plik nie zmienił się od zapisania cache. */
  getFresh(filePath: string, mtime: number, size: number): CachedSessionRow | null {
    const row = this.db
      .prepare<[string, number, number], CachedSessionRow>(
        'SELECT * FROM session_cache WHERE file_path = ? AND mtime = ? AND size = ?'
      )
      .get(filePath, mtime, size)
    return row ?? null
  }

  put(metadata: SessionMetadata, mtime: number): void {
    this.db
      .prepare(
        `INSERT INTO session_cache
           (file_path, mtime, size, session_id, cwd, git_branch, claude_version, title, created_at, last_activity_at)
         VALUES (@file_path, @mtime, @size, @session_id, @cwd, @git_branch, @claude_version, @title, @created_at, @last_activity_at)
         ON CONFLICT(file_path) DO UPDATE SET
           mtime = excluded.mtime,
           size = excluded.size,
           session_id = excluded.session_id,
           cwd = excluded.cwd,
           git_branch = excluded.git_branch,
           claude_version = excluded.claude_version,
           title = excluded.title,
           created_at = excluded.created_at,
           last_activity_at = excluded.last_activity_at`
      )
      .run({
        file_path: metadata.filePath,
        mtime,
        size: metadata.sizeBytes,
        session_id: metadata.sessionId,
        cwd: metadata.cwd,
        git_branch: metadata.gitBranch,
        claude_version: metadata.claudeVersion,
        title: metadata.title,
        created_at: metadata.createdAt,
        last_activity_at: metadata.lastActivityAt,
      })
  }

  /** Wołane, gdy transkrypt zniknął z dysku. Sprząta też metryki i indeks tej sesji. */
  remove(filePath: string): void {
    const row = this.db
      .prepare<[string], { session_id: string }>('SELECT session_id FROM session_cache WHERE file_path = ?')
      .get(filePath)
    this.db.transaction(() => {
      if (row) this.dropMetrics(row.session_id)
      this.db.prepare('DELETE FROM session_cache WHERE file_path = ?').run(filePath)
    })()
  }

  // --- metryki ---

  getMetricsState(filePath: string): MetricsState | null {
    const row = this.db
      .prepare<[string], Pick<CachedSessionRow, 'session_id' | 'cwd' | 'parsed_bytes' | 'pending_tools'>>(
        'SELECT session_id, cwd, parsed_bytes, pending_tools FROM session_cache WHERE file_path = ?'
      )
      .get(filePath)
    if (!row) return null

    let pendingTools: Record<string, string> = {}
    if (row.pending_tools) {
      try {
        pendingTools = JSON.parse(row.pending_tools) as Record<string, string>
      } catch {
        pendingTools = {}
      }
    }
    return { sessionId: row.session_id, cwd: row.cwd, parsedBytes: row.parsed_bytes, pendingTools }
  }

  /**
   * Dolicza przyrost do zapisanych sum. Przy `reset` najpierw zeruje wszystko —
   * to ścieżka dla pliku skróconego lub podmienionego.
   */
  applyIncrement(filePath: string, sessionId: string, delta: TranscriptIncrement, reset: boolean): void {
    this.db.transaction(() => {
      if (reset) this.dropMetrics(sessionId)

      this.db
        .prepare(
          `UPDATE session_cache SET
             parsed_bytes          = @parsed_bytes,
             input_tokens          = ${reset ? '0' : 'input_tokens'} + @input_tokens,
             cache_creation_tokens = ${reset ? '0' : 'cache_creation_tokens'} + @cache_creation_tokens,
             cache_read_tokens     = ${reset ? '0' : 'cache_read_tokens'} + @cache_read_tokens,
             output_tokens         = ${reset ? '0' : 'output_tokens'} + @output_tokens,
             peak_context          = MAX(${reset ? '0' : 'peak_context'}, @peak_context),
             request_count         = ${reset ? '0' : 'request_count'} + @request_count,
             tool_call_count       = ${reset ? '0' : 'tool_call_count'} + @tool_call_count,
             first_activity_at     = COALESCE(${reset ? 'NULL' : 'first_activity_at'}, @first_activity_at),
             pending_tools         = @pending_tools
           WHERE file_path = @file_path`
        )
        .run({
          file_path: filePath,
          parsed_bytes: delta.parsedBytes,
          input_tokens: delta.inputTokens,
          cache_creation_tokens: delta.cacheCreationTokens,
          cache_read_tokens: delta.cacheReadTokens,
          output_tokens: delta.outputTokens,
          peak_context: delta.peakContext,
          request_count: delta.requestCount,
          tool_call_count: delta.toolCallCount,
          first_activity_at: delta.firstActivityAt,
          pending_tools: Object.keys(delta.pendingTools).length > 0 ? JSON.stringify(delta.pendingTools) : null,
        })

      const upsertTool = this.db.prepare(
        `INSERT INTO session_tool_usage (session_id, tool_name, calls, result_chars)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(session_id, tool_name) DO UPDATE SET
           calls = calls + excluded.calls,
           result_chars = result_chars + excluded.result_chars`
      )
      for (const [name, aggregate] of delta.tools) {
        upsertTool.run(sessionId, name, aggregate.calls, aggregate.resultChars)
      }

      if (delta.largeResults.length > 0) {
        const insertResult = this.db.prepare(
          'INSERT INTO session_tool_results (session_id, tool_name, result_chars, ts) VALUES (?, ?, ?, ?)'
        )
        for (const item of delta.largeResults) {
          insertResult.run(sessionId, item.toolName, item.resultChars, item.timestamp)
        }
        // Zostawiamy tylko największe — pełna lista rosłaby razem z transkryptem.
        this.db
          .prepare(
            `DELETE FROM session_tool_results
              WHERE session_id = ? AND rowid NOT IN (
                SELECT rowid FROM session_tool_results
                 WHERE session_id = ? ORDER BY result_chars DESC LIMIT ?
              )`
          )
          .run(sessionId, sessionId, LARGE_RESULTS_PER_SESSION)
      }

      const cwd = delta.cwd ?? this.getCwdBySession(sessionId)
      const upsertDaily = this.db.prepare(
        `INSERT INTO usage_daily
           (day, session_id, cwd, input_tokens, cache_creation_tokens, cache_read_tokens, output_tokens, requests)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(day, session_id) DO UPDATE SET
           cwd = COALESCE(excluded.cwd, cwd),
           input_tokens = input_tokens + excluded.input_tokens,
           cache_creation_tokens = cache_creation_tokens + excluded.cache_creation_tokens,
           cache_read_tokens = cache_read_tokens + excluded.cache_read_tokens,
           output_tokens = output_tokens + excluded.output_tokens,
           requests = requests + excluded.requests`
      )
      for (const [day, bucket] of delta.daily) {
        upsertDaily.run(
          day,
          sessionId,
          cwd,
          bucket.inputTokens,
          bucket.cacheCreationTokens,
          bucket.cacheReadTokens,
          bucket.outputTokens,
          bucket.requests
        )
      }

      if (delta.searchRows.length > 0) {
        const insertSearch = this.db.prepare(
          'INSERT INTO session_search (session_id, ts, role, text, folded) VALUES (?, ?, ?, ?, ?)'
        )
        for (const row of delta.searchRows) {
          insertSearch.run(sessionId, row.timestamp, row.role, row.text, foldPolish(row.text))
        }
      }
    })()
  }

  /** Sesje bez przypisanego katalogu dostają go później — kubełki dzienne muszą to dogonić. */
  backfillCwd(sessionId: string, cwd: string): void {
    this.db.prepare('UPDATE usage_daily SET cwd = ? WHERE session_id = ? AND cwd IS NULL').run(cwd, sessionId)
  }

  toolUsage(sessionId: string): ToolUsageRow[] {
    return this.db
      .prepare<[string], ToolUsageRow>(
        'SELECT tool_name, calls, result_chars FROM session_tool_usage WHERE session_id = ? ORDER BY result_chars DESC'
      )
      .all(sessionId)
  }

  largestResults(sessionId: string): LargeResultRow[] {
    return this.db
      .prepare<[string], LargeResultRow>(
        'SELECT tool_name, result_chars, ts FROM session_tool_results WHERE session_id = ? ORDER BY result_chars DESC'
      )
      .all(sessionId)
  }

  /**
   * Zużycie per katalog roboczy od podanego dnia (włącznie).
   * Szczytowy kontekst bierzemy z sesji, które miały aktywność w oknie.
   */
  usageByProject(sinceDay: string): ProjectUsageRow[] {
    return this.db
      .prepare<[string], ProjectUsageRow>(
        `WITH windowed AS (
           SELECT cwd, session_id,
                  SUM(input_tokens) AS input_tokens,
                  SUM(cache_creation_tokens) AS cache_creation_tokens,
                  SUM(cache_read_tokens) AS cache_read_tokens,
                  SUM(output_tokens) AS output_tokens,
                  SUM(requests) AS requests
             FROM usage_daily
            WHERE day >= ? AND cwd IS NOT NULL
            GROUP BY cwd, session_id
         )
         SELECT w.cwd,
                SUM(w.input_tokens) AS input_tokens,
                SUM(w.cache_creation_tokens) AS cache_creation_tokens,
                SUM(w.cache_read_tokens) AS cache_read_tokens,
                SUM(w.output_tokens) AS output_tokens,
                SUM(w.requests) AS requests,
                COUNT(*) AS session_count,
                CAST(AVG(COALESCE(c.peak_context, 0)) AS INTEGER) AS avg_peak_context,
                MAX(COALESCE(c.peak_context, 0)) AS max_peak_context
           FROM windowed w
           LEFT JOIN session_cache c ON c.session_id = w.session_id
          GROUP BY w.cwd
          ORDER BY (SUM(w.input_tokens) + SUM(w.cache_creation_tokens) + SUM(w.cache_read_tokens) + SUM(w.output_tokens)) DESC`
      )
      .all(sinceDay)
  }

  /**
   * Wyszukiwanie pełnotekstowe z podświetleniem trafienia.
   * @param query gotowe wyrażenie FTS5 (patrz `toFtsQuery` w session-provider)
   */
  search(query: string, limit: number): SearchHitRow[] {
    return this.db
      .prepare<[string, number], SearchHitRow>(
        `SELECT s.session_id, s.ts, s.role,
                snippet(session_search, 3, '⟦', '⟧', '…', 18) AS snippet,
                c.cwd, c.title, c.last_activity_at
           FROM session_search s
           LEFT JOIN session_cache c ON c.session_id = s.session_id
          WHERE session_search MATCH ?
          ORDER BY bm25(session_search), s.ts DESC
          LIMIT ?`
      )
      .all(query, limit)
  }

  searchIndexSize(): number {
    const row = this.db
      .prepare<[], { n: number }>('SELECT COUNT(*) AS n FROM session_search')
      .get()
    return row?.n ?? 0
  }

  // --- listowanie ---

  /** Katalog roboczy przypisany do transkryptu; `null` gdy pliku nie ma jeszcze w cache. */
  getCwd(filePath: string): string | null {
    const row = this.db
      .prepare<[string], { cwd: string | null }>('SELECT cwd FROM session_cache WHERE file_path = ?')
      .get(filePath)
    return row?.cwd ?? null
  }

  getCwdBySession(sessionId: string): string | null {
    const row = this.db
      .prepare<[string], { cwd: string | null }>('SELECT cwd FROM session_cache WHERE session_id = ?')
      .get(sessionId)
    return row?.cwd ?? null
  }

  getBySession(sessionId: string): CachedSessionRow | null {
    const row = this.db
      .prepare<[string], CachedSessionRow>('SELECT * FROM session_cache WHERE session_id = ?')
      .get(sessionId)
    return row ?? null
  }

  /**
   * Katalog roboczy dowolnego transkryptu leżącego w tym samym folderze Claude Code.
   *
   * Sesje, które zmarły zaraz po starcie, mają w pliku same wpisy sterujące i nie zawierają
   * `cwd`. Ponieważ Claude Code grupuje transkrypty po katalogu projektu, sąsiedni plik
   * z tego samego folderu wskazuje właściwą ścieżkę.
   */
  getCwdInDirectory(directoryPrefix: string): string | null {
    const row = this.db
      .prepare<[string], { cwd: string }>(
        `SELECT cwd FROM session_cache
          WHERE file_path LIKE ? ESCAPE '\\' AND cwd IS NOT NULL
          LIMIT 1`
      )
      .get(`${escapeLike(directoryPrefix)}%`)
    return row?.cwd ?? null
  }

  listByCwd(cwd: string): CachedSessionRow[] {
    return this.db
      .prepare<[string], CachedSessionRow>(
        `SELECT * FROM session_cache
          WHERE cwd = ? AND ${NON_EMPTY}
          ORDER BY last_activity_at DESC`
      )
      .all(cwd)
  }

  listRecent(limit: number): CachedSessionRow[] {
    return this.db
      .prepare<[number], CachedSessionRow>(
        `SELECT * FROM session_cache
          WHERE ${NON_EMPTY}
          ORDER BY last_activity_at DESC
          LIMIT ?`
      )
      .all(limit)
  }

  /** Podsumowanie per katalog roboczy — zasila listę wykrytych projektów. */
  summarizeByCwd(): Array<{ cwd: string; session_count: number; last_activity_at: number }> {
    return this.db
      .prepare<[], { cwd: string; session_count: number; last_activity_at: number }>(
        `SELECT cwd, COUNT(*) AS session_count, MAX(last_activity_at) AS last_activity_at
           FROM session_cache
          WHERE cwd IS NOT NULL AND ${NON_EMPTY}
          GROUP BY cwd
          ORDER BY last_activity_at DESC`
      )
      .all()
  }

  /** Ścieżki plików obecne w cache — potrzebne, by wykryć transkrypty usunięte z dysku. */
  allFilePaths(): string[] {
    return this.db
      .prepare<[], { file_path: string }>('SELECT file_path FROM session_cache')
      .all()
      .map((row) => row.file_path)
  }

  private dropMetrics(sessionId: string): void {
    this.db.prepare('DELETE FROM session_tool_usage WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM session_tool_results WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM usage_daily WHERE session_id = ?').run(sessionId)
    this.db.prepare('DELETE FROM session_search WHERE session_id = ?').run(sessionId)
  }
}

/**
 * Składa `ł` do `l` — jedyna polska litera, której tokenizer FTS5 nie potrafi uprościć sam.
 * Reszta diakrytyków ma rozkład Unicode i obsługuje ją `remove_diacritics`.
 */
export function foldPolish(text: string): string {
  return text.replace(/ł/g, 'l').replace(/Ł/g, 'L')
}

/** Ścieżki na Windows zawierają `\`, który w LIKE jest znakiem ucieczki; `_` i `%` są wieloznacznikami. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`)
}
