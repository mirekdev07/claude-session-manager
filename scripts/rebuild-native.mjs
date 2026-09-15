/**
 * Przebudowuje moduły natywne (node-pty, better-sqlite3) pod ABI Electrona.
 *
 * Dlaczego własny skrypt zamiast gołego `electron-rebuild`:
 *
 * Gdy w środowisku ustawiona jest zmienna `NoDefaultCurrentDirectoryInExePath`, `cmd.exe`
 * przestaje szukać programów w bieżącym katalogu. Plik `winpty.gyp` w node-pty woła
 * `cmd /c "cd shared && GetCommitHash.bat"` bez prefiksu `.\`, więc przy tej zmiennej
 * build przerywa się komunikatem "'GetCommitHash.bat' is not recognized...".
 *
 * Usuwamy zmienną wyłącznie z procesu potomnego — ustawienia systemu pozostają nietknięte.
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

// Celowo bez `require.resolve` — pakiet nie wystawia `lib/cli.js` w swojej mapie `exports`.
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const cli = join(projectRoot, 'node_modules', '@electron', 'rebuild', 'lib', 'cli.js')

if (!existsSync(cli)) {
  console.error(`Nie znaleziono electron-rebuild: ${cli}\nUruchom najpierw: npm install`)
  process.exit(1)
}

const env = { ...process.env }
delete env.NoDefaultCurrentDirectoryInExePath

const child = spawn(process.execPath, [cli, '-f', '-w', 'node-pty,better-sqlite3'], {
  env,
  stdio: 'inherit',
})

child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (error) => {
  console.error('Nie udało się uruchomić electron-rebuild:', error.message)
  process.exit(1)
})
