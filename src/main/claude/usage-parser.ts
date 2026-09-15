/**
 * Parsowanie raportu `claude -p "/usage"`.
 *
 * Wydzielone z `usage-provider`, który sięga po `electron` — dzięki temu sam parser
 * jest czystą funkcją i da się go sprawdzić bez uruchamiania aplikacji (`verify:usage`).
 * Parser nie tłumaczy niczego: zwraca rodzaj limitu, a etykietę składa renderer w swoim języku.
 */
import type { UsageLimit } from '@shared/types'

/**
 * Wyciąga limity z raportu. Pusta lista oznacza, że raport nie został rozpoznany.
 *
 * Format linii: `Current session: 35% used · resets Sep 3, 10:09pm (Europe/Berlin)`.
 * Zestaw pozycji zależy od planu (dochodzą limity per model), więc nie zakładamy konkretnych
 * nazw — bierzemy każdą linię pasującą do wzorca. Sekcja „What's contributing…" zawiera
 * procenty w innym układzie i celowo się tu nie łapie.
 */
export function parseUsageLimits(output: string): UsageLimit[] {
  const limits: UsageLimit[] = []

  for (const line of output.split(/\r?\n/)) {
    const match = /^\s*(.+?):\s*(\d+)%\s*used(?:\s*·\s*resets\s+(.+?))?\s*$/.exec(line)
    if (!match?.[1] || match[2] === undefined) continue

    limits.push({
      ...classifyLabel(match[1].trim()),
      percentUsed: Number(match[2]),
      // Strefa czasowa w nawiasie jest zawsze lokalna — w interfejsie tylko zabiera miejsce.
      resetsAt: match[3]?.replace(/\s*\([^)]*\)\s*$/, '').trim() ?? null,
    })
  }

  return limits
}

/** Etykiety przychodzą po angielsku; rozpoznajemy te stałe, resztę przekazujemy dosłownie. */
function classifyLabel(label: string): Pick<UsageLimit, 'kind' | 'detail'> {
  if (label === 'Current session') return { kind: 'session', detail: null }
  if (label === 'Current week (all models)') return { kind: 'week', detail: null }

  const model = /^Current week \((.+)\)$/.exec(label)
  if (model?.[1]) return { kind: 'model', detail: model[1] }

  return { kind: 'raw', detail: label }
}
