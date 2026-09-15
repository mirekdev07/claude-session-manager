/**
 * Sprawdza parser raportu `/usage` na prawdziwym wyjściu Claude Code.
 *
 * Uruchamia CLI tak samo jak aplikacja (własny katalog roboczy, wyczyszczone zmienne
 * sesji-rodzica), przepuszcza odpowiedź przez ten sam parser i pokazuje, co z niej wyszło.
 * Na koniec kasuje transkrypt pozostawiony przez sondę.
 *
 * Uruchomienie: npm run verify:usage
 */
import { execFile } from 'node:child_process'
import { mkdirSync, readdirSync, rmSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { locateClaude } from './locate-claude.mjs'
import { cleanupCompiled, importFromSource } from './lib/compile.mjs'

const execFileAsync = promisify(execFile)

const { parseUsageLimits } = await importFromSource('src/main/claude/usage-parser.ts')
const { encodeProjectPath } = await importFromSource('src/main/claude/path-encoding.ts')

const claudePath = await locateClaude()
if (!claudePath) {
  console.error('[FAIL] Nie znaleziono claude.exe')
  process.exit(1)
}

const cwd = join(tmpdir(), 'csm-usage-probe')
mkdirSync(cwd, { recursive: true })

const env = { ...process.env }
for (const key of [
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
]) {
  delete env[key]
}

const started = Date.now()
const { stdout } = await execFileAsync(claudePath, ['-p', '/usage'], {
  cwd,
  env,
  timeout: 30_000,
  windowsHide: true,
  maxBuffer: 4 * 1024 * 1024,
})
const elapsed = Date.now() - started

const limits = parseUsageLimits(stdout)
const report =
  limits.length === 0
    ? { ok: false, error: 'Nie rozpoznano odpowiedzi Claude Code na /usage' }
    : { ok: true, limits }

// Etykiety składa renderer w swoim języku; tu wystarczy surowy rodzaj limitu.
const labelOf = (limit) =>
  limit.kind === 'model' ? `week · ${limit.detail}` : limit.kind === 'raw' ? limit.detail : limit.kind

console.log(`Czas wywolania: ${elapsed} ms`)
console.log(`Dlugosc raportu: ${stdout.length} znakow\n`)

if (!report.ok) {
  console.log(`[FAIL] ${report.error}`)
  console.log('--- surowe wyjscie ---')
  console.log(stdout.slice(0, 400))
} else {
  console.log(`[OK] Rozpoznano ${report.limits.length} limitow:`)
  for (const limit of report.limits) {
    const bar = '#'.repeat(Math.round(limit.percentUsed / 5)).padEnd(20, '.')
    console.log(
      `  ${labelOf(limit).padEnd(20)} ${String(limit.percentUsed).padStart(3)}%  [${bar}]  odnowa: ${limit.resetsAt ?? '—'}`
    )
  }
  console.log(
    `\n[${report.limits.every((l) => l.resetsAt !== null) ? 'OK' : 'UWAGA'}] Czasy odnowy odczytane dla wszystkich pozycji`
  )
}

// Sprzątanie transkryptu sondy — dokładnie to, co robi aplikacja po każdym odczycie.
const transcripts = join(homedir(), '.claude', 'projects', encodeProjectPath(cwd))
let removed = 0
try {
  for (const entry of readdirSync(transcripts)) {
    if (!entry.endsWith('.jsonl')) continue
    rmSync(join(transcripts, entry), { force: true })
    removed++
  }
} catch {
  // katalog jeszcze nie powstał
}
console.log(`\nUsuniete transkrypty sondy: ${removed}`)

cleanupCompiled()
process.exit(report.ok ? 0 : 1)
