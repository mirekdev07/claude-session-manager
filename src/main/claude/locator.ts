/**
 * Znajduje wykonywalny plik Claude Code i sprawdza jego wersję.
 *
 * Na Windows `where claude` zwraca najczęściej shim `claude.cmd` z globalnego npm.
 * Uruchamianie shima w PTY oznaczałoby pośredni `cmd.exe`, co psuje propagację Ctrl+C
 * i dokłada proces w drzewie. Dlatego rozwiązujemy shim do natywnego `claude.exe`
 * z pakietu `@anthropic-ai/claude-code` (postinstall kopiuje tam binarkę per-platforma).
 */
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import type { ClaudeCliInfo, ClaudeCliSource } from '@shared/types'
import { tMain } from '@main/i18n'

const execFileAsync = promisify(execFile)

const VERSION_TIMEOUT_MS = 5000
const IS_WINDOWS = process.platform === 'win32'
const EXE = IS_WINDOWS ? 'claude.exe' : 'claude'

interface Candidate {
  path: string
  source: ClaudeCliSource
}

/** Katalogi, w których Claude Code ląduje przy typowych instalacjach. */
function fallbackCandidates(): Candidate[] {
  const home = homedir()
  const appData = process.env.APPDATA ?? join(home, 'AppData', 'Roaming')
  const localAppData = process.env.LOCALAPPDATA ?? join(home, 'AppData', 'Local')

  const paths = [
    join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', EXE),
    join(home, '.local', 'bin', EXE),
    join(localAppData, 'Programs', 'claude', EXE),
    join(home, '.claude', 'local', EXE),
  ]

  return paths.map((path) => ({ path, source: 'fallback' as const }))
}

/** Pyta system, gdzie leży `claude`. Zwraca wszystkie trafienia w kolejności PATH. */
async function whichCandidates(): Promise<Candidate[]> {
  const command = IS_WINDOWS ? 'where' : 'which'
  try {
    const { stdout } = await execFileAsync(command, ['claude'], { timeout: VERSION_TIMEOUT_MS })
    return stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((path) => ({ path, source: 'path' as const }))
  } catch {
    return []
  }
}

/**
 * Zamienia shim (`claude.cmd`, `claude.ps1`, plik bez rozszerzenia) na natywny plik wykonywalny
 * leżący obok w `node_modules`. Gdy nie da się rozwiązać, zwraca oryginał.
 */
function resolveShim(candidate: Candidate): Candidate {
  const isShim = /\.(cmd|ps1|bat)$/i.test(candidate.path)
  if (!isShim) return candidate

  // %APPDATA%\npm\claude.cmd  →  %APPDATA%\npm\node_modules\@anthropic-ai\claude-code\bin\claude.exe
  const shimDir = candidate.path.slice(0, candidate.path.lastIndexOf('\\') + 1 || undefined)
  const native = join(shimDir, 'node_modules', '@anthropic-ai', 'claude-code', 'bin', EXE)

  return existsSync(native) ? { path: native, source: 'npm-global' } : candidate
}

function isUsableFile(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

/** Odczytuje wersję. Osobno rozróżniamy timeout od błędu, bo sugerują inne działania naprawcze. */
async function readVersion(
  executablePath: string
): Promise<{ ok: true; version: string } | { ok: false; timedOut: boolean; detail: string }> {
  try {
    const { stdout } = await execFileAsync(executablePath, ['--version'], {
      timeout: VERSION_TIMEOUT_MS,
      windowsHide: true,
    })
    // Format: "2.1.257 (Claude Code)"
    const version = stdout.trim().split(/\s+/)[0] ?? stdout.trim()
    return version ? { ok: true, version } : { ok: false, timedOut: false, detail: tMain('err.emptyResponse') }
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { killed?: boolean }
    return { ok: false, timedOut: err.killed === true, detail: err.message }
  }
}

/**
 * @param overridePath ścieżka wskazana ręcznie w Settings; ma pierwszeństwo przed wykrywaniem
 */
export async function locateClaudeCli(overridePath?: string): Promise<ClaudeCliInfo> {
  const candidates: Candidate[] = []

  if (overridePath) candidates.push({ path: overridePath, source: 'settings' })
  candidates.push(...(await whichCandidates()))
  candidates.push(...fallbackCandidates())

  const resolved = candidates.map(resolveShim).filter((c) => isUsableFile(c.path))

  if (resolved.length === 0) {
    return {
      ok: false,
      error: 'not-found',
      detail: tMain('err.cliNotFound'),
    }
  }

  let lastDetail = ''
  let lastTimedOut = false

  for (const candidate of resolved) {
    const version = await readVersion(candidate.path)
    if (version.ok) {
      return {
        ok: true,
        executablePath: candidate.path,
        version: version.version,
        source: candidate.source,
      }
    }
    lastDetail = version.detail
    lastTimedOut = version.timedOut
  }

  return {
    ok: false,
    error: lastTimedOut ? 'version-check-timeout' : 'version-check-failed',
    detail: lastDetail,
  }
}
