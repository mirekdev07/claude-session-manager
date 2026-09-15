/**
 * Sprawdza empirycznie, czy Claude Code rozpoznaje obraz przekazany naszymi strategiami.
 *
 * Plan (§12) wymaga wprost: „Nie zakładaj rozwiązania bez sprawdzenia go na aktualnej
 * wersji Claude Code". Skrypt uruchamia prawdziwy proces w PTY, przechodzi przez ekran
 * zaufania katalogiem, wysyła ścieżkę obrazu wybraną strategią i sprawdza, co pojawiło się
 * w polu promptu.
 *
 * Strategia `clipboard-paste` NIE jest tu testowana — wymaga systemowego schowka,
 * a więc pełnej sesji GUI Electrona. Zostaje do testów ręcznych.
 *
 * Uruchomienie: npm run verify:inject
 */
import { createRequire } from 'node:module'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateClaude } from './locate-claude.mjs'
import { createPng } from './lib/make-png.mjs'

const require = createRequire(import.meta.url)
const pty = require('node-pty')

const ESC = String.fromCharCode(27)
const BEL = String.fromCharCode(7)
const CSI_PATTERN = new RegExp(ESC + '\\[[0-9;?]*[a-zA-Z]', 'g')
const OSC_PATTERN = new RegExp(ESC + '\\][^' + BEL + ']*' + BEL, 'g')

/** TUI pokazuje dołączony obraz jako `[Image #N]` — potwierdzone w transkryptach użytkownika. */
const IMAGE_MARKER = /\[Image\s*#\d+\]/i

const claudePath = await locateClaude()
if (!claudePath) {
  console.error('[FAIL] Nie znaleziono claude.exe')
  process.exit(1)
}

const workspace = mkdtempSync(join(tmpdir(), 'csm-inject-'))
const imagePath = join(workspace, 'test-obraz.png')
writeFileSync(
  imagePath,
  createPng(160, 120, (x, y) => (((x >> 4) + (y >> 4)) % 2 === 0 ? [217, 119, 87] : [26, 26, 31]))
)

console.log(`Claude:  ${claudePath}`)
console.log(`Katalog: ${workspace}`)
console.log(`Obraz:   ${imagePath}\n`)

// Rozgrzewka: pierwszy start w nowym katalogu zawsze pyta o zaufanie, a dialog pochłania
// cały input. Odpowiadamy raz, żeby właściwe próby zaczynały się od gotowego promptu.
console.log('Rozgrzewka: ustanawiam zaufanie do katalogu…')
await runStrategy(null)
console.log()

const results = []
for (const strategy of ['bracketed-path', 'plain-path']) {
  results.push(await runStrategy(strategy))
}

console.log('=== WNIOSEK ===')
const withMarker = results.find((result) => result.hasMarker)
const withPath = results.find((result) => result.hasPath)

if (withMarker) {
  console.log(`Claude Code robi z obrazu załącznik przy strategii: ${withMarker.strategy}`)
  console.log('→ ustaw ją jako imageInjectStrategy')
} else if (withPath) {
  console.log('Żadna ze strategii tekstowych nie dała znacznika [Image #N].')
  console.log(`Ścieżka trafia do promptu jako zwykły tekst (${withPath.strategy}) — Claude odczyta`)
  console.log('obraz narzędziem Read, kosztem jednej dodatkowej tury. Wariant awaryjny działa.')
  console.log('Strategię clipboard-paste trzeba sprawdzić ręcznie w uruchomionej aplikacji.')
} else {
  console.log('Nic nie dotarło do promptu — sprawdź ścieżkę wysyłania do PTY.')
}

process.exit(0)

/** @param strategy `null` uruchamia wyłącznie rozgrzewkę ustanawiającą zaufanie */
async function runStrategy(strategy) {
  const child = pty.spawn(claudePath, [], {
    name: 'xterm-256color',
    cols: 120,
    rows: 30,
    cwd: workspace,
    env: cleanEnv(),
    useConpty: true,
  })

  let buffer = ''
  let exited = null
  child.onData((chunk) => {
    buffer += chunk
  })
  child.onExit(({ exitCode, signal }) => {
    exited = { exitCode, signal }
  })

  // TUI pozycjonuje słowa kursorem, więc po usunięciu sekwencji sterujących tekst
  // skleja się bez spacji. Porównania robimy na wersji bez białych znaków.
  const screen = () => clean(buffer).replace(/\s+/g, '')

  // Ekran zaufania pojawia się dla każdego nowego katalogu; domyślnie zaznaczone jest "No, exit".
  const sawTrustPrompt = await waitFor(() => /Itrustthisfolder/i.test(screen()), 15000)
  if (sawTrustPrompt) {
    child.write(ESC + '[B') // przenieś zaznaczenie na "Yes, I trust this folder"
    await delay(400)
    child.write('\r')
  }

  const ready = await waitFor(
    () => /forshortcuts|bypasspermissions|acceptedits|automodeon|Try"/i.test(screen()),
    20000
  )
  await delay(1500)

  if (strategy === null) {
    console.log(`  zaufanie ustanowione: ${ready ? 'tak' : 'NIE — dalsze próby mogą zawieść'}`)
    try {
      child.kill()
    } catch {
      /* proces mógł już zniknąć */
    }
    await delay(800)
    return { strategy: 'warmup', hasMarker: false, hasPath: false }
  }

  const mark = buffer.length
  child.write(
    strategy === 'bracketed-path'
      ? ESC + '[200~' + imagePath + ESC + '[201~'
      : '"' + imagePath + '" '
  )
  await delay(5000)

  const delta = clean(buffer.slice(mark))
  const hasMarker = IMAGE_MARKER.test(delta)
  const hasPath = delta.includes('test-obraz')

  console.log(`--- ${strategy} ---`)
  console.log(`  ekran zaufania obsłużony: ${sawTrustPrompt ? 'tak' : 'nie było'}`)
  console.log(`  prompt gotowy:            ${ready ? 'tak' : 'NIE (timeout)'}`)
  console.log(`  znacznik [Image #N]:      ${hasMarker ? 'TAK' : 'nie'}`)
  console.log(`  ścieżka widoczna w TUI:   ${hasPath ? 'TAK' : 'nie'}`)
  console.log(`  bajtów w odpowiedzi:      ${buffer.length - mark}`)
  console.log(`  proces zakonczony:        ${exited ? JSON.stringify(exited) : 'nie, dziala'}`)
  if (!ready) {
    console.log(`  ostatnie 300 znakow ekranu: ...${screen().slice(-300)}`)
  }
  const tail = delta.split(/\s{2,}/).filter(Boolean).slice(-3)
  if (tail.length > 0) console.log(`  fragment ekranu:          ${tail.join(' | ').slice(0, 220)}`)
  console.log()

  try {
    child.kill()
  } catch {
    /* proces mógł już zniknąć */
  }
  await delay(500)

  return { strategy, hasMarker, hasPath }
}

function clean(text) {
  return text.replace(CSI_PATTERN, '').replace(OSC_PATTERN, '')
}

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await delay(250)
  }
  return false
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/** Bez tego potomny `claude` dziedziczy markery sesji-rodzica i zmienia zachowanie. */
function cleanEnv() {
  const env = { ...process.env, TERM: 'xterm-256color', COLORTERM: 'truecolor' }
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
  return env
}
