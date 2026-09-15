/**
 * Transkrypcja mowy przez lokalny whisper.cpp.
 *
 * Renderer nagrywa gotowy WAV 16 kHz mono (patrz `renderer/features/voice/recorder.ts`),
 * więc nie potrzebujemy ffmpeg ani żadnej konwersji — plik idzie prosto do whisper.cpp.
 *
 * Warstwa jest wąska celowo (§8 planu): gdyby doszedł inny silnik, wystarczy dopisać
 * drugą implementację `SpeechToTextProvider`.
 */
import { execFile } from 'node:child_process'
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { app } from 'electron'
import type { WhisperLanguage } from '@shared/i18n'
import { tMain } from '@main/i18n'

const execFileAsync = promisify(execFile)

/** Nagranie promptu rzadko przekracza minutę; dłuższe przetwarzanie oznacza kłopot. */
const TRANSCRIBE_TIMEOUT_MS = 180_000

export interface TranscribeOptions {
  executablePath: string
  modelPath: string
  language: WhisperLanguage
  threads: number
}

export interface SpeechToTextProvider {
  transcribe(wav: Uint8Array, options: TranscribeOptions): Promise<string>
}

export class WhisperCppProvider implements SpeechToTextProvider {
  /**
   * @param wav zawartość pliku WAV 16 kHz mono
   * @throws gdy silnik lub model nie istnieje, albo proces zwróci błąd
   */
  async transcribe(wav: Uint8Array, options: TranscribeOptions): Promise<string> {
    if (!existsSync(options.executablePath)) {
      throw new Error(tMain('err.whisperMissing', { path: options.executablePath }))
    }
    if (!existsSync(options.modelPath)) {
      throw new Error(tMain('err.modelMissing', { path: options.modelPath }))
    }

    const workspace = join(app.getPath('userData'), 'cache', 'speech')
    await mkdir(workspace, { recursive: true })

    const base = join(workspace, randomUUID())
    const wavPath = `${base}.wav`

    try {
      await writeFile(wavPath, wav)

      const args = [
        '-m', options.modelPath,
        '-f', wavPath,
        '-t', String(options.threads),
        // Flagę języka podajemy ZAWSZE, także dla trybu automatycznego.
        // Domyślną wartością whisper-cli jest `en`, nie `auto` — pominięcie `-l` sprawiało,
        // że silnik zakładał angielski i tłumaczył polską wypowiedź zamiast ją zapisać.
        '-l', options.language,
        // Świadomie NIE przekazujemy `-tr`: to przełącznik bez wartości, więc `-tr false`
        // włączyłoby tłumaczenie na angielski, a `false` trafiłoby na listę plików wejściowych.
        // Domyślnie tłumaczenie jest wyłączone i o to nam chodzi.
        '-oj',              // wynik do pliku JSON obok wejścia
        '-of', base,        // prefiks pliku wyjściowego
        '-np',              // bez pasków postępu na stdout
        '-nt',              // bez znaczników czasu w tekście
      ]

      const { stdout } = await execFileAsync(options.executablePath, args, {
        timeout: TRANSCRIBE_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
      })

      return (await readJsonTranscript(`${base}.json`)) ?? cleanPlainOutput(stdout)
    } catch (error) {
      const err = error as NodeJS.ErrnoException & { killed?: boolean; stderr?: string }
      if (err.killed === true) throw new Error(tMain('err.whisperTimeout'))
      throw new Error(tMain('err.whisperFailed', { detail: err.stderr?.trim() || err.message }))
    } finally {
      // Nagrania głosowe znikają od razu po transkrypcji — nie ma powodu ich przechowywać.
      await rm(wavPath, { force: true })
      await rm(`${base}.json`, { force: true })
    }
  }
}

/** whisper.cpp z `-oj` zapisuje transkrypcję jako listę segmentów. */
async function readJsonTranscript(path: string): Promise<string | null> {
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8')) as {
      transcription?: Array<{ text?: string }>
    }
    const text = (parsed.transcription ?? [])
      .map((segment) => segment.text ?? '')
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    return text === '' ? null : text
  } catch {
    return null // starsza wersja silnika albo inny układ pliku — spadamy do stdout
  }
}

/** Awaryjne wyciągnięcie tekstu ze standardowego wyjścia. */
function cleanPlainOutput(stdout: string): string {
  return stdout
    .split(/\r?\n/)
    // Linie ze znacznikami czasu w nawiasach kwadratowych to nagłówki segmentów.
    .map((line) => line.replace(/^\[[^\]]+\]\s*/, '').trim())
    .filter((line) => line !== '' && !line.startsWith('whisper_'))
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim()
}
