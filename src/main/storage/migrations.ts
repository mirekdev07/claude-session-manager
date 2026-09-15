/**
 * Schemat bazy i migracje.
 *
 * Wydzielone z `db.ts`, które zna ścieżkę do pliku przez `electron.app` — dzięki temu
 * schemat da się otworzyć i przetestować bez uruchamiania całego Electrona.
 *
 * Migracje są numerowane przez `user_version`. Nową dopisujemy na końcu tablicy;
 * wydanej nigdy nie modyfikujemy, bo u kogoś już się wykonała.
 */
import type { Database } from 'better-sqlite3'

export const MIGRATIONS: Array<(db: Database) => void> = [
  (db) => {
    db.exec(`
      CREATE TABLE projects (
        path            TEXT PRIMARY KEY,
        display_name    TEXT,
        is_favorite     INTEGER NOT NULL DEFAULT 0,
        is_hidden       INTEGER NOT NULL DEFAULT 0,
        added_at        INTEGER NOT NULL,
        last_opened_at  INTEGER
      );

      -- Cache metadanych transkryptów. Wpis jest ważny, dopóki zgadzają się mtime i size.
      CREATE TABLE session_cache (
        file_path         TEXT PRIMARY KEY,
        mtime             REAL    NOT NULL,
        size              INTEGER NOT NULL,
        session_id        TEXT    NOT NULL,
        cwd               TEXT,
        git_branch        TEXT,
        claude_version    TEXT,
        title             TEXT,
        created_at        REAL    NOT NULL,
        last_activity_at  REAL    NOT NULL
      );
      CREATE INDEX idx_session_cache_cwd ON session_cache(cwd);
      CREATE INDEX idx_session_cache_activity ON session_cache(last_activity_at DESC);

      -- Nasze własne dane o sesjach. Usunięcie wiersza nie rusza transkryptu Claude Code.
      CREATE TABLE session_meta (
        session_id   TEXT PRIMARY KEY,
        label        TEXT,
        is_favorite  INTEGER NOT NULL DEFAULT 0,
        is_hidden    INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE settings (
        key    TEXT PRIMARY KEY,
        value  TEXT NOT NULL
      );

      CREATE TABLE open_tabs (
        position     INTEGER PRIMARY KEY,
        project_path TEXT NOT NULL,
        session_id   TEXT,
        mode         TEXT NOT NULL
      );
    `)
  },

  // Migracja 2 — metryki tokenów liczone przyrostowo z transkryptów (Część II planu, Etap 8a).
  (db) => {
    db.exec(`
      -- Do jakiego bajtu plik został już przetworzony; zmiana pliku poniżej tej granicy
      -- (plik skrócony lub podmieniony) wymusza przeliczenie od zera.
      ALTER TABLE session_cache ADD COLUMN parsed_bytes           INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE session_cache ADD COLUMN input_tokens           INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE session_cache ADD COLUMN cache_creation_tokens  INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE session_cache ADD COLUMN cache_read_tokens      INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE session_cache ADD COLUMN output_tokens          INTEGER NOT NULL DEFAULT 0;
      -- Największe okno kontekstu w pojedynczym zapytaniu: input + cache_creation + cache_read.
      ALTER TABLE session_cache ADD COLUMN peak_context           INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE session_cache ADD COLUMN request_count          INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE session_cache ADD COLUMN tool_call_count        INTEGER NOT NULL DEFAULT 0;
      ALTER TABLE session_cache ADD COLUMN first_activity_at      REAL;
      -- Wywołania narzędzi, których wynik nie zdążył trafić do tego samego przyrostu (JSON id -> nazwa).
      ALTER TABLE session_cache ADD COLUMN pending_tools          TEXT;

      CREATE TABLE session_tool_usage (
        session_id    TEXT    NOT NULL,
        tool_name     TEXT    NOT NULL,
        calls         INTEGER NOT NULL DEFAULT 0,
        result_chars  INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (session_id, tool_name)
      );

      -- Największe pojedyncze wyniki narzędzi; przycinane do kilkunastu na sesję.
      CREATE TABLE session_tool_results (
        session_id    TEXT    NOT NULL,
        tool_name     TEXT    NOT NULL,
        result_chars  INTEGER NOT NULL,
        ts            REAL
      );
      CREATE INDEX idx_tool_results_session ON session_tool_results(session_id, result_chars DESC);

      -- Zużycie w kubełkach dziennych — dzięki temu okna 24 h / 7 dni / 30 dni są dokładne
      -- także dla sesji ciągnących się tygodniami.
      CREATE TABLE usage_daily (
        day                    TEXT    NOT NULL,
        session_id             TEXT    NOT NULL,
        cwd                    TEXT,
        input_tokens           INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens  INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens      INTEGER NOT NULL DEFAULT 0,
        output_tokens          INTEGER NOT NULL DEFAULT 0,
        requests               INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (day, session_id)
      );
      CREATE INDEX idx_usage_daily_day ON usage_daily(day);
    `)
  },

  // Migracja 3 — indeks pełnotekstowy rozmów (Etap 9). Zasilany tym samym przebiegiem co metryki.
  //
  // `remove_diacritics` składa ą ę ó ś ź ż ć ń (mają rozkład Unicode na literę + znak), ale NIE ł —
  // to osobna litera bez rozkładu. Dlatego obok oryginału trzymamy kolumnę `folded` z ł→l,
  // a zapytanie przeszukuje obie. Podświetlenie bierzemy z oryginału.
  (db) => {
    db.exec(`
      CREATE VIRTUAL TABLE session_search USING fts5(
        session_id UNINDEXED,
        ts         UNINDEXED,
        role       UNINDEXED,
        text,
        folded,
        tokenize = 'unicode61 remove_diacritics 2'
      );
    `)
  },

  // Migracja 4 — notatki i tagi sesji (Etap 12.4). Tagi jako JSON, bo lista jest krótka i czytana w całości.
  (db) => {
    db.exec(`
      ALTER TABLE session_meta ADD COLUMN notes TEXT;
      ALTER TABLE session_meta ADD COLUMN tags  TEXT;
    `)
  },
]

export function migrate(db: Database): void {
  const current = db.pragma('user_version', { simple: true }) as number

  for (let version = current; version < MIGRATIONS.length; version++) {
    const migration = MIGRATIONS[version]
    if (!migration) continue
    db.transaction(() => {
      migration(db)
      db.pragma(`user_version = ${version + 1}`)
    })()
  }
}
