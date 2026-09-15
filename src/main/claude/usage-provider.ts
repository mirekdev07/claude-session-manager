/**
 * Odczyt zużycia limitów subskrypcji.
 *
 * Claude Code pokazuje te dane komendą `/usage` w TUI, ale nie trzeba jej parsować z ekranu:
 * `claude -p "/usage"` zwraca ten sam raport jako czysty tekst, bezgłowo i bez ekranu zaufania.
 *
 * Ustalenia z pomiarów:
 *   - wywołanie trwa około 2,8 s,
 *   - **nie zwiększa licznika zapytań** (trzy wywołania pod rząd: 1166 → 1166 → 1165,
 *     spadek to przesuwające się okno 24 h) — odpytywanie cykliczne jest więc bezpieczne,
 *   - każde wywołanie zapisuje transkrypt, dlatego uruchamiamy je we własnym katalogu
 *     roboczym i po odczycie kasujemy pozostawiony plik,
 *   - `--session-id` nie da się użyć dwa razy („Session ID is already in use"), więc
 *     każde wywołanie dostaje świeży identyfikator.
 */
import { execFile } from 'node:child_process'
import { mkdir, readdir, rm } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { UsageReport } from '@shared/types'
import { locateClaudeCli } from './locator'
import { encodeProjectPath } from './path-encoding'
import { parseUsageLimits } from './usage-parser'
import { tMain } from '@main/i18n'

const execFileAsync = promisify(execFile)

const CALL_TIMEOUT_MS = 30_000

/** Zmienne opisujące sesję-rodzica; bez ich usunięcia potomny proces zmienia zachowanie. */
const PARENT_SESSION_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_EFFORT',
  'CLAUDE_PID',
] as const

/** Własny katalog roboczy sond — trzyma transkrypty z dala od projektów użytkownika. */
export function usageProbeDirectory(): string {
  return join(app.getPath('userData'), 'usage-probe')
}

/** Środowisko dla bezgłowych wywołań `claude -p`: bez markerów sesji-rodzica. */
export function probeEnvironment(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env }
  for (const key of PARENT_SESSION_ENV_VARS) delete env[key]
  return env
}

/** Sondy zostawiają transkrypt przy każdym wywołaniu; bez sprzątania rosłyby w nieskończoność. */
export async function discardProbeTranscripts(): Promise<void> {
  const directory = join(homedir(), '.claude', 'projects', encodeProjectPath(usageProbeDirectory()))
  try {
    for (const entry of await readdir(directory)) {
      if (entry.endsWith('.jsonl')) await rm(join(directory, entry), { force: true })
    }
  } catch {
    // Katalog jeszcze nie istnieje albo plik jest zajęty — spróbujemy przy następnym odczycie.
  }
}

export class UsageProvider {
  private cached: UsageReport | null = null
  private inFlight: Promise<UsageReport> | null = null

  /** Ostatni odczyt bez odpytywania CLI. */
  getCached(): UsageReport | null {
    return this.cached
  }

  /**
   * Odczytuje bieżące zużycie.
   *
   * Równoległe wywołania współdzielą jedno zapytanie — odświeżenie z timera i kliknięcie
   * użytkownika nie powinny uruchamiać dwóch procesów naraz.
   */
  async refresh(): Promise<UsageReport> {
    this.inFlight ??= this.run().finally(() => {
      this.inFlight = null
    })
    return this.inFlight
  }

  private async run(): Promise<UsageReport> {
    const cli = await locateClaudeCli()
    if (!cli.ok) {
      return this.fail(tMain('err.claudeUnavailable', { detail: cli.detail }))
    }

    const cwd = usageProbeDirectory()
    await mkdir(cwd, { recursive: true })

    try {
      const { stdout } = await execFileAsync(cli.executablePath, ['-p', '/usage'], {
        cwd,
        env: probeEnvironment(),
        timeout: CALL_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 4 * 1024 * 1024,
      })

      const limits = parseUsageLimits(stdout)
      if (limits.length === 0) return this.fail(tMain('usage.parseError'))

      this.cached = { ok: true, limits, detail: stdout.trim(), fetchedAt: Date.now() }
      return this.cached
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { killed?: boolean }
      return this.fail(
        err.killed === true ? tMain('usage.timeout') : err.message
      )
    } finally {
      await discardProbeTranscripts()
    }
  }

  private fail(message: string): UsageReport {
    this.cached = { ok: false, error: message, fetchedAt: Date.now() }
    return this.cached
  }
}
