import { join } from 'node:path'
import { app, BrowserWindow } from 'electron'
import { PUSH } from '@shared/ipc-contract'
import type { AppEvent } from '@shared/types'
import { ClaudeSessionProvider } from './claude/session-provider'
import { SessionWatcher } from './claude/session-watcher'
import { ImageAttachmentProvider } from './images/attachment-provider'
import { cleanupOldImages } from './images/cache'
import { registerClaudeIpc } from './ipc/claude.ipc'
import { registerClipboardIpc } from './ipc/clipboard.ipc'
import { registerImagesIpc } from './ipc/images.ipc'
import { registerProjectsIpc } from './ipc/projects.ipc'
import { registerPtyIpc } from './ipc/pty.ipc'
import { registerSessionsIpc } from './ipc/sessions.ipc'
import { registerSettingsIpc } from './ipc/settings.ipc'
import { registerSpeechIpc } from './ipc/speech.ipc'
import { registerTabsIpc } from './ipc/tabs.ipc'
import { registerUsageIpc } from './ipc/usage.ipc'
import { ProjectManager } from './projects/manager'
import { closeDatabase, getDatabase } from './storage/db'
import { SettingsService } from './storage/settings'
import type { ClaudeProcessManager } from './claude/process-manager'
import { createMainWindow } from './window'

let mainWindow: BrowserWindow | null = null
let processManager: ClaudeProcessManager | null = null
let watcher: SessionWatcher | null = null
let stopUsagePolling: (() => void) | null = null

/*
 * Katalog danych przypięty jawnie.
 *
 * Domyślnie Electron wyprowadza go z nazwy aplikacji, a ta różni się między trybem
 * deweloperskim (`claude-session-manager`) a wersją spakowaną (`Claude Session Manager`).
 * Bez tego zainstalowana aplikacja startowałaby z pustą bazą, bez ustawień, bez pobranego
 * modelu Whispera i bez cache sesji — czyli wyglądałaby na świeżą instalację.
 */
app.setPath('userData', join(app.getPath('appData'), 'claude-session-manager'))

// Dwie instancje walczyłyby o ten sam plik SQLite i cache obrazów.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })

  void app.whenReady().then(() => {
    const sendEvent = (event: AppEvent): void => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send(PUSH.appEvent, event)
      }
    }

    const db = getDatabase()
    const settings = new SettingsService(db)
    const sessions = new ClaudeSessionProvider(db)

    processManager = registerPtyIpc(() => mainWindow, settings)
    const projects = new ProjectManager(db, sessions)
    const images = new ImageAttachmentProvider(processManager)

    registerClaudeIpc(settings)
    registerClipboardIpc()
    registerSettingsIpc(settings)
    registerProjectsIpc(projects, processManager, () => mainWindow)
    registerSessionsIpc(
      sessions,
      projects,
      (scanned, total) => sendEvent({ kind: 'scan-progress', scanned, total }),
      () => mainWindow
    )
    registerTabsIpc(db)
    registerImagesIpc(images, settings, () => mainWindow)
    registerSpeechIpc(settings, () => mainWindow)
    stopUsagePolling = registerUsageIpc(() => mainWindow)

    mainWindow = createMainWindow()
    mainWindow.on('closed', () => {
      mainWindow = null
    })

    // Skan startuje po utworzeniu okna, żeby interfejs pojawił się od razu,
    // a nie dopiero po przejrzeniu wszystkich transkryptów.
    void sessions.scanAll((scanned, total) => sendEvent({ kind: 'scan-progress', scanned, total }))

    // Obrazy sprzątamy przy starcie, nigdy zaraz po wysłaniu promptu — Claude Code
    // odczytuje plik dopiero w trakcie przetwarzania (§13 planu).
    void cleanupOldImages(settings.get().imageCacheMaxAgeHours)

    watcher = new SessionWatcher(sessions, (projectPaths) =>
      sendEvent({ kind: 'sessions-changed', projectPaths })
    )
    watcher.start()

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) mainWindow = createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })

  // Osierocone procesy `claude` trzymałyby uchwyty do plików i zużywały pamięć po zamknięciu.
  app.on('before-quit', () => {
    processManager?.killAll()
    void watcher?.stop()
    stopUsagePolling?.()
    closeDatabase()
  })
}
