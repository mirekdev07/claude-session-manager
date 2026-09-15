/**
 * Powiadomienia systemowe o sesji, która skończyła pracę i czeka na użytkownika.
 *
 * Cała aplikacja zakłada pracę z kilkoma sesjami naraz, ale bez tej warstwy nie ma jak się
 * dowiedzieć, że któraś skończyła — wraca się do niej na chybił trafił.
 */
import { BrowserWindow, Notification } from 'electron'
import type { PtyStatus } from '@shared/types'

/**
 * Status `waiting` wynika z ciszy dłuższej niż 800 ms (`IDLE_THRESHOLD_MS` w process-managerze).
 * Przy dłuższym namyśle modelu potrafi mignąć fałszywie, więc powiadomienie wysyłamy dopiero,
 * gdy cisza utrzyma się przez ten dłuższy próg. Celowo osobna stała — kolorowa kropka
 * w interfejsie ma reagować szybko, powiadomienie ma nie hałasować.
 */
const NOTIFY_AFTER_IDLE_MS = 3000

/** Seria krótkich przerw w jednej sesji nie może zasypać paska zadań. */
const MIN_GAP_PER_SESSION_MS = 30_000

export interface WaitingContext {
  /** Czy renderer pokazuje właśnie tę zakładkę — sprawdzane w chwili wysyłki, nie zgłoszenia. */
  isTabActive: () => boolean
  title: () => string
  body: () => string
}

export class NotificationService {
  private readonly pendingTimers = new Map<string, NodeJS.Timeout>()
  private readonly lastNotifiedAt = new Map<string, number>()

  /**
   * Sesje, w których użytkownik zlecił pracę i jeszcze nie dostał odpowiedzi.
   *
   * Sam strumień nie wystarcza: TUI Claude'a przerysowuje ekran po utracie fokusu terminala
   * czy zmianie rozmiaru okna (np. przy minimalizacji), a każde takie przerysowanie wygląda
   * jak „pracował, teraz czeka". Powiadomienie ma sens tylko wtedy, gdy przed ciszą było
   * zlecenie od użytkownika — Enter w terminalu.
   */
  private readonly armed = new Set<string>()

  constructor(
    private readonly getWindow: () => BrowserWindow | null,
    private readonly isEnabled: () => boolean,
    private readonly onClick: (ptyId: string) => void
  ) {}

  /** Użytkownik wysłał coś do sesji — najbliższe „czeka" po pracy zasługuje na powiadomienie. */
  arm(ptyId: string): void {
    this.armed.add(ptyId)
  }

  /** Wołane przy każdej zmianie statusu; decyzja o wysłaniu zapada po upływie progu ciszy. */
  handleStatus(ptyId: string, status: PtyStatus, context: WaitingContext): void {
    this.cancelPending(ptyId)
    if (status !== 'waiting') return

    const timer = setTimeout(() => {
      this.pendingTimers.delete(ptyId)
      if (!this.armed.has(ptyId)) return

      // Zlecenie zostało obsłużone niezależnie od tego, czy powiadomienie poszło —
      // kolejne przerysowanie bez nowego Entera nie ma prawa niczego pokazać.
      this.armed.delete(ptyId)
      if (this.shouldNotify(ptyId, context.isTabActive())) {
        this.notify(ptyId, context.title(), context.body())
      }
    }, NOTIFY_AFTER_IDLE_MS)
    this.pendingTimers.set(ptyId, timer)
  }

  /** Terminal zniknął — nie ma o czym powiadamiać. */
  forget(ptyId: string): void {
    this.cancelPending(ptyId)
    this.lastNotifiedAt.delete(ptyId)
    this.armed.delete(ptyId)
  }

  private shouldNotify(ptyId: string, isTabActive: boolean): boolean {
    if (!this.isEnabled() || !Notification.isSupported()) return false

    // Gdy użytkownik patrzy na tę sesję, powiadomienie tylko przeszkadza.
    const window = this.getWindow()
    const windowFocused = window !== null && !window.isDestroyed() && window.isFocused()
    if (windowFocused && isTabActive) return false

    const last = this.lastNotifiedAt.get(ptyId) ?? 0
    return Date.now() - last >= MIN_GAP_PER_SESSION_MS
  }

  private notify(ptyId: string, title: string, body: string): void {
    const notification = new Notification({ title, body })
    notification.on('click', () => this.onClick(ptyId))
    notification.show()
    this.lastNotifiedAt.set(ptyId, Date.now())
  }

  private cancelPending(ptyId: string): void {
    const timer = this.pendingTimers.get(ptyId)
    if (timer) clearTimeout(timer)
    this.pendingTimers.delete(ptyId)
  }
}
