import { useEffect, useState } from 'react'
import type { MessageKey } from '@shared/i18n'
import type { PtyInfo, PtyStatus } from '@shared/types'
import { useT } from '@renderer/store/i18n-store'

const STATUS_KEY: Record<PtyStatus, MessageKey> = {
  running: 'status.running',
  waiting: 'status.waiting',
  closed: 'status.closed',
  error: 'status.error',
}

const STATUS_COLOR: Record<PtyStatus, string> = {
  running: 'bg-app-ok',
  waiting: 'bg-app-warn',
  closed: 'bg-app-muted',
  error: 'bg-app-error',
}

export interface StatusBarProps {
  cwd: string
  info: PtyInfo | null
  status: PtyStatus
  error?: string | null
}

/**
 * Wszystkie dane pochodzą z wiarygodnych źródeł: PID i czas startu z node-pty,
 * cwd i session ID z argumentów, którymi sami uruchomiliśmy proces.
 * TUI nie jest parsowane (§20 planu).
 */
export function StatusBar({ cwd, info, status, error }: StatusBarProps): React.JSX.Element {
  const t = useT()
  const uptime = useUptime(info?.startedAt ?? null, status !== 'closed')

  return (
    <footer className="flex h-[30px] shrink-0 items-center gap-4 border-t border-app-border bg-app-panel px-3 text-[11px] text-app-muted">
      <span className="flex items-center gap-1.5">
        <span className={`size-[7px] rounded-full ${STATUS_COLOR[status]}`} />
        {t(STATUS_KEY[status])}
      </span>

      <span className="truncate font-mono" title={cwd}>
        {cwd}
      </span>

      {info?.sessionId != null && (
        <span className="font-mono" title={t('status.sessionId')}>
          {info.sessionId.slice(0, 8)}…
        </span>
      )}

      {info != null && <span className="font-mono">PID {info.pid}</span>}
      {uptime != null && <span className="font-mono tabular-nums">{uptime}</span>}

      {error != null && <span className="ml-auto truncate text-app-error">{error}</span>}
    </footer>
  )
}

/** Odlicza czas życia sesji. Zatrzymuje timer po zamknięciu procesu, żeby nie budzić Reacta bez powodu. */
function useUptime(startedAt: number | null, active: boolean): string | null {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (startedAt === null || !active) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [startedAt, active])

  if (startedAt === null) return null

  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor((totalSeconds % 3600) / 60)
  const seconds = totalSeconds % 60
  const pad = (value: number): string => String(value).padStart(2, '0')

  return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`
}
