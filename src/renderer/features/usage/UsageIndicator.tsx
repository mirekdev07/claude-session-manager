import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Gauge, Loader2, RefreshCw } from 'lucide-react'
import type { Translator } from '@shared/i18n'
import type { UsageLimit, UsageReport } from '@shared/types'
import { useDates, useT } from '@renderer/store/i18n-store'
import { ProjectUsagePanel } from './ProjectUsagePanel'

/** Powyżej tych progów wskaźnik zmienia kolor na ostrzegawczy i alarmowy. */
const WARN_AT = 70
const DANGER_AT = 90

function colorFor(percent: number): string {
  if (percent >= DANGER_AT) return 'bg-app-error'
  if (percent >= WARN_AT) return 'bg-app-warn'
  return 'bg-app-ok'
}

function textColorFor(percent: number): string {
  if (percent >= DANGER_AT) return 'text-app-error'
  if (percent >= WARN_AT) return 'text-app-warn'
  return 'text-app-text'
}

/** Pełna etykieta limitu w języku interfejsu; parser zwraca tylko rodzaj i szczegół. */
function labelFor(t: Translator, limit: UsageLimit): string {
  switch (limit.kind) {
    case 'session':
      return t('usage.session')
    case 'week':
      return t('usage.week')
    case 'model':
      return `${t('usage.week')} · ${limit.detail ?? ''}`
    default:
      return limit.detail ?? ''
  }
}

/** W belce jest mało miejsca — limit per model skracamy do samej nazwy modelu. */
function shortLabelFor(t: Translator, limit: UsageLimit): string {
  return limit.kind === 'model' ? (limit.detail ?? '') : labelFor(t, limit)
}

function keyOf(limit: UsageLimit): string {
  return `${limit.kind}:${limit.detail ?? ''}`
}

/**
 * Zużycie limitów subskrypcji przypięte do górnej belki.
 *
 * Dane pochodzą z `claude -p "/usage"`, czyli z tego samego źródła co komenda `/usage`
 * w terminalu — nie parsujemy ekranu TUI. Odczyt odświeża się sam co pięć minut;
 * pomiar wykazał, że nie zwiększa licznika zapytań.
 */
export function UsageIndicator(): React.JSX.Element {
  const t = useT()
  const dates = useDates()
  const [report, setReport] = useState<UsageReport | null>(null)
  const [isRefreshing, setIsRefreshing] = useState(false)
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void window.api.usage.get().then(setReport)
    return window.api.usage.onChange(setReport)
  }, [])

  // Kliknięcie poza panelem go zamyka; bez tego zasłaniałby interfejs do następnego kliknięcia w ikonę.
  useEffect(() => {
    if (!isOpen) return
    const onPointerDown = (event: MouseEvent): void => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    window.addEventListener('mousedown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [isOpen])

  const refresh = async (): Promise<void> => {
    setIsRefreshing(true)
    try {
      setReport(await window.api.usage.refresh())
    } finally {
      setIsRefreshing(false)
    }
  }

  return (
    <div ref={containerRef} className="no-drag relative shrink-0">
      <button
        onClick={() => setIsOpen((open) => !open)}
        title={t('usage.titleTip')}
        className={`flex items-center gap-2.5 rounded-md px-2 py-1 hover:bg-app-panel-2 ${
          isOpen ? 'bg-app-panel-2' : ''
        }`}
      >
        {report === null && (
          <span className="flex items-center gap-1.5 text-[11px] text-app-muted">
            <Gauge size={13} /> {t('usage.loading')}
          </span>
        )}

        {report?.ok === false && (
          <span className="flex items-center gap-1.5 text-[11px] text-app-error">
            <AlertTriangle size={13} /> {t('usage.error')}
          </span>
        )}

        {report?.ok === true &&
          report.limits.map((limit) => <LimitPill key={keyOf(limit)} limit={limit} t={t} />)}
      </button>

      {isOpen && (
        <div className="absolute top-full right-0 z-50 mt-1 w-[520px] rounded-lg border border-app-border bg-app-panel shadow-xl">
          <header className="flex items-center gap-2 border-b border-app-border px-3 py-2">
            <Gauge size={14} className="text-app-accent" />
            <span className="text-[12px] font-medium">{t('usage.title')}</span>
            <span className="text-[10px] text-app-muted">
              {report === null ? '' : t('usage.readAt', { time: dates.time(report.fetchedAt) })}
            </span>
            <button
              onClick={() => void refresh()}
              disabled={isRefreshing}
              title={t('usage.refreshNow')}
              className="ml-auto flex items-center gap-1.5 rounded-md border border-app-border px-2 py-1 text-[11px] hover:bg-app-panel-2 disabled:opacity-40"
            >
              {isRefreshing ? (
                <Loader2 size={11} className="animate-spin" />
              ) : (
                <RefreshCw size={11} />
              )}
              {t('usage.refresh')}
            </button>
          </header>

          {report?.ok === false && (
            <p className="px-3 py-3 text-[12px] text-app-error">{report.error}</p>
          )}

          {report?.ok === true && (
            <>
              <div className="space-y-2 px-3 py-3">
                {report.limits.map((limit) => (
                  <div key={keyOf(limit)}>
                    <div className="mb-1 flex items-baseline gap-2 text-[12px]">
                      <span>{labelFor(t, limit)}</span>
                      <span className={`font-medium tabular-nums ${textColorFor(limit.percentUsed)}`}>
                        {limit.percentUsed}%
                      </span>
                      {limit.resetsAt !== null && (
                        <span className="ml-auto text-[10px] text-app-muted">
                          {t('usage.resets', { when: limit.resetsAt })}
                        </span>
                      )}
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-app-border">
                      <div
                        className={`h-full rounded-full ${colorFor(limit.percentUsed)}`}
                        style={{ width: `${Math.min(100, limit.percentUsed)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>

              <ProjectUsagePanel />

              <pre className="max-h-[220px] overflow-auto border-t border-app-border px-3 py-2 font-mono text-[10px] leading-relaxed whitespace-pre-wrap text-app-muted">
                {report.detail}
              </pre>
            </>
          )}

          {report === null && (
            <p className="px-3 py-3 text-[12px] text-app-muted">{t('usage.firstRead')}</p>
          )}
        </div>
      )}
    </div>
  )
}

/** Kompaktowa pigułka w belce: skrócona etykieta, procent i mikropasek. */
function LimitPill({ limit, t }: { limit: UsageLimit; t: Translator }): React.JSX.Element {
  const tooltip =
    t('usage.pillTip', { label: labelFor(t, limit), percent: limit.percentUsed }) +
    (limit.resetsAt === null ? '' : `\n${t('usage.resets', { when: limit.resetsAt })}`)

  return (
    <span className="flex items-center gap-1.5" title={tooltip}>
      <span className="text-[10px] text-app-muted">{shortLabelFor(t, limit)}</span>
      <span className={`text-[11px] font-medium tabular-nums ${textColorFor(limit.percentUsed)}`}>
        {limit.percentUsed}%
      </span>
      <span className="h-1 w-8 overflow-hidden rounded-full bg-app-border">
        <span
          className={`block h-full rounded-full ${colorFor(limit.percentUsed)}`}
          style={{ width: `${Math.min(100, limit.percentUsed)}%` }}
        />
      </span>
    </span>
  )
}
