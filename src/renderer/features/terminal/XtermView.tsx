import { useEffect, useRef } from 'react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SearchAddon } from '@xterm/addon-search'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import type { PtyExitEvent, PtyInfo, PtyMode, PtyStatus } from '@shared/types'
import { terminalTheme } from './xterm-theme'
import { tNow } from '@renderer/store/i18n-store'

const RESIZE_DEBOUNCE_MS = 100

/** Kopiuje bieżące zaznaczenie terminala do systemowego schowka. */
function copySelection(term: Terminal): void {
  const selection = term.getSelection()
  if (selection !== '') void window.api.clipboard.writeText(selection)
}

/** Operacje na terminalu udostępniane rodzicowi (menu kontekstowe). */
export interface TerminalHandle {
  focus: () => void
  copySelection: () => void
  selectAll: () => void
  clearSelection: () => void
  hasSelection: () => boolean
  paste: (text: string) => void
}

export interface XtermViewProps {
  cwd: string
  mode: PtyMode
  sessionId?: string
  fontSize?: number
  fontFamily?: string
  onInfo?: (info: PtyInfo) => void
  onStatus?: (status: PtyStatus) => void
  onExit?: (event: PtyExitEvent) => void
  onError?: (message: string) => void
  /** Wołane po utworzeniu terminala; `null` przy odmontowaniu. */
  onReady?: (handle: TerminalHandle | null) => void
}

/**
 * Jeden terminal = jeden proces Claude Code.
 *
 * Komponent celowo nie trzyma nic w stanie Reacta — xterm zarządza własnym buforem,
 * a przerysowanie Reacta nie może dotknąć instancji terminala.
 */
