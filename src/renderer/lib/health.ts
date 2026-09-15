import type { SessionHealth } from '@shared/types'
import { localeTag, type MessageKey } from '@shared/i18n'
import { localeNow } from '@renderer/store/i18n-store'

export interface HealthThresholds {
  warnAt: number
  dangerAt: number
}

/** Kolor zdrowia sesji wg szczytowego kontekstu. Progi konfigurowalne w Ustawieniach. */
export function healthOf(peakContext: number, thresholds: HealthThresholds): SessionHealth {
  if (peakContext >= thresholds.dangerAt) return 'red'
  if (peakContext >= thresholds.warnAt) return 'yellow'
  return 'green'
}

export const HEALTH_COLOR: Record<SessionHealth, string> = {
  green: 'bg-app-ok',
  yellow: 'bg-app-warn',
  red: 'bg-app-error',
}

export const HEALTH_TEXT: Record<SessionHealth, string> = {
  green: 'text-app-ok',
  yellow: 'text-app-warn',
  red: 'text-app-error',
}

/** Klucz tłumaczenia opisu zdrowia — komponent podaje go do `t()`. */
export const HEALTH_KEY: Record<SessionHealth, MessageKey> = {
  green: 'health.green',
  yellow: 'health.yellow',
  red: 'health.red',
}

const oneDecimalFormatters = new Map<string, Intl.NumberFormat>()

/** Separator dziesiętny zależy od języka: `1.2M` po angielsku, `1,2M` po polsku. */
function oneDecimal(value: number): string {
  const tag = localeTag(localeNow())
  let formatter = oneDecimalFormatters.get(tag)
  if (!formatter) {
    formatter = new Intl.NumberFormat(tag, { minimumFractionDigits: 1, maximumFractionDigits: 1 })
    oneDecimalFormatters.set(tag, formatter)
  }
  return formatter.format(value)
}

/** `12k`, `1.2M` — czytelne bez tabulatorów. */
export function formatTokens(value: number): string {
  if (value >= 1_000_000_000) return `${oneDecimal(value / 1_000_000_000)}B`
  if (value >= 1_000_000) return `${oneDecimal(value / 1_000_000)}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}k`
  return String(value)
}

/** Znaki wyniku narzędzia jako przybliżone tokeny (~4 znaki na token). To szacunek, nie pomiar. */
export function charsToApproxTokens(chars: number): number {
  return Math.round(chars / 4)
}
