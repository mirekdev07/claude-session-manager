import { useMemo } from 'react'
import {
  DEFAULT_LOCALE,
  formatDateTime,
  formatRelative,
  formatTime,
  translate,
  translatorFor,
  type Locale,
  type MessageKey,
  type TranslateParams,
  type Translator,
} from '@shared/i18n'

/**
 * Dostęp do napisów interfejsu z komponentów i store'ów.
 *
 * Język jest jeden, więc nie ma tu stanu — to cienka warstwa nad `translate`, dzięki której
 * komponent pisze `t('sessions.new')` zamiast literałów rozsianych po plikach.
 */
const LOCALE: Locale = DEFAULT_LOCALE
const TRANSLATOR = translatorFor(LOCALE)

// Atrybut `lang` steruje m.in. dzieleniem wyrazów i doborem glifów w przeglądarce.
document.documentElement.lang = LOCALE

/** Funkcja tłumacząca dla komponentów. */
export function useT(): Translator {
  return TRANSLATOR
}

export function useLocale(): Locale {
  return LOCALE
}

export interface DateFormatters {
  relative: (timestamp: number | null) => string
  dateTime: (timestamp: number) => string
  time: (timestamp: number) => string
}

/** Formatery dat w języku interfejsu. */
export function useDates(): DateFormatters {
  return useMemo(
    () => ({
      relative: (timestamp) => formatRelative(LOCALE, timestamp),
      dateTime: (timestamp) => formatDateTime(LOCALE, timestamp),
      time: (timestamp) => formatTime(LOCALE, timestamp),
    }),
    []
  )
}

/** Do użycia poza cyklem renderowania — w store'ach i callbackach. */
export function tNow(key: MessageKey, params?: TranslateParams): string {
  return translate(LOCALE, key, params)
}

export function localeNow(): Locale {
  return LOCALE
}
