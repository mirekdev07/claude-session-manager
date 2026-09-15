/**
 * Lokalna baza aplikacji.
 *
 * Trzymamy tu wyłącznie **nasze** dane: listę projektów, aliasy, ulubione, ustawienia
 * i cache metadanych sesji. Transkrypty pozostają własnością Claude Code i nie są
 * kopiowane do bazy (§25 planu).
 */
import { mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import Database from 'better-sqlite3'
import { app } from 'electron'
import { migrate } from './migrations'

let instance: Database.Database | null = null

export function getDatabase(): Database.Database {
  if (instance) return instance

  const file = join(app.getPath('userData'), 'claude-session-manager.db')
  mkdirSync(dirname(file), { recursive: true })

  instance = openDatabase(file)
  return instance
}

/** Otwiera bazę pod wskazaną ścieżką. Wydzielone, żeby dało się testować bez Electrona. */
export function openDatabase(file: string): Database.Database {
  const db = new Database(file)
  // WAL pozwala czytać w trakcie zapisu — skanowanie sesji nie blokuje wtedy interfejsu.
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

export function closeDatabase(): void {
  instance?.close()
  instance = null
}
