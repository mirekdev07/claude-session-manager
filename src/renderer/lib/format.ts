/**
 * Formatowanie rozmiarów i ścieżek.
 *
 * Daty i czas względny są w `@shared/i18n` (przez `useDates()` w komponentach),
 * bo zależą od języka interfejsu.
 */

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Skraca długą ścieżkę od lewej, zachowując czytelny koniec: `…\Desktop\projekt`. */
export function shortenPath(path: string, maxLength = 42): string {
  if (path.length <= maxLength) return path
  return `…${path.slice(path.length - maxLength + 1)}`
}
