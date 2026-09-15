/**
 * Zapamiętywanie otwartych zakładek (Etap 12.1).
 *
 * Renderer zapisuje listę przy każdej zmianie, a przy starcie odczytuje ją tylko wtedy,
 * gdy użytkownik włączył przywracanie — bo przywrócenie oznacza uruchomienie procesów Claude.
 */
import { ipcMain } from 'electron'
import type { Database } from 'better-sqlite3'
import { z } from 'zod'
import { IPC } from '@shared/ipc-contract'
import type { SavedTab } from '@shared/types'

const savedTabsSchema = z
  .array(
    z.object({
      projectPath: z.string().min(1).max(4096),
      sessionId: z.string().max(200).nullable(),
      mode: z.enum(['new', 'continue', 'resume', 'fork']),
    })
  )
  .max(40)

export function registerTabsIpc(db: Database): void {
  ipcMain.handle(IPC.tabs.save, (_event, raw: unknown): void => {
    const tabs = savedTabsSchema.parse(raw)
    db.transaction(() => {
      db.prepare('DELETE FROM open_tabs').run()
      const insert = db.prepare(
        'INSERT INTO open_tabs (position, project_path, session_id, mode) VALUES (?, ?, ?, ?)'
      )
      tabs.forEach((tab, index) => insert.run(index, tab.projectPath, tab.sessionId, tab.mode))
    })()
  })

  ipcMain.handle(IPC.tabs.load, (): SavedTab[] =>
    db
      .prepare<[], { project_path: string; session_id: string | null; mode: SavedTab['mode'] }>(
        'SELECT project_path, session_id, mode FROM open_tabs ORDER BY position'
      )
      .all()
      .map((row) => ({ projectPath: row.project_path, sessionId: row.session_id, mode: row.mode }))
  )
}
