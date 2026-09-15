/**
 * Lista projektów: te dodane ręcznie oraz te wykryte z transkryptów Claude Code.
 *
 * Usunięcie projektu z aplikacji nigdy nie dotyka katalogu na dysku (§4 planu).
 */
import { execFile, spawn } from 'node:child_process'
import { stat } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { promisify } from 'node:util'
import { shell } from 'electron'

const execFileAsync = promisify(execFile)

/** Edytory szukane w PATH, w kolejności preferencji. */
const EDITOR_COMMANDS = ['code', 'cursor', 'codium']
import type { Database } from 'better-sqlite3'
import type { Project } from '@shared/types'
import type { ClaudeSessionProvider } from '@main/claude/session-provider'
import { usageProbeDirectory } from '@main/claude/usage-provider'
import { readGitBranch } from '@main/git/service'
import { mainLocale, tMain } from '@main/i18n'
import { localeTag } from '@shared/i18n'

interface ProjectRow {
  path: string
  display_name: string | null
  is_favorite: number
  is_hidden: number
  added_at: number
  last_opened_at: number | null
}

export class ProjectManager {
  constructor(
    private readonly db: Database,
    private readonly sessions: ClaudeSessionProvider
  ) {}

  /**
   * Scala trzy źródła: wpisy dodane ręcznie, katalogi wykryte z transkryptów
   * oraz bieżący stan dysku i gita.
   *
   * @param runningByPath liczba działających terminali per projekt
   */
  async list(runningByPath: ReadonlyMap<string, number> = new Map()): Promise<Project[]> {
    const tracked = new Map(
      this.db
        .prepare<[], ProjectRow>('SELECT * FROM projects')
        .all()
        .map((row) => [row.path, row])
    )

    const discovered = new Map(
      this.sessions.summarizeProjects().map((entry) => [entry.path, entry])
    )

    const hidden = new Set(
      [...tracked.values()].filter((row) => row.is_hidden === 1).map((row) => row.path)
    )

    // Katalog roboczy sondy zużycia bywa widoczny jako "projekt", zanim zdążymy skasować
    // pozostawiony przez nią transkrypt. Nie ma tam nic dla użytkownika.
    const probe = usageProbeDirectory()

    const paths = new Set<string>([...tracked.keys(), ...discovered.keys()])
    const projects: Project[] = []

    for (const path of paths) {
      if (hidden.has(path) || path === probe) continue

      const row = tracked.get(path)
      const stats = discovered.get(path)
      const exists = await directoryExists(path)

      projects.push({
        path,
        name: row?.display_name ?? basename(path) ?? path,
        displayName: row?.display_name ?? null,
        isFavorite: row?.is_favorite === 1,
        isTracked: row !== undefined,
        exists,
        sessionCount: stats?.sessionCount ?? 0,
        lastActivityAt: stats?.lastActivityAt ?? null,
        // Nieistniejącego katalogu nie ma sensu odpytywać o brancha.
        gitBranch: exists ? await readGitBranch(path) : null,
        runningSessions: runningByPath.get(path) ?? 0,
      })
    }

    return projects.sort(compareProjects)
  }

  /** Alias nadany przez użytkownika albo `null`, gdy projekt nie ma własnej nazwy. */
  displayNameFor(path: string): string | null {
    const row = this.db
      .prepare<[string], { display_name: string | null }>(
        'SELECT display_name FROM projects WHERE path = ?'
      )
      .get(path)
    return row?.display_name ?? null
  }

  /** @throws gdy ścieżka nie wskazuje istniejącego katalogu */
  async add(rawPath: string): Promise<string> {
    const path = resolve(rawPath)
    if (!(await directoryExists(path))) {
      throw new Error(tMain('err.dirMissing', { path }))
    }

    this.db
      .prepare(
        `INSERT INTO projects (path, added_at, is_hidden) VALUES (?, ?, 0)
         ON CONFLICT(path) DO UPDATE SET is_hidden = 0`
      )
      .run(path, Date.now())

    return path
  }

