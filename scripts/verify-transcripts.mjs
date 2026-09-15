/**
 * Sprawdza warstwę odczytu transkryptów na prawdziwych danych w `~/.claude/projects`.
 *
 * Weryfikuje trzy rzeczy, na których stoi Etap 1:
 *   1. `encodeProjectPath` odtwarza nazwy istniejących katalogów,
 *   2. `readSessionMetadata` wyciąga sessionId, cwd, branch i tytuł,
 *   3. odczyt jest szybki — czytamy nagłówki, nie całe pliki.
 *
 * Uruchomienie: node scripts/verify-transcripts.mjs
 */
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { cleanupCompiled, importFromSource } from './lib/compile.mjs'

const { encodeProjectPath } = await importFromSource('src/main/claude/path-encoding.ts')
const { readSessionMetadata } = await importFromSource('src/main/claude/transcript-reader.ts')

const root = join(homedir(), '.claude', 'projects')
const started = Date.now()

const entries = await readdir(root, { withFileTypes: true })
const directories = entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)

let transcripts = 0
let totalBytes = 0
let withCwd = 0
let withTitle = 0
let withBranch = 0
const encodingMismatches = []
const byCwd = new Map()
const samples = []

let inheritedCwd = 0

for (const directory of directories) {
  const files = (await readdir(join(root, directory), { withFileTypes: true }))
    .filter((entry) => entry.isFile() && entry.name.endsWith('.jsonl'))
    .map((entry) => join(root, directory, entry.name))

  // Ta sama dwufazowość co w ClaudeSessionProvider.scanDirectory: najpierw czytamy cały
  // katalog, potem uzupełniamy brakujące cwd ścieżką z sąsiedniego transkryptu.
  const inDirectory = []
  let directoryCwd = null
  for (const filePath of files) {
    const metadata = await readSessionMetadata(filePath)
    if (!metadata) continue
    directoryCwd ??= metadata.cwd
    inDirectory.push(metadata)
  }

  for (const metadata of inDirectory) {
    if (!metadata.cwd && directoryCwd) {
      metadata.cwd = directoryCwd
      inheritedCwd++
    }

    transcripts++
    totalBytes += metadata.sizeBytes
    if (metadata.cwd) withCwd++
    if (metadata.title) withTitle++
    if (metadata.gitBranch) withBranch++

    if (metadata.cwd) {
      byCwd.set(metadata.cwd, (byCwd.get(metadata.cwd) ?? 0) + 1)

      // Kluczowe założenie: z cwd zapisanego w pliku odtwarzamy nazwę katalogu Claude Code.
      const encoded = encodeProjectPath(metadata.cwd)
      if (encoded !== directory) {
        encodingMismatches.push({ cwd: metadata.cwd, expected: directory, got: encoded })
      }
    }

    if (samples.length < 6 && metadata.title) samples.push(metadata)
  }
}

const elapsed = Date.now() - started

console.log(`Katalogi projektów:      ${directories.length}`)
console.log(`Transkrypty:             ${transcripts}`)
console.log(`Łączny rozmiar:          ${(totalBytes / 1024 / 1024).toFixed(1)} MB`)
console.log(`Czas odczytu nagłówków:  ${elapsed} ms  (${(elapsed / transcripts).toFixed(1)} ms/plik)`)
console.log()
console.log(`Z odczytanym cwd:        ${withCwd}/${transcripts}  (w tym odziedziczone z sąsiada: ${inheritedCwd})`)
console.log(`Z tytułem (pierwszy prompt): ${withTitle}/${transcripts}`)
console.log(`Z branchem git:          ${withBranch}/${transcripts}`)
console.log(`Unikalnych projektów (po cwd): ${byCwd.size}`)
console.log()
console.log(
  encodingMismatches.length === 0
    ? '[OK] Kodowanie ścieżek zgadza się dla wszystkich transkryptów'
    : `[FAIL] Rozbieżności kodowania: ${encodingMismatches.length}`
)
for (const mismatch of encodingMismatches.slice(0, 5)) {
  console.log(`   cwd=${mismatch.cwd}\n   oczekiwano=${mismatch.expected}\n   otrzymano  =${mismatch.got}`)
}

console.log('\n--- przykładowe sesje ---')
for (const sample of samples) {
  console.log(`${sample.sessionId.slice(0, 8)} | ${sample.gitBranch ?? '—'} | ${sample.title}`)
  console.log(`         ${sample.cwd}`)
}

const topProjects = [...byCwd.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5)
console.log('\n--- projekty z największą liczbą sesji ---')
for (const [cwd, count] of topProjects) console.log(`${String(count).padStart(3)} × ${cwd}`)

cleanupCompiled()
process.exit(encodingMismatches.length === 0 && withCwd === transcripts ? 0 : 1)
