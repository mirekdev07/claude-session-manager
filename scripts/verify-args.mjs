/**
 * Sprawdza argumenty, z jakimi aplikacja uruchamia `claude` w każdym trybie.
 *
 * Nie ufa lekturze kodu: dla każdego trybu naprawdę startuje proces przez
 * `ClaudeProcessManager` i odczytuje linię poleceń potomka z systemu (WMI),
 * czyli to, co faktycznie zobaczył Windows. Interesuje nas przede wszystkim
 * `--dangerously-skip-permissions` — ma być przy każdym trybie, także wznowieniu
 * i forku, i ma znikać po wyłączeniu ustawienia.
 *
 * Uruchomienie: npm run verify:args
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupCompiled, importFromSource } from './lib/compile.mjs'

const execFileAsync = promisify(execFile)

// `node-pty` zostaje zewnętrzny, więc moduł musi leżeć w projekcie, żeby się rozwiązał.
const { ClaudeProcessManager } = await importFromSource('src/main/claude/process-manager.ts', {
  insideProject: true,
})

const SKIP_FLAG = '--dangerously-skip-permissions'
const SESSION_ID = '00000000-1111-2222-3333-444444444444'

const cwd = mkdtempSync(join(tmpdir(), 'csm-args-'))

const results = []
const record = (name, ok, detail) => {
  results.push(ok)
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name} — ${detail}`)
}

/** Linia poleceń procesu widziana przez system; `null`, gdy proces już zniknął. */
async function commandLineOf(pid) {
  const script = `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-NonInteractive', '-Command', script],
    { timeout: 20_000, windowsHide: true }
  )
  const line = stdout.trim()
  return line === '' ? null : line
}

/** Startuje sesję w danym trybie i zwraca jej linię poleceń, po czym kończy proces. */
async function argvFor(mode, settings) {
  const manager = new ClaudeProcessManager(
    { onData: () => {}, onExit: () => {}, onStatus: () => {} },
    () => settings
  )

  const info = await manager.create({
    cwd,
    mode,
    sessionId: mode === 'resume' || mode === 'fork' ? SESSION_ID : undefined,
    cols: 80,
    rows: 24,
  })

  try {
    // Proces musi zdążyć się pokazać w tablicy procesów systemu.
    await new Promise((resolve) => setTimeout(resolve, 700))
    return await commandLineOf(info.pid)
  } finally {
    manager.killAll()
  }
}

const baseSettings = {
  skipPermissions: true,
  claudeExtraArgs: [],
  claudeExecutablePath: null,
}

for (const mode of ['new', 'continue', 'resume', 'fork']) {
  try {
    const argv = await argvFor(mode, baseSettings)
    if (argv === null) {
      record(`tryb ${mode}`, false, 'proces zniknął, zanim udało się odczytać linię poleceń')
      continue
    }
    record(`tryb ${mode} dostaje ${SKIP_FLAG}`, argv.includes(SKIP_FLAG), argv)
  } catch (error) {
    record(`tryb ${mode}`, false, error.message)
  }
}

// Flaga jest niebezpieczna z definicji, więc wyłączenie ustawienia musi ją naprawdę zdejmować.
try {
  const argv = await argvFor('new', { ...baseSettings, skipPermissions: false })
  record(
    'wyłączone ustawienie zdejmuje flagę',
    argv !== null && !argv.includes(SKIP_FLAG),
    argv ?? 'brak procesu'
  )
} catch (error) {
  record('wyłączone ustawienie zdejmuje flagę', false, error.message)
}

// Dodatkowe argumenty użytkownika muszą dojść obok flagi, nie zamiast niej.
try {
  const argv = await argvFor('new', { ...baseSettings, claudeExtraArgs: ['--add-dir', cwd] })
  record(
    'dodatkowe argumenty dochodzą obok flagi',
    argv !== null && argv.includes(SKIP_FLAG) && argv.includes('--add-dir'),
    argv ?? 'brak procesu'
  )
} catch (error) {
  record('dodatkowe argumenty dochodzą obok flagi', false, error.message)
}

cleanupCompiled()

const failed = results.filter((ok) => !ok).length
console.log(failed === 0 ? '\n[OK] Argumenty zgodne z ustawieniami' : `\n[FAIL] Niepowodzeń: ${failed}`)
process.exit(failed === 0 ? 0 : 1)
