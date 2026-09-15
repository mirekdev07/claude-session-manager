/** Handlery IPC listy projektów. */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import {
  projectFavoriteSchema,
  projectPathSchema,
  projectRenameSchema,
} from '@shared/schemas'
import type { Project } from '@shared/types'
import type { ClaudeProcessManager } from '@main/claude/process-manager'
import type { ProjectManager } from '@main/projects/manager'
import { tMain } from '@main/i18n'

export function registerProjectsIpc(
  projects: ProjectManager,
  processes: ClaudeProcessManager,
  getWindow: () => BrowserWindow | null
): void {
  // Każda mutacja zwraca świeżą listę, żeby renderer nie musiał wołać `list` osobno.
  const list = (): Promise<Project[]> => projects.list(processes.runningCountByCwd())

  ipcMain.handle(IPC.projects.list, list)

  ipcMain.handle(IPC.projects.pickFolder, async (): Promise<string | null> => {
    const window = getWindow()
    const options: Electron.OpenDialogOptions = {
      title: tMain('dialog.pickFolder'),
      properties: ['openDirectory', 'createDirectory'],
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    return result.canceled ? null : (result.filePaths[0] ?? null)
  })

  ipcMain.handle(IPC.projects.add, async (_event, raw: unknown) => {
    await projects.add(projectPathSchema.parse(raw))
    return list()
  })

  ipcMain.handle(IPC.projects.remove, async (_event, raw: unknown) => {
    projects.remove(projectPathSchema.parse(raw))
    return list()
  })

  ipcMain.handle(IPC.projects.rename, async (_event, raw: unknown) => {
    const { path, displayName } = projectRenameSchema.parse(raw)
    projects.rename(path, displayName)
    return list()
  })

  ipcMain.handle(IPC.projects.setFavorite, async (_event, raw: unknown) => {
    const { path, isFavorite } = projectFavoriteSchema.parse(raw)
    projects.setFavorite(path, isFavorite)
    return list()
  })

  ipcMain.handle(IPC.projects.openFolder, async (_event, raw: unknown) =>
    projects.openInExplorer(projectPathSchema.parse(raw))
  )

  ipcMain.handle(IPC.projects.openInEditor, async (_event, raw: unknown) =>
    projects.openInEditor(projectPathSchema.parse(raw))
  )
}
