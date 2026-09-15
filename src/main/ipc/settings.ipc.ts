/** Handlery IPC ustawień. */
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import { settingsSchema, type AppSettings } from '@shared/settings'
import type { SettingsService } from '@main/storage/settings'
import { invalidateClaudeInfo } from './claude.ipc'

export function registerSettingsIpc(settings: SettingsService): void {
  ipcMain.handle(IPC.settings.get, (): AppSettings => settings.get())

  ipcMain.handle(IPC.settings.update, (_event, raw: unknown): AppSettings => {
    const patch = settingsSchema.partial().parse(raw)
    const next = settings.update(patch)

    // Zmiana ścieżki do executable unieważnia zapamiętany wynik wykrywania.
    if ('claudeExecutablePath' in patch) invalidateClaudeInfo()

    return next
  })
}
