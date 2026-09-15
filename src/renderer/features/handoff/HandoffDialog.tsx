import { useEffect } from 'react'
import { AlertTriangle, Loader2, Sparkles, X } from 'lucide-react'
import { formatTokens } from '@renderer/lib/health'
import { SLOT, withSlot } from '@renderer/lib/slot'
import { useHandoffStore } from '@renderer/store/handoff-store'
import { useT } from '@renderer/store/i18n-store'

/**
 * Okno „Nowa sesja z podsumowaniem" (Etap 11).
 *
 * Trzy kroki: ostrzeżenie o koszcie → podgląd z możliwością edycji → start nowej sesji.
 * Podsumowanie nigdy nie idzie do modelu bez wyraźnego kliknięcia użytkownika.
 */
export function HandoffDialog(): React.JSX.Element | null {
  const t = useT()
  const phase = useHandoffStore((state) => state.phase)
  const session = useHandoffStore((state) => state.session)
  const project = useHandoffStore((state) => state.project)
  const summary = useHandoffStore((state) => state.summary)
  const error = useHandoffStore((state) => state.error)
  const generate = useHandoffStore((state) => state.generate)
  const setSummary = useHandoffStore((state) => state.setSummary)
  const launch = useHandoffStore((state) => state.launch)
  const cancel = useHandoffStore((state) => state.cancel)

  useEffect(() => {
    if (phase === 'idle') return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' && phase !== 'generating' && phase !== 'starting') cancel()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [phase, cancel])

  if (phase === 'idle' || !session || !project) return null

  const busy = phase === 'generating' || phase === 'starting'
  const peak = formatTokens(session.metrics.peakContext)

  return (
    <div className="absolute inset-0 z-50 flex justify-center bg-black/60 p-10">
      <div className="flex w-[720px] max-w-full flex-col overflow-hidden rounded-lg border border-app-border bg-app-panel">
        <header className="flex items-center gap-2 border-b border-app-border px-4 py-3">
          <Sparkles size={15} className="text-app-accent" />
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-medium">{t('handoff.title')}</h2>
            <p className="truncate text-[11px] text-app-muted">
              {t('handoff.subtitle', {
                project: project.name,
                session: session.label ?? session.title ?? session.sessionId.slice(0, 8),
                peak,
              })}
            </p>
          </div>
          {!busy && (
            <button onClick={cancel} className="ml-auto text-app-muted hover:text-app-text">
              <X size={16} />
            </button>
          )}
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          {phase === 'confirm' && (
            <div className="space-y-3 text-[12px] leading-relaxed">
              <p>{withSlot(t('handoff.intro', { peak: SLOT }), <strong>{peak}</strong>)}</p>
              <div className="flex items-start gap-2 rounded-md border border-app-warn/50 bg-app-warn/10 px-3 py-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0 text-app-warn" />
                <p>
                  <strong>{t('handoff.costTitle')}</strong>
                  {t('handoff.costBody')}
                </p>
              </div>
            </div>
          )}

          {phase === 'generating' && (
            <div className="flex items-center gap-2 py-6 text-[12px] text-app-muted">
              <Loader2 size={14} className="animate-spin" /> {t('handoff.generating')}
            </div>
          )}

          {(phase === 'preview' || phase === 'starting') && (
            <>
              <p className="mb-2 text-[11px] text-app-muted">{t('handoff.previewHint')}</p>
              <textarea
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                disabled={phase === 'starting'}
                spellCheck={false}
                className="h-[360px] w-full resize-none rounded-md border border-app-border bg-app-panel-2 px-3 py-2 font-mono text-[11px] leading-relaxed outline-none focus:border-app-accent-dim disabled:opacity-60"
              />
            </>
          )}

          {error !== null && (
            <p className="mt-3 flex items-start gap-2 text-[12px] text-app-error">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" /> {error}
            </p>
          )}
        </div>

        <footer className="flex items-center gap-2 border-t border-app-border px-4 py-3">
          {phase === 'starting' && (
            <span className="flex items-center gap-2 text-[11px] text-app-muted">
              <Loader2 size={12} className="animate-spin" /> {t('handoff.starting')}
            </span>
          )}
          <div className="ml-auto flex gap-2">
            {!busy && (
              <button
                onClick={cancel}
                className="rounded-md border border-app-border px-3 py-1.5 text-[12px] hover:bg-app-panel-2"
              >
                {t('handoff.cancel')}
              </button>
            )}
            {phase === 'confirm' && (
              <button
                onClick={() => void generate()}
                className="rounded-md bg-app-accent px-3 py-1.5 text-[12px] font-medium text-app-bg hover:bg-app-accent/90"
              >
                {t('handoff.generate')}
              </button>
            )}
            {phase === 'preview' && (
              <button
                onClick={() => void launch()}
                disabled={summary.trim() === ''}
                className="rounded-md bg-app-accent px-3 py-1.5 text-[12px] font-medium text-app-bg hover:bg-app-accent/90 disabled:opacity-40"
              >
                {t('handoff.launch')}
              </button>
            )}
          </div>
        </footer>
      </div>
    </div>
  )
}
