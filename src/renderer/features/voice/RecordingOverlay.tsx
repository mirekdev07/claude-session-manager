import { useEffect, useRef } from 'react'
import { Loader2, Mic, X } from 'lucide-react'
import { useT } from '@renderer/store/i18n-store'
import { useVoiceStore } from '@renderer/store/voice-store'

const BAR_COUNT = 48

/**
 * Nakładka pokazywana w trakcie nagrywania i transkrypcji.
 *
 * Fala rysuje się w `canvas` sterowanym przez `requestAnimationFrame`, a nie przez stan
 * Reacta — przerysowywanie komponentu 60 razy na sekundę odbijałoby się na płynności terminala.
 */
export function RecordingOverlay(): React.JSX.Element | null {
  const t = useT()
  const phase = useVoiceStore((state) => state.phase)
  const stopAndTranscribe = useVoiceStore((state) => state.stopAndTranscribe)
  const cancel = useVoiceStore((state) => state.cancel)
  const readLevels = useVoiceStore((state) => state.readLevels)

  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    if (phase !== 'recording') return

    const canvas = canvasRef.current
    const context = canvas?.getContext('2d')
    if (!canvas || !context) return

    const levels = new Uint8Array(128)
    let frame = 0

    const draw = (): void => {
      readLevels(levels)

      const { width, height } = canvas
      context.clearRect(0, 0, width, height)
      context.fillStyle = '#d97757'

      const barWidth = width / BAR_COUNT
      for (let index = 0; index < BAR_COUNT; index++) {
        const level = levels[Math.floor((index / BAR_COUNT) * levels.length)] ?? 0
        // Minimalna wysokość sprawia, że pasek żyje także w ciszy.
        const barHeight = Math.max(2, (level / 255) * height)
        context.fillRect(
          index * barWidth + barWidth * 0.2,
          (height - barHeight) / 2,
          barWidth * 0.6,
          barHeight
        )
      }

      frame = requestAnimationFrame(draw)
    }

    frame = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(frame)
  }, [phase, readLevels])

  useEffect(() => {
    if (phase === 'idle') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') cancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, cancel])

  if (phase === 'idle') return null

  return (
    <div className="absolute inset-x-0 bottom-0 z-40 flex items-center gap-4 border-t border-app-border bg-app-panel-2 px-4 py-3">
      {phase === 'recording' ? (
        <>
          <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-app-accent text-app-bg">
            <Mic size={16} />
          </span>
          <canvas ref={canvasRef} width={320} height={34} className="h-[34px] w-[320px] shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="text-[13px]">{t('voice.listening')}</p>
            <p className="text-[11px] text-app-muted">{t('voice.hint')}</p>
          </div>
          <button
            onClick={() => void stopAndTranscribe()}
            className="shrink-0 rounded-md bg-app-accent px-3 py-1.5 text-[12px] font-medium text-app-bg hover:bg-app-accent/90"
          >
            {t('voice.finish')}
          </button>
          <button
            onClick={cancel}
            className="flex shrink-0 items-center gap-1.5 rounded-md border border-app-border px-3 py-1.5 text-[12px] hover:bg-app-panel"
          >
            <X size={13} /> {t('voice.cancel')}
          </button>
        </>
      ) : (
        <>
          <Loader2 size={18} className="shrink-0 animate-spin text-app-accent" />
          <p className="text-[13px]">{t('voice.transcribing')}</p>
          <p className="ml-auto text-[11px] text-app-muted">{t('voice.transcribingHint')}</p>
        </>
      )}
    </div>
  )
}
