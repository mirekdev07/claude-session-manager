import { useEffect } from 'react'
import { useVoiceStore } from '@renderer/store/voice-store'

/**
 * Push-to-talk: przytrzymanie Ctrl+Shift+Space nagrywa, puszczenie kończy i przepisuje.
 *
 * Skrót działa tylko gdy okno jest aktywne — celowo nie rejestrujemy globalnego skrótu
 * systemowego, bo przechwytywałby kombinację także wtedy, gdy użytkownik pisze w innym programie.
 */
export function usePushToTalk(activeTabId: string | null): void {
  const phase = useVoiceStore((state) => state.phase)
  const start = useVoiceStore((state) => state.start)
  const stopAndTranscribe = useVoiceStore((state) => state.stopAndTranscribe)

  useEffect(() => {
    if (activeTabId === null) return

    const isShortcut = (event: KeyboardEvent): boolean =>
      event.code === 'Space' && event.ctrlKey && event.shiftKey && !event.altKey

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!isShortcut(event)) return
      // Bez tego autopowtarzanie klawisza próbowałoby startować nagranie kilkadziesiąt razy.
      if (event.repeat) return
      event.preventDefault()
      if (phase === 'idle') void start(activeTabId)
    }

    const onKeyUp = (event: KeyboardEvent): void => {
      // Przy puszczaniu modyfikatory bywają już zwolnione, więc patrzymy tylko na klawisz.
      if (event.code !== 'Space') return
      if (phase === 'recording') void stopAndTranscribe()
    }

    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [activeTabId, phase, start, stopAndTranscribe])
}
