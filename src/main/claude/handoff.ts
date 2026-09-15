/**
 * „Nowa sesja z podsumowaniem" (Etap 11).
 *
 * Z transkryptu wyciągamy sam tekst rozmowy — prompty i odpowiedzi, bez wyników narzędzi —
 * i prosimy Claude Code w trybie `-p` o zwięzły handoff. Nowa sesja startuje z tym
 * podsumowaniem zamiast z 900k kontekstu.
 *
 * To jedyna funkcja aplikacji, która wywołuje model, a więc kosztuje limit. Dlatego działa
 * wyłącznie na żądanie, a interfejs pokazuje koszt przed uruchomieniem.
 */
import { spawn } from 'node:child_process'
import { mkdir } from 'node:fs/promises'
import { tMain } from '@main/i18n'
import { locateClaudeCli } from './locator'
import { readTranscriptIncrement } from './transcript-metrics'
import { discardProbeTranscripts, probeEnvironment, usageProbeDirectory } from './usage-provider'

const GENERATE_TIMEOUT_MS = 180_000

/** Ile znaków rozmowy podajemy modelowi. Więcej nie poprawia podsumowania, a wydłuża i drożeje. */
const EXCERPT_MAX_CHARS = 120_000

/**
 * @returns tekst podsumowania gotowy do wklejenia jako pierwszy prompt nowej sesji
 * @throws gdy CLI jest niedostępne, transkrypt pusty albo generowanie zawiedzie
 */
export async function generateHandoff(transcriptPath: string): Promise<string> {
  const cli = await locateClaudeCli()
  if (!cli.ok) throw new Error(tMain('err.claudeUnavailable', { detail: cli.detail }))

  const increment = await readTranscriptIncrement(transcriptPath, 0)
  const excerpt = buildExcerpt(increment.searchRows)
  if (excerpt === '') throw new Error(tMain('handoff.errEmpty'))

  const cwd = usageProbeDirectory()
  await mkdir(cwd, { recursive: true })

  try {
    return await runClaude(cli.executablePath, cwd, excerpt)
  } finally {
    await discardProbeTranscripts()
  }
}

/**
 * Zachowujemy pierwszy prompt (cel pracy) i możliwie długi ogon rozmowy — to, co najnowsze,
 * jest dla kontynuacji najważniejsze.
 */
function buildExcerpt(rows: Array<{ role: 'user' | 'assistant'; text: string }>): string {
  const roleUser = tMain('handoff.roleUser')
  const roleClaude = tMain('handoff.roleClaude')
  const lines = rows.map((row) => `${row.role === 'user' ? roleUser : roleClaude}: ${row.text}`)
  if (lines.length === 0) return ''

  const head = lines[0] ?? ''
  const tail: string[] = []
  let budget = EXCERPT_MAX_CHARS - head.length

  for (let index = lines.length - 1; index >= 1; index--) {
    const line = lines[index] ?? ''
    if (line.length > budget) break
    tail.unshift(line)
    budget -= line.length + 2
  }

  const omitted = lines.length - 1 - tail.length
  const gap = omitted > 0 ? `\n\n${tMain('handoff.omitted', { count: omitted })}\n\n` : '\n\n'
  return `${head}${gap}${tail.join('\n\n')}`
}

function runClaude(executable: string, cwd: string, stdin: string): Promise<string> {
  return new Promise((resolve, reject) => {
    // Instrukcja jest w języku interfejsu i każe pisać w tym samym języku — podsumowanie
    // ma brzmieć tak, jak użytkownik pracuje, a nie tak, jak brzmiała rozmowa.
    const child = spawn(executable, ['-p', tMain('handoff.instruction')], {
      cwd,
      env: probeEnvironment(),
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => {
      child.kill()
      reject(new Error(tMain('handoff.errTimeout')))
    }, GENERATE_TIMEOUT_MS)

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      stderr += chunk
    })
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = stdout.trim()
      if (code !== 0 && text === '') {
        reject(
          new Error(
            tMain('handoff.errExit', { code: String(code), stderr: stderr.trim().slice(0, 300) })
          )
        )
        return
      }
      if (text === '') {
        reject(new Error(tMain('handoff.errNoOutput')))
        return
      }
      resolve(text)
    })

    child.stdin.on('error', () => {
      /* proces mógł zamknąć wejście wcześniej — wynik i tak przyjdzie na stdout */
    })
    child.stdin.end(stdin)
  })
}
