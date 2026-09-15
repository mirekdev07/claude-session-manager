/** Handlery IPC podglądu zużycia limitów oraz odświeżanie w tle. */
import { BrowserWindow, ipcMain } from 'electron'
import { IPC, PUSH } from '@shared/ipc-contract'
import type { UsageReport } from '@shared/types'
import { UsageProvider } from '@main/claude/usage-provider'

/**
 * Co ile odświeżamy w tle.
 *
 * Pomiar wykazał, że `/usage` nie zwiększa licznika zapytań, więc częstotliwość ogranicza
 * tylko koszt uruchomienia procesu (~3 s). Pięć minut daje aktualny podgląd bez zauważalnego
 * obciążenia; okno limitu sesji i tak przesuwa się w skali godzin.
 */
const REFRESH_INTERVAL_MS = 5 * 60 * 1000

export function registerUsageIpc(getWindow: () => BrowserWindow | null): () => void {
  const provider = new UsageProvider()

  const publish = (report: UsageReport): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(PUSH.usageChanged, report)
  }

  ipcMain.handle(IPC.usage.get, (): UsageReport | null => provider.getCached())

  ipcMain.handle(IPC.usage.refresh, async (): Promise<UsageReport> => {
    const report = await provider.refresh()
    publish(report)
    return report
  })

  // Pierwszy odczyt z opóźnieniem: start aplikacji i tak konkuruje ze skanem transkryptów.
  const initial = setTimeout(() => void provider.refresh().then(publish), 4000)
  const timer = setInterval(() => void provider.refresh().then(publish), REFRESH_INTERVAL_MS)

  return () => {
    clearTimeout(initial)
    clearInterval(timer)
  }
}