  /**
   * Usuwa projekt z listy w aplikacji. Katalog i transkrypty zostają nietknięte.
   *
   * Projekt wykryty automatycznie nie może po prostu zniknąć z tabeli — wróciłby przy
   * następnym skanie. Dlatego zapisujemy go jako ukryty.
   */
  remove(rawPath: string): void {
    const path = resolve(rawPath)
    this.db
      .prepare(
        `INSERT INTO projects (path, added_at, is_hidden) VALUES (?, ?, 1)
         ON CONFLICT(path) DO UPDATE SET is_hidden = 1`
      )
      .run(path, Date.now())
  }

  rename(rawPath: string, displayName: string | null): void {
    const path = resolve(rawPath)
    const trimmed = displayName?.trim()
    this.ensureRow(path)
    this.db
      .prepare('UPDATE projects SET display_name = ? WHERE path = ?')
      .run(trimmed === '' ? null : (trimmed ?? null), path)
  }

  setFavorite(rawPath: string, isFavorite: boolean): void {
    const path = resolve(rawPath)
    this.ensureRow(path)
    this.db
      .prepare('UPDATE projects SET is_favorite = ? WHERE path = ?')
      .run(isFavorite ? 1 : 0, path)
  }

  markOpened(rawPath: string): void {
    const path = resolve(rawPath)
    this.ensureRow(path)
    this.db.prepare('UPDATE projects SET last_opened_at = ? WHERE path = ?').run(Date.now(), path)
  }

  /** @returns komunikat błędu albo `null` przy powodzeniu */
  async openInExplorer(rawPath: string): Promise<string | null> {
    const path = resolve(rawPath)
    if (!(await directoryExists(path))) return tMain('err.dirMissing', { path })
    return shell.openPath(path).then((error) => error || null)
  }

  /**
   * Otwiera katalog w edytorze z PATH (VS Code, Cursor, VSCodium — pierwszy znaleziony).
   * @returns komunikat błędu albo `null` przy powodzeniu
   */
  async openInEditor(rawPath: string): Promise<string | null> {
    const path = resolve(rawPath)
    if (!(await directoryExists(path))) return tMain('err.dirMissing', { path })

    for (const command of EDITOR_COMMANDS) {
      const executable = await locateOnPath(command)
      if (executable === null) continue
      /*
       * Na Windows `code` z PATH to shim `code.cmd`, a Node odmawia uruchomienia `.cmd`
       * bez `shell: true` (łatka na CVE-2024-27980). Przy `shell: true` argumenty trafiają
       * do `cmd.exe` jako surowa linia poleceń, więc katalog o nazwie `raport & calc`
       * — całkowicie legalnej na Windows — wykonałby dowolne polecenie. Ścieżkę cytujemy
       * więc sami; znaku `"` Windows w nazwach nie dopuszcza, nie da się z nich wyjść.
       */
      const viaShell = /\.(cmd|bat)$/i.test(executable)
      if (viaShell && path.includes('"')) return tMain('err.editorNotFound')

      try {
        // Odłączony proces: zamknięcie menedżera nie ma zamykać edytora.
        const child = spawn(executable, [viaShell ? `"${path}"` : path], {
          detached: true,
          stdio: 'ignore',
          shell: viaShell,
          windowsHide: true,
        })
        child.unref()
        return null
      } catch (error) {
        return tMain('err.editorFailed', {
          command,
          detail: error instanceof Error ? error.message : String(error),
        })
      }
    }
    return tMain('err.editorNotFound')
  }

  private ensureRow(path: string): void {
    this.db
      .prepare('INSERT OR IGNORE INTO projects (path, added_at) VALUES (?, ?)')
      .run(path, Date.now())
  }
}

/** Ścieżka do polecenia z PATH albo `null`, gdy nie ma go w systemie. */
async function locateOnPath(command: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(process.platform === 'win32' ? 'where' : 'which', [command], {
      timeout: 5000,
      windowsHide: true,
    })
    const first = stdout.split(/\r?\n/).map((line) => line.trim()).find((line) => line !== '')
    return first ?? null
  } catch {
    return null
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

/** Ulubione na górze, potem najnowsza aktywność, na końcu nazwa. */
function compareProjects(a: Project, b: Project): number {
  if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1
  if (a.lastActivityAt !== b.lastActivityAt) {
    return (b.lastActivityAt ?? 0) - (a.lastActivityAt ?? 0)
  }
  return a.name.localeCompare(b.name, localeTag(mainLocale()))
}
