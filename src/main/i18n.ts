/**
 * Napisy procesu głównego.
 *
 * Wszystko, co trafia do użytkownika z main (błędy, powiadomienia systemowe, tytuły okien
 * dialogowych, eksport, prompt handoffu), przechodzi przez `tMain` — ten sam katalog
 * co w rendererze, więc komunikaty brzmią spójnie.
 */
import { DEFAULT_LOCALE, translate, type Locale, type MessageKey, type TranslateParams } from '@shared/i18n'

export function mainLocale(): Locale {
  return DEFAULT_LOCALE
}

export function tMain(key: MessageKey, params?: TranslateParams): string {
  return translate(DEFAULT_LOCALE, key, params)
}
