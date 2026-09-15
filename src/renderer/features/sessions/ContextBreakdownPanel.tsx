import { useEffect, useState } from 'react'
import { Loader2, PieChart, X } from 'lucide-react'
import type { ClaudeSession, ContextBreakdown } from '@shared/types'
import { formatSize } from '@renderer/lib/format'
import { charsToApproxTokens, formatTokens } from '@renderer/lib/health'
import { SLOT, withSlot } from '@renderer/lib/slot'
import { useDates, useT } from '@renderer/store/i18n-store'

export interface ContextBreakdownPanelProps {
  session: ClaudeSession
  onClose: () => void
}

/** Powyżej tego rozmiaru pojedynczy wynik dostaje wyróżnienie — to zwykle zrzut ekranu albo cały plik. */
const EXTREME_RESULT_CHARS = 100_000

/**
 * „Co zjadło kontekst" — rozbicie zużycia jednej sesji na narzędzia (Etap 10).
 *
 * Liczymy znaki wyników, nie tokeny. To przybliżenie (~4 znaki na token) i interfejs
 * mówi to wprost — dokładna liczba tokenów per narzędzie nie jest dostępna lokalnie.
 */
export function ContextBreakdownPanel({ session, onClose }: ContextBreakdownPanelProps): React.JSX.Element {
  const t = useT()
  const dates = useDates()
  const [breakdown, setBreakdown] = useState<ContextBreakdown | null | undefined>(undefined)

  useEffect(() => {
    void window.api.sessions.contextBreakdown(session.sessionId).then(setBreakdown)
  }, [session.sessionId])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  const total = breakdown?.totalResultChars ?? 0

  return (
    <div onClick={onClose} className="absolute inset-0 z-50 flex justify-center bg-black/60 p-10">
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex w-[680px] max-w-full flex-col overflow-hidden rounded-lg border border-app-border bg-app-panel"
      >
        <header className="flex items-center gap-2 border-b border-app-border px-4 py-3">
          <PieChart size={15} className="text-app-accent" />
          <div className="min-w-0">
            <h2 className="truncate text-[13px] font-medium">{t('breakdown.title')}</h2>
            <p className="truncate text-[11px] text-app-muted">{session.label ?? session.title ?? session.sessionId}</p>
          </div>
          <button onClick={onClose} className="ml-auto text-app-muted hover:text-app-text">
            <X size={16} />
          </button>
        </header>

        {breakdown === undefined && (
          <div className="flex items-center gap-2 p-6 text-[12px] text-app-muted">
            <Loader2 size={14} className="animate-spin" /> {t('breakdown.computing')}
          </div>
        )}

        {breakdown === null && (
          <p className="p-6 text-[12px] text-app-muted">{t('breakdown.none')}</p>
        )}

        {breakdown && (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <div className="mb-4 grid grid-cols-4 gap-2 text-[11px]">
              <Stat label={t('breakdown.peak')} value={formatTokens(breakdown.metrics.peakContext)} />
              <Stat label={t('breakdown.requests')} value={String(breakdown.metrics.requestCount)} />
              <Stat label={t('breakdown.toolCalls')} value={String(breakdown.metrics.toolCallCount)} />
              <Stat
                label={t('breakdown.toolResults')}
                value={`~${formatTokens(charsToApproxTokens(total))} ${t('breakdown.tok')}`}
              />
            </div>

            <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-app-muted uppercase">
              {t('breakdown.byTool')}
            </h3>
            {breakdown.tools.length === 0 ? (
              <p className="mb-4 text-[11px] text-app-muted">{t('breakdown.noTools')}</p>
            ) : (
              <div className="mb-4 space-y-1.5">
                {breakdown.tools.slice(0, 12).map((tool) => {
                  const share = total === 0 ? 0 : (tool.resultChars / total) * 100
                  return (
                    <div key={tool.toolName} className="text-[11px]">
                      <div className="flex items-baseline gap-2">
                        <span className="min-w-0 flex-1 truncate font-mono" title={tool.toolName}>
                          {shortToolName(tool.toolName)}
                        </span>
                        <span className="shrink-0 tabular-nums text-app-muted">{tool.calls}×</span>
                        <span className="w-[72px] shrink-0 text-right tabular-nums">
                          ~{formatTokens(charsToApproxTokens(tool.resultChars))}
                        </span>
                        <span className="w-[48px] shrink-0 text-right tabular-nums text-app-muted">
                          {share.toFixed(1)}%
                        </span>
                      </div>
                      <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-app-border">
                        <div className="h-full rounded-full bg-app-accent" style={{ width: `${share}%` }} />
                      </div>
                    </div>
                  )
                })}
              </div>
            )}

            {breakdown.largestResults.length > 0 && (
              <>
                <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-app-muted uppercase">
                  {t('breakdown.largest')}
                </h3>
                <div className="space-y-1">
                  {breakdown.largestResults.map((result, index) => {
                    const extreme = result.resultChars >= EXTREME_RESULT_CHARS
                    return (
                      <div
                        key={`${result.toolName}-${index}`}
                        className={`flex items-center gap-2 rounded px-2 py-1 text-[11px] ${
                          extreme ? 'bg-app-error/10' : ''
                        }`}
                      >
                        <span className="min-w-0 flex-1 truncate font-mono">{shortToolName(result.toolName)}</span>
                        <span className="shrink-0 text-[10px] text-app-muted">
                          {result.timestamp !== null ? dates.dateTime(result.timestamp) : '—'}
                        </span>
                        <span className={`w-[64px] shrink-0 text-right tabular-nums ${extreme ? 'text-app-error' : ''}`}>
                          {formatSize(result.resultChars)}
                        </span>
                      </div>
                    )
                  })}
                </div>
              </>
            )}

            <p className="mt-4 text-[10px] leading-relaxed text-app-muted">
              {withSlot(t('breakdown.note', { tool: SLOT }), <code className="font-mono">Read</code>)}
            </p>
          </div>
        )}
      </div>
    </div>
  )
}

function Stat({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <div className="rounded-md border border-app-border bg-app-panel-2 px-2.5 py-2">
      <div className="text-[10px] text-app-muted">{label}</div>
      <div className="text-[14px] font-medium tabular-nums">{value}</div>
    </div>
  )
}

/** `mcp__plugin_context-mode_context-mode__execute` → `mcp: context-mode / execute`. */
function shortToolName(name: string): string {
  if (!name.startsWith('mcp__')) return name
  const parts = name.split('__')
  const server = (parts[1] ?? '').replace(/^plugin_/, '').replace(/_.*$/, '')
  return `mcp: ${server} / ${parts.slice(2).join('/')}`
}
