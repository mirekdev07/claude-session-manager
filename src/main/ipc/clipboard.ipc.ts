/** Handler IPC kopiowania do schowka. */
import { clipboard, ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-contract'

// Zaznaczenie w terminalu bywa duże (cały bufor przewijania), ale nie nieograniczone.
const textSchema = z.string().max(5_000_000)

export function registerClipboardIpc(): void {
  ipcMain.handle(IPC.clipboard.writeText, async (_event, raw: unknown): Promise<void> => {
    const text = textSchema.parse(raw)
    if (text === '') return
    await clipboard.writeText(text)
  })
}
