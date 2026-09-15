/**
 * Diagnostyka: czy TUI Claude Code włącza raportowanie myszy.
 *
 * Gdy aplikacja terminalowa włączy tryb `?1000h`/`?1002h`/`?1003h`, terminal przestaje
 * traktować przeciąganie myszą jako zaznaczanie tekstu i zaczyna wysyłać zdarzenia do programu.
 * To najczęstsza przyczyna „nie da się nic zaznaczyć ani skopiować".
 */
import { createRequire } from 'node:module'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { locateClaude } from './locate-claude.mjs'

const require = createRequire(import.meta.url)
const pty = require('node-pty')

const ESC = String.fromCharCode(27)

const MODES = [
  ['?1000', 'klikanie (X11 mouse)'],
  ['?1002', 'przeciąganie z wciśniętym przyciskiem'],
  ['?1003', 'każdy ruch myszy'],
  ['?1005', 'kodowanie UTF-8'],
  ['?1006', 'kodowanie SGR'],
  ['?1015', 'kodowanie urxvt'],
  ['?1049', 'alternatywny bufor ekranu'],
  ['?2004', 'bracketed paste'],
]

const claudePath = await locateClaude()
const workspace = mkdtempSync(join(tmpdir(), 'csm-mouse-'))

const env = { ...process.env, TERM: 'xterm-256color' }
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

const child = pty.spawn(claudePath, [], {
  name: 'xterm-256color',
  cols: 120,
  rows: 30,
  cwd: workspace,
  env,
  useConpty: true,
})

let buffer = ''
child.onData((chunk) => {
  buffer += chunk
})

const flat = () => buffer.replace(new RegExp(ESC + '\\[[0-9;?]*[a-zA-Z]', 'g'), '').replace(/\s+/g, '')

// Ekran zaufania pochłania input, więc najpierw go przechodzimy.
await waitFor(() => /Itrustthisfolder/i.test(flat()), 15000)
if (/Itrustthisfolder/i.test(flat())) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const mark = flat().length
    child.write(ESC + '[B')
    await waitFor(() => flat().length > mark, 1500)
    if (/❯Yes,Itrustthisfolder/.test(flat().slice(-160))) break
  }
  child.write('\r')
}

await waitFor(() => /forshortcuts|automodeon|bypasspermissions|Try"/i.test(flat()), 20000)
await new Promise((resolve) => setTimeout(resolve, 2500))

console.log('Tryby terminala włączone przez TUI Claude Code:\n')
for (const [mode, description] of MODES) {
  const enabled = buffer.includes(ESC + '[' + mode + 'h')
  const disabled = buffer.includes(ESC + '[' + mode + 'l')
  const state = enabled ? 'WŁĄCZONY' : disabled ? 'wyłączony' : '—'
  console.log(`  ${mode.padEnd(7)} ${state.padEnd(10)} ${description}`)
}

const anyMouse = ['?1000', '?1002', '?1003'].some((mode) => buffer.includes(ESC + '[' + mode + 'h'))
console.log(
  `\nWNIOSEK: raportowanie myszy ${anyMouse ? 'JEST włączone → przeciąganie nie zaznacza tekstu' : 'nie jest włączone → zaznaczanie myszą powinno działać'}`
)

try {
  child.kill()
} catch {
  /* proces mógł już zniknąć */
}
process.exit(0)

async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return false
}
