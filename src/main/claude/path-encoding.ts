import { resolve } from 'node:path'

/**
 * Zamienia ścieżkę projektu na nazwę katalogu, w którym Claude Code trzyma jego transkrypty.
 *
 * Reguła zweryfikowana na 55 istniejących katalogach w `~/.claude/projects`:
 * każdy znak spoza `[A-Za-z0-9]` staje się myślnikiem.
 *
 *   D:\Claude Manager              → D--Claude-Manager
 *   C:\Users\X\Desktop\src5.2      → C--Users-X-Desktop-src5-2
 *   C:\Users\X\Desktop\Nowy folder (3) → C--Users-X-Desktop-Nowy-folder--3-
 *
 * UWAGA: kodowanie jest **stratne i nieodwracalne** — z `Nowy-folder--3-` nie da się odtworzyć
 * oryginału. Dlatego działa wyłącznie w tę stronę. Kierunek katalog → projekt realizuje
 * `transcript-reader`, czytając pole `cwd` ze środka pliku transkryptu.
 */
export function encodeProjectPath(absolutePath: string): string {
  return resolve(absolutePath).replace(/[^A-Za-z0-9]/g, '-')
}
