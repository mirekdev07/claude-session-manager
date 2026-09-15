/** Handlery IPC dotyczące samego CLI Claude Code (lokalizacja, wersja, health check). */
import { ipcMain } from 'electron'
import { IPC } from '@shared/ipc-contract'
import type { ClaudeCliInfo } from '@shared/types'
import { locateClaudeCli } from '@main/claude/locator'
import type { SettingsService } from '@main/storage/settings'

/** Lokalizacja jest kosztowna (odpala proces), a wynik zmienia się rzadko — trzymamy go w pamięci. */
let cached: ClaudeCliInfo | null = null

export function registerClaudeIpc(settings: SettingsService): void {
  ipcMain.handle(IPC.claude.info, async (): Promise<ClaudeCliInfo> => {
    cached ??= await locateClaudeCli(settings.get().claudeExecutablePath ?? undefined)
    return cached
  })
}

/** Wołane po zmianie ścieżki w Ustawieniach. */
export function invalidateClaudeInfo(): void {
  cached = null
}
