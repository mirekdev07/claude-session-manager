/**
 * Uruchamia podany skrypt w środowisku Node **Electrona**.
 *
 * `better-sqlite3` i `node-pty` to moduły natywne skompilowane pod ABI Electrona,
 * więc systemowy Node ich nie załaduje. `ELECTRON_RUN_AS_NODE` daje właściwe ABI
 * bez inicjalizacji GUI, która wymaga pełnej sesji pulpitu.
 *
 * Uruchomienie: node scripts/run-under-electron.mjs <skrypt> [argumenty…]
 */
import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const electron = join(projectRoot, 'node_modules', 'electron', 'dist', 'electron.exe')

const [script, ...rest] = process.argv.slice(2)
if (!script) {
  console.error('Użycie: node scripts/run-under-electron.mjs <skrypt> [argumenty…]')
  process.exit(1)
}
if (!existsSync(electron)) {
  console.error(`Nie znaleziono Electrona: ${electron}\nUruchom najpierw: npm install`)
  process.exit(1)
}

const child = spawn(electron, [join(projectRoot, script), ...rest], {
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
  stdio: 'inherit',
})

child.on('exit', (code) => process.exit(code ?? 1))
child.on('error', (error) => {
  console.error(`Nie udało się uruchomić Electrona: ${error.message}`)
  process.exit(1)
})
