/** Handlery IPC listy sesji Claude Code. */
import { writeFile } from 'node:fs/promises'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import {
  projectPathSchema,
  recentLimitSchema,
  sessionFavoriteSchema,
  sessionLabelSchema,
} from '@shared/schemas'
import { z } from 'zod'
import { renderMarkdown } from '@main/claude/export'
import { generateHandoff } from '@main/claude/handoff'
import type { ClaudeSessionProvider } from '@main/claude/session-provider'
import type { ProjectManager } from '@main/projects/manager'
import { tMain } from '@main/i18n'

const sessionIdOnly = z.string().min(1).max(200)
const notesSchema = z.object({ sessionId: sessionIdOnly, notes: z.string().max(20_000).nullable() })
const tagsSchema = z.object({ sessionId: sessionIdOnly, tags: z.array(z.string().max(40)).max(30) })
const searchSchema = z.string().min(1).max(200)
const windowSchema = z.enum(['24h', '7d', '30d'])

export function registerSessionsIpc(
  sessions: ClaudeSessionProvider,
  projects: ProjectManager,
  onScanProgress: (scanned: number, total: number) => void,
  getWindow: () => BrowserWindow | null
): void {
  ipcMain.handle(IPC.sessions.listForProject, (_event, raw: unknown) =>
    sessions.listForProject(projectPathSchema.parse(raw))
  )

  ipcMain.handle(IPC.sessions.listRecent, (_event, raw: unknown) =>
    sessions.listRecent(recentLimitSchema.parse(raw) ?? 20)
  )

  ipcMain.handle(IPC.sessions.rescan, () => sessions.scanAll(onScanProgress))

  ipcMain.handle(IPC.sessions.setLabel, (_event, raw: unknown) => {
    const { sessionId, label } = sessionLabelSchema.parse(raw)
    sessions.setLabel(sessionId, label)
  })

  ipcMain.handle(IPC.sessions.setFavorite, (_event, raw: unknown) => {
    const { sessionId, isFavorite } = sessionFavoriteSchema.parse(raw)
    sessions.setFavorite(sessionId, isFavorite)
  })

  ipcMain.handle(IPC.sessions.removeFromIndex, (_event, raw: unknown) => {
    sessions.hideFromIndex(sessionIdOnly.parse(raw))
  })

  ipcMain.handle(IPC.sessions.setNotes, (_event, raw: unknown) => {
    const { sessionId, notes } = notesSchema.parse(raw)
    sessions.setNotes(sessionId, notes !== null && notes.trim() === '' ? null : notes)
  })

  ipcMain.handle(IPC.sessions.setTags, (_event, raw: unknown) => {
    const { sessionId, tags } = tagsSchema.parse(raw)
    sessions.setTags(sessionId, tags)
  })

  ipcMain.handle(IPC.sessions.contextBreakdown, (_event, raw: unknown) =>
    sessions.contextBreakdown(sessionIdOnly.parse(raw))
  )

  ipcMain.handle(IPC.sessions.search, (_event, raw: unknown) =>
    sessions.search(searchSchema.parse(raw))
  )

  ipcMain.handle(IPC.usage.byProject, (_event, raw: unknown) =>
    sessions.usageByProject(windowSchema.parse(raw), (path) => projects.displayNameFor(path))
  )

  ipcMain.handle(IPC.sessions.summarize, async (_event, raw: unknown): Promise<string> => {
    const session = sessions.getSession(sessionIdOnly.parse(raw))
    if (!session) throw new Error(tMain('err.sessionNotFound'))
    return generateHandoff(session.filePath)
  })

  ipcMain.handle(IPC.sessions.exportMarkdown, async (_event, raw: unknown): Promise<string | null> => {
    const session = sessions.getSession(sessionIdOnly.parse(raw))
    if (!session) throw new Error(tMain('err.sessionNotFound'))

    const suggested = `${(session.label ?? session.title ?? 'session').replace(/[\\/:*?"<>|]+/g, ' ').trim().slice(0, 60) || 'session'}.md`
    const window = getWindow()
    const options: Electron.SaveDialogOptions = {
      title: tMain('dialog.saveMarkdown'),
      defaultPath: suggested,
      filters: [{ name: 'Markdown', extensions: ['md'] }],
    }
    const result = window ? await dialog.showSaveDialog(window, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return null

    await writeFile(result.filePath, await renderMarkdown({
      sessionId: session.sessionId,
      title: session.label ?? session.title,
      projectPath: session.projectPath,
      transcriptPath: session.filePath,
    }), 'utf8')
    return result.filePath
  })
}