export function XtermView({
  cwd,
  mode,
  sessionId,
  fontSize = 13,
  fontFamily = "'Cascadia Code', 'JetBrains Mono', Consolas, monospace",
  onInfo,
  onStatus,
  onExit,
  onError,
  onReady,
}: XtermViewProps): React.JSX.Element {
  const hostRef = useRef<HTMLDivElement>(null)

  // Terminal i uchwyt do dopasowania rozmiaru trzymamy w refach, żeby zmiana czcionki
  // mogła je zmodyfikować bez odmontowania komponentu — a więc bez ubicia procesu Claude.
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)
  const ptyIdRef = useRef<string | null>(null)

  // Callbacki trzymamy w refie, żeby ich zmiana nie restartowała procesu Claude.
  const callbacks = useRef({ onInfo, onStatus, onExit, onError, onReady })
  callbacks.current = { onInfo, onStatus, onExit, onError, onReady }

  useEffect(() => {
    const host = hostRef.current
    if (!host) return

    let disposed = false
    const cleanups: Array<() => void> = []

    // Czcionka podana tu jest wartością startową; późniejsze zmiany obsługuje osobny efekt niżej.
    const term = new Terminal({
      theme: terminalTheme,
      fontFamily,
      fontSize,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true, // wymagane przez Unicode11Addon
      scrollback: 20000,
      macOptionIsMeta: true,
      // Prawy przycisk otwiera nasze menu kontekstowe, więc nie może zaznaczać słowa.
      rightClickSelectsWord: false,
    })

    /*
     * Obsługa skrótów, których xterm sam by nie przepuścił albo nie obsługuje.
     *
     * Zwrócenie `false` znaczy „nie przetwarzaj tego klawisza w terminalu".
     */
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true

      const ctrl = event.ctrlKey || event.metaKey

      /*
       * Wklejanie. xterm domyślnie zamienia Ctrl+V na znak sterujący 0x16 i wywołuje
       * `preventDefault()`, przez co przeglądarka w ogóle nie generuje zdarzenia `paste`
       * i obrazy ze schowka nigdy nie trafiały do załączników. Przepuszczamy skrót dalej.
       */
      if ((event.code === 'KeyV' && ctrl && !event.altKey) || (event.code === 'Insert' && event.shiftKey)) {
        return false
      }

      /*
       * Kopiowanie. W terminalu Ctrl+C wysyła sygnał przerwania, więc kopiowanie musi mieć
       * własny skrót — Ctrl+Shift+C i Ctrl+Insert, tak jak w Windows Terminal.
       */
      if ((event.code === 'KeyC' && ctrl && event.shiftKey) || (event.code === 'Insert' && ctrl)) {
        copySelection(term)
        return false
      }

      /*
       * Ctrl+C przy aktywnym zaznaczeniu kopiuje i od razu je czyści, więc kolejne
       * naciśnięcie przerywa pracę Claude'a jak zwykle. Bez czyszczenia zapomniane
       * zaznaczenie blokowałoby przerywanie, a to w tej aplikacji zdarza się często.
       */
      if (event.code === 'KeyC' && ctrl && !event.shiftKey && term.hasSelection()) {
        copySelection(term)
        term.clearSelection()
        return false
      }

      // Zaznaczenie całego bufora. Samo Ctrl+A zostawiamy terminalowi (początek linii).
      if (event.code === 'KeyA' && ctrl && event.shiftKey) {
        term.selectAll()
        return false
      }

      return true
    })

    const fitAddon = new FitAddon()
    termRef.current = term
    fitRef.current = fitAddon
    term.loadAddon(fitAddon)
    term.loadAddon(new SearchAddon())
    term.loadAddon(new WebLinksAddon())

    const unicode11 = new Unicode11Addon()
    term.loadAddon(unicode11)
    term.unicode.activeVersion = '11'

    term.open(host)

    // WebGL bywa niedostępny (zdalny pulpit, stare sterowniki) — wtedy xterm sam użyje canvasu.
    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // celowo bez komunikatu: brak WebGL degraduje tylko wydajność, nie funkcjonalność
    }

    fitAddon.fit()

    callbacks.current.onReady?.({
      focus: () => term.focus(),
      copySelection: () => copySelection(term),
      selectAll: () => term.selectAll(),
      clearSelection: () => term.clearSelection(),
      hasSelection: () => term.hasSelection(),
      paste: (text) => term.paste(text),
    })

    void (async () => {
      try {
        const info = await window.api.pty.create({
          cwd,
          mode,
          sessionId,
          cols: term.cols,
          rows: term.rows,
        })

        // Komponent mógł zostać odmontowany, zanim proces wystartował.
        if (disposed) {
          void window.api.pty.kill(info.ptyId)
          return
        }

        ptyIdRef.current = info.ptyId
        callbacks.current.onInfo?.(info)

        cleanups.push(window.api.pty.onData(info.ptyId, (chunk) => term.write(chunk)))

        cleanups.push(
          window.api.pty.onStatus((event) => {
            if (event.ptyId === info.ptyId) callbacks.current.onStatus?.(event.status)
          })
        )

        cleanups.push(
          window.api.pty.onExit((event) => {
            if (event.ptyId !== info.ptyId) return
            term.write(`\r\n\x1b[90m${tNow('terminal.exited', { code: event.exitCode })}\x1b[0m\r\n`)
            callbacks.current.onExit?.(event)
          })
        )

        // Wejście użytkownika trafia prosto do PTY — bez interpretacji po naszej stronie.
        const inputDisposable = term.onData((data) => void window.api.pty.write(info.ptyId, data))
        cleanups.push(() => inputDisposable.dispose())

        let resizeTimer: number | undefined
        const observer = new ResizeObserver(() => {
          window.clearTimeout(resizeTimer)
          resizeTimer = window.setTimeout(() => {
            fitAddon.fit()
            void window.api.pty.resize(info.ptyId, term.cols, term.rows)
          }, RESIZE_DEBOUNCE_MS)
        })
        observer.observe(host)
        cleanups.push(() => {
          window.clearTimeout(resizeTimer)
          observer.disconnect()
        })

        cleanups.push(() => void window.api.pty.kill(info.ptyId))

        term.focus()
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        term.write(`\r\n\x1b[31m${message}\x1b[0m\r\n`)
        callbacks.current.onError?.(message)
      }
    })()

    return () => {
      disposed = true
      callbacks.current.onReady?.(null)
      for (const cleanup of cleanups.reverse()) cleanup()
      termRef.current = null
      fitRef.current = null
      ptyIdRef.current = null
      term.dispose()
    }
    // Tylko te trzy wartości opisują *inny proces*. Ustawienia wyglądu celowo nie są tu wymienione —
    // ich zmiana nie może restartować sesji Claude.
  }, [cwd, mode, sessionId])

  // Wygląd zmieniamy w miejscu: nowa czcionka zmienia szerokość znaku, więc po jej zastosowaniu
  // trzeba przeliczyć siatkę i poinformować proces o nowym rozmiarze.
  useEffect(() => {
    const term = termRef.current
    const fitAddon = fitRef.current
    if (!term || !fitAddon) return

    term.options.fontSize = fontSize
    term.options.fontFamily = fontFamily
    fitAddon.fit()

    if (ptyIdRef.current !== null) {
      void window.api.pty.resize(ptyIdRef.current, term.cols, term.rows)
    }
  }, [fontSize, fontFamily])

  return <div ref={hostRef} className="terminal-host h-full w-full overflow-hidden px-2 py-1" />
}
