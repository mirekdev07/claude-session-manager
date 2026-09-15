/**
 * Odczyt i zapis ustawień.
 *
 * Trzymane w tabeli klucz–wartość, ale zawsze przepuszczane przez schemat — dzięki temu
 * uszkodzony albo przestarzały wpis nie wywraca startu aplikacji, tylko wraca do wartości domyślnej.
 */
import type { Database } from 'better-sqlite3'
import { settingsSchema, type AppSettings } from '@shared/settings'

export class SettingsService {
  constructor(private readonly db: Database) {}

  get(): AppSettings {
    const rows = this.db
      .prepare<[], { key: string; value: string }>('SELECT key, value FROM settings')
      .all()

    const raw: Record<string, unknown> = {}
    for (const row of rows) {
      try {
        raw[row.key] = JSON.parse(row.value)
      } catch {
        // Uszkodzony wpis pomijamy — schemat podstawi wartość domyślną.
      }
    }

    const parsed = settingsSchema.safeParse(raw)
    return parsed.success ? parsed.data : settingsSchema.parse({})
  }

  /** @throws gdy którakolwiek wartość nie przechodzi walidacji */
  update(patch: Partial<AppSettings>): AppSettings {
    const next = settingsSchema.parse({ ...this.get(), ...patch })

    const statement = this.db.prepare(
      `INSERT INTO settings (key, value) VALUES (?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value`
    )
    this.db.transaction(() => {
      for (const [key, value] of Object.entries(next)) statement.run(key, JSON.stringify(value))
    })()

    return next
  }
}
