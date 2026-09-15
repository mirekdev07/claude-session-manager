/**
 * Język interfejsu i języki mowy.
 *
 * Interfejs jest wyłącznie po polsku; `tag` (BCP 47) służy `Intl` do dat i liczby mnogiej.
 * Język mowy dla whisper.cpp jest osobnym ustawieniem — `auto` zostawia wykrywanie silnikowi.
 */
export const LOCALES = [{ code: 'pl', name: 'Polski', tag: 'pl-PL' }] as const

export type Locale = (typeof LOCALES)[number]['code']

export const DEFAULT_LOCALE: Locale = 'pl'

export type WhisperLanguage = 'auto' | 'pl' | 'en'

export const WHISPER_LANGUAGES = ['auto', 'pl', 'en'] as [WhisperLanguage, ...WhisperLanguage[]]

export function localeTag(locale: Locale): string {
  return LOCALES.find((entry) => entry.code === locale)?.tag ?? 'pl-PL'
}
