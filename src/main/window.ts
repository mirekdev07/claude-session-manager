import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { BrowserWindow, nativeImage, shell } from 'electron'

/** Ikona z zasobów; w wersji spakowanej electron-builder wstawia ją też do pliku .exe. */
function windowIcon(): Electron.NativeImage | undefined {
  const candidates = [
    join(process.resourcesPath ?? '', 'icon.png'),
    join(__dirname, '../../resources/icon.png'),
  ]
  const found = candidates.find((path) => existsSync(path))
  return found ? nativeImage.createFromPath(found) : undefined
}

export function createMainWindow(): BrowserWindow {
  const devServerUrl = process.env['ELECTRON_RENDERER_URL']

  const window = new BrowserWindow({
    width: 1600,
    height: 1000,
    minWidth: 1100,
    minHeight: 700,
    show: false,
    backgroundColor: '#0d0d0f',
    icon: windowIcon(),
    // Własny pasek tytułu — aplikacja ma wyglądać jak narzędzie deweloperskie, nie jak okno systemowe.
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: '#0d0d0f', symbolColor: '#8a8a94', height: 38 },
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      spellcheck: false,
    },
  })

  // Bez tego okno mignęłoby białym tłem, zanim renderer zdąży się zamontować.
  window.once('ready-to-show', () => window.show())

  // Linki z terminala otwieramy w przeglądarce systemowej, nigdy w oknie aplikacji.
  window.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
    return { action: 'deny' }
  })

  /*
   * Okno renderuje wyłącznie własny plik (w trybie deweloperskim: serwer Vite).
   * Nawigacja gdzie indziej — choćby przez link w wyjściu terminala — podstawiłaby
   * obcą stronę pod most `window.api`, więc ją blokujemy i oddajemy przeglądarce.
   */
  window.webContents.on('will-navigate', (event, url) => {
    const allowed = devServerUrl ? url.startsWith(devServerUrl) : url.startsWith('file://')
    if (allowed) return
    event.preventDefault()
    if (url.startsWith('https://') || url.startsWith('http://')) void shell.openExternal(url)
  })

  if (devServerUrl) {
    void window.loadURL(devServerUrl)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }

  return window
}
