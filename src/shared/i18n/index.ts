/**
 * Napisy interfejsu współdzielone przez main i renderer.
 *
 * Oba procesy wołają to samo `translate`, więc komunikaty błędów z procesu głównego
 * i etykiety w oknie brzmią tak samo. Klucze są typowane — literówka to błąd kompilacji.
 */
import { DEFAULT_LOCALE, localeTag, type Locale } from './locales'
import { pl, type MessageKey, type Messages, type PluralForms } from './messages'

export type { Locale, WhisperLanguage } from './locales'
export { DEFAULT_LOCALE, LOCALES, WHISPER_LANGUAGES, localeTag } from './locales'
export type { MessageKey, Messages, PluralForms } from './messages'

const CATALOG: Record<Locale, Messages> = { pl }

export type TranslateParams = Record<string, string | number>

/**
 * @param params wartości do podstawienia; `count` wybiera też formę liczby mnogiej
 */
export function translate(locale: Locale, key: MessageKey, params?: TranslateParams): string {
  const raw: string | PluralForms = CATALOG[locale]?.[key] ?? pl[key]
  const text = typeof raw === 'string' ? raw : selectPlural(locale, raw, params?.count)
  return params ? interpolate(text, params) : text
}

/** Funkcja tłumacząca z przypiętym językiem — wygodna w komponentach i w main. */
export type Translator = (key: MessageKey, params?: TranslateParams) => string

export function translatorFor(locale: Locale): Translator {
  return (key, params) => translate(locale, key, params)
}

function selectPlural(locale: Locale, forms: PluralForms, count: string | number | undefined): string {
  const value = typeof count === 'number' ? count : Number(count ?? 0)
  let category: Intl.LDMLPluralRule = 'other'
  try {
    category = new Intl.PluralRules(localeTag(locale)).select(value)
  } catch {
    // brak danych Intl dla języka — forma "other" jest zawsze obecna
  }
  return forms[category] ?? forms.other
}

function interpolate(text: string, params: TranslateParams): string {
  return text.replace(/\{(\w+)\}/g, (match, name: string) => {
    const value = params[name]
    return value === undefined ? match : String(value)
  })
}

// --- daty ---

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/** „przed chwilą", „12 minut temu", „wczoraj", „3 dni temu", potem data. */
export function formatRelative(locale: Locale, timestamp: number | null): string {
  const t = translatorFor(locale)
  if (timestamp === null) return t('time.never')

  const diff = Date.now() - timestamp
  if (diff < MINUTE) return t('time.justNow')
  if (diff < HOUR) return t('time.minutesAgo', { count: Math.floor(diff / MINUTE) })
  if (diff < DAY) return t('time.hoursAgo', { count: Math.floor(diff / HOUR) })

  const days = Math.floor(diff / DAY)
  if (days === 1) return t('time.yesterday')
  if (days < 7) return t('time.daysAgo', { count: days })

  return new Date(timestamp).toLocaleDateString(localeTag(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  })
}

export function formatDateTime(locale: Locale, timestamp: number): string {
  return new Date(timestamp).toLocaleString(localeTag(locale), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatTime(locale: Locale, timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString(localeTag(locale))
}

export { DEFAULT_LOCALE as FALLBACK_LOCALE }
