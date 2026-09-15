/**
 * Kompiluje moduł TypeScript z `src/` do tymczasowego pliku ESM i go importuje.
 *
 * Wbudowane w Node zdejmowanie typów nie radzi sobie ze składnią, której używamy
 * w kodzie produkcyjnym (m.in. parameter properties), a nie chcemy naginać kodu
 * pod ograniczenia narzędzia testowego. esbuild jest już w drzewie jako zależność Vite,
 * więc nie dokłada nowej biblioteki.
 *
 * Moduły natywne i `electron` zostają zewnętrzne — ładują się normalnie w czasie działania.
 */
import { build } from 'esbuild'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const temporaryDirectories = []

/**
 * @param entry ścieżka do pliku wejściowego, względem katalogu projektu
 * @param options.insideProject kompiluj do katalogu w projekcie zamiast do %TEMP%.
 *        Potrzebne, gdy moduł importuje zależność zostawioną jako zewnętrzna
 *        (np. `node-pty`) — z katalogu tymczasowego Node nie widzi `node_modules` projektu.
 * @returns przestrzeń nazw skompilowanego modułu
 */
export async function importFromSource(entry, options = {}) {
  const parent = options.insideProject ? join(projectRoot, 'node_modules', '.cache') : tmpdir()
  mkdirSync(parent, { recursive: true })
  const outputDirectory = mkdtempSync(join(parent, 'csm-compile-'))
  temporaryDirectories.push(outputDirectory)

  const outfile = join(outputDirectory, 'module.mjs')

  await build({
    entryPoints: [join(projectRoot, entry)],
    outfile,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    external: ['electron', 'better-sqlite3', 'node-pty', 'chokidar'],
    alias: {
      '@shared': join(projectRoot, 'src', 'shared'),
      '@main': join(projectRoot, 'src', 'main'),
    },
    logLevel: 'warning',
  })

  return import(pathToFileURL(outfile).href)
}

/** Sprząta pliki pośrednie. Wołane na końcu skryptu weryfikującego. */
export function cleanupCompiled() {
  for (const directory of temporaryDirectories) {
    rmSync(directory, { recursive: true, force: true })
  }
  temporaryDirectories.length = 0
}
