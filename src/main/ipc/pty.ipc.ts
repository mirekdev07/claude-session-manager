/** Handlery IPC dla terminali. Każdy payload przechodzi walidację, zanim dotknie procesu. */
import { basename } from 'node:path'
import { BrowserWindow, ipcMain } from 'electron'
import { z } from 'zod'
import { IPC, PUSH } from '@shared/ipc-contract'
import { ptyCreateSchema, ptyIdSchema, ptyResizeSchema, ptyWriteSchema } from '@shared/schemas'
import type { PtyInfo } from '@shared/types'
import { ClaudeProcessManager } from '@main/claude/process-manager'
import { NotificationService } from '@main/notifications/service'
import type { SettingsService } from '@main/storage/settings'
import { tMain } from '@main/i18n'

const activePtySchema = z.string().uuid().nullable()

export function registerPtyIpc(
  getWindow: () => BrowserWindow | null,
  settings: SettingsService
): ClaudeProcessManager {
  /** Wysyła zdarzenie do renderera tylko wtedy, gdy okno wciąż istnieje. */
  const send = (channel: string, payload: unknown): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  /** Zakładka pokazywana w tej chwili przez renderer — sam main tego nie wie. */
  let activePtyId: string | null = null

  const notifications = new NotificationService(
    getWindow,
    () => settings.get().notifyOnWaiting,
    (ptyId) => {
      const window = getWindow()
      if (window && !window.isDestroyed()) {
        if (window.isMinimized()) window.restore()
        window.focus()
      }
      send(PUSH.focusPty, ptyId)
    }
  )

  const manager = new ClaudeProcessManager(
    {
      onData: (ptyId, chunk) => send(PUSH.ptyData(ptyId), chunk),
      // Enter oznacza, że użytkownik zlecił pracę — dopiero wtedy kolejne „czeka" zasługuje
      // na powiadomienie. Przerysowanie TUI po utracie fokusu albo zmianie rozmiaru go nie uzbraja.
      onInput: (ptyId, data) => {
        if (data.includes('\r') || data.includes('\n')) notifications.arm(ptyId)
      },
      onExit: (event) => {
        notifications.forget(event.ptyId)
        send(PUSH.ptyExit, event)
      },
      onStatus: (event) => {
        send(PUSH.ptyStatus, event)
        const info = manager.get(event.ptyId)
        if (!info) return
        notifications.handleStatus(event.ptyId, event.status, {
          isTabActive: () => activePtyId === event.ptyId,
          title: () => tMain('notify.title', { project: basename(info.cwd) }),
          body: () =>
            info.sessionId !== null
              ? tMain('notify.body', { id: info.sessionId.slice(0, 8) })
              : tMain('notify.bodyNoId'),
        })
      },
    },
    () => settings.get()
  )

  ipcMain.handle(IPC.pty.create, async (_event, raw: unknown): Promise<PtyInfo> => {
    const request = ptyCreateSchema.parse(raw)
    return manager.create(request)
  })

  ipcMain.handle(IPC.pty.write, (_event, raw: unknown): void => {
    const { ptyId, data } = ptyWriteSchema.parse(raw)
    manager.write(ptyId, data)
  })

  ipcMain.handle(IPC.pty.resize, (_event, raw: unknown): void => {
    const { ptyId, cols, rows } = ptyResizeSchema.parse(raw)
    manager.resize(ptyId, cols, rows)
  })

  ipcMain.handle(IPC.pty.kill, (_event, raw: unknown): void => {
    const ptyId = ptyIdSchema.parse(raw)
    notifications.forget(ptyId)
    manager.kill(ptyId)
  })

  ipcMain.handle(IPC.app.setActivePty, (_event, raw: unknown): void => {
    activePtyId = activePtySchema.parse(raw)
  })

  return manager
}
