import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import type { ProjectUsage, UsageWindow } from '@shared/types'
import { formatTokens, healthOf, HEALTH_TEXT } from '@renderer/lib/health'
import { useAppStore } from '@renderer/store/app-store'
import { useT } from '@renderer/store/i18n-store'

const WINDOWS: Array<{ id: UsageWindow; key: MessageKey }> = [
  { id: '24h', key: 'usage.window24h' },
  { id: '7d', key: 'usage.window7d' },
  { id: '30d', key: 'usage.window30d' },
]

/**
 * Udział projektów w zużyciu (Etap 8c).
 *
 * Źródłem są lokalne transkrypty, nie API — liczby są dokładne co do tokena, ale opisują
 * tylko tę maszynę. `/usage` w belce pokazuje limit konta; ten panel pokazuje, kto go zjada.
 */
export function ProjectUsagePanel(): React.JSX.Element {
  const t = useT()
  const [window_, setWindow] = useState<UsageWindow>('7d')
  const [rows, setRows] = useState<ProjectUsage[] | null>(null)
  const thresholds = useAppStore((state) => state.thresholds)

  useEffect(() => {
    setRows(null)
    void window.api.usage.byProject(window_).then(setRows)
  }, [window_])

  const total = rows?.reduce((sum, row) => sum + row.totalTokens, 0) ?? 0
  const requests = rows?.reduce((sum, row) => sum + row.requests, 0) ?? 0

  return (
    <div className="border-t border-app-border px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[10px] font-semibold tracking-wider text-app-muted uppercase">
          {t('usage.projects')}
        </span>
        <div className="ml-auto flex overflow-hidden rounded-md border border-app-border">
          {WINDOWS.map((option) => (
            <button
              key={option.id}
              onClick={() => setWindow(option.id)}
              className={`px-2 py-0.5 text-[10px] ${
                option.id === window_ ? 'bg-app-panel-2 text-app-text' : 'text-app-muted hover:text-app-text'
              }`}
            >
              {t(option.key)}
            </button>
          ))}
        </div>
      </div>

      {rows === null && (
        <div className="flex items-center gap-2 py-2 text-[11px] text-app-muted">
          <Loader2 size={12} className="animate-spin" /> {t('usage.computing')}
        </div>
      )}

      {rows !== null && rows.length === 0 && (
        <p className="py-2 text-[11px] text-app-muted">{t('usage.noActivity')}</p>
      )}

      {rows !== null && rows.length > 0 && (
        <>
          <div className="space-y-1.5">
            {rows.slice(0, 8).map((row) => {
              const share = total === 0 ? 0 : (row.totalTokens / total) * 100
              const health = healthOf(row.maxPeakContext, thresholds)
              return (
                <div key={row.projectPath} className="text-[11px]" title={row.projectPath}>
                  <div className="flex items-baseline gap-2">
                    <span className="min-w-0 flex-1 truncate">{row.projectName}</span>
                    <span className="shrink-0 tabular-nums text-app-muted">
                      {t('usage.requestsAbbrev', { count: row.requests })}
                    </span>
                    <span className={`shrink-0 tabular-nums ${HEALTH_TEXT[health]}`} title={t('usage.peakTitle')}>
                      {formatTokens(row.maxPeakContext)}
                    </span>
                    <span className="w-[44px] shrink-0 text-right tabular-nums">{share.toFixed(0)}%</span>
                  </div>
                  <div className="mt-0.5 h-1 overflow-hidden rounded-full bg-app-border">
                    <div className="h-full rounded-full bg-app-accent" style={{ width: `${share}%` }} />
                  </div>
                </div>
              )
            })}
          </div>
          <p className="mt-2 text-[10px] text-app-muted">
            {t('usage.total', { tokens: formatTokens(total), requests })}
          </p>
        </>
      )}
    </div>
  )
}
