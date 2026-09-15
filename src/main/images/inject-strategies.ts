/**
 * Przekazanie obrazu do działającej sesji Claude Code.
 *
 * Kluczowa zasada projektu: nie budujemy własnego kanału do modelu (§12 planu).
 * Claude Code obsługuje obrazy natywnie — zapisuje je do `~/.claude/image-cache/<sessionId>/N.png`
 * i wstawia do promptu placeholder `[Image #N]`. Naszym zadaniem jest ten mechanizm
 * **wyzwolić**, a nie zastąpić.
 *
 * Trzy strategie w kolejności preferencji, ustalonej pomiarem (`npm run verify:inject`):
 *
 *   bracketed-path   DOMYŚLNA. Ścieżka pliku wysłana w trybie bracketed paste, jak przy
 *                    upuszczeniu pliku na okno terminala. Zmierzone: TUI odpowiada
 *                    znacznikiem `[Image #1]`, czyli tworzy natywny załącznik obrazowy.
 *                    Nie dotyka systemowego schowka.
 *   clipboard-paste  Obraz ląduje w systemowym schowku, do PTY idzie bajt Ctrl+V (0x16).
 *                    Wariant zapasowy: nadpisuje schowek użytkownika i zależy od
 *                    przebudowanego w Electronie 44 API schowka.
 *   plain-path       Ścieżka jako zwykły tekst promptu. Zmierzone: obraz NIE staje się
 *                    załącznikiem — Claude odczyta go narzędziem Read, kosztem dodatkowej tury.
 *                    Ostatnia deska ratunku.
 */
import { clipboard, nativeImage } from 'electron'
import { readFile } from 'node:fs/promises'
import type { Attachment, InjectStrategy } from '@shared/types'
import { writeClipboardImage } from './clipboard-service'
import { tMain } from '@main/i18n'

const ESC = '\x1b'
const CTRL_V = '\x16'
const CARRIAGE_RETURN = '\r'

/** TUI potrzebuje chwili na przetworzenie wklejenia, zanim przyjmie kolejne. */
const DELAY_AFTER_IMAGE_MS = 350
const DELAY_BEFORE_TEXT_MS = 150

export interface InjectOptions {
  strategy: InjectStrategy
  attachments: Attachment[]
  text: string
  /** Czy nacisnąć Enter po wpisaniu promptu. */
  submit: boolean
  /** Zapis do PTY. Wstrzykiwane, żeby strategie dały się testować bez procesu. */
  write: (data: string) => void
}

/**
 * Wysyła załączniki i tekst do sesji.
 *
 * Kolejność jest istotna: najpierw obrazy (każdy staje się `[Image #N]`), potem treść
 * promptu, na końcu Enter. Odwrotna kolejność rozbiłaby prompt na dwie wiadomości.
 */
export async function injectPrompt(options: InjectOptions): Promise<void> {
  const { strategy, attachments, text, submit, write } = options

  // Strategia schowkowa nadpisuje jego zawartość; przywracamy tekst, żeby nie zaskoczyć użytkownika.
  const savedText =
    strategy === 'clipboard-paste' ? await clipboard.readText().catch(() => '') : null

  try {
    for (const attachment of attachments) {
      await injectOne(strategy, attachment, write)
      await delay(DELAY_AFTER_IMAGE_MS)
    }

    if (text !== '') {
      if (attachments.length > 0) await delay(DELAY_BEFORE_TEXT_MS)
      write(bracketedPaste(text))
    }

    if (submit && (text !== '' || attachments.length > 0)) {
      await delay(DELAY_BEFORE_TEXT_MS)
      write(CARRIAGE_RETURN)
    }
  } finally {
    if (savedText !== null && savedText !== '') await clipboard.writeText(savedText)
  }
}

async function injectOne(
  strategy: InjectStrategy,
  attachment: Attachment,
  write: (data: string) => void
): Promise<void> {
  switch (strategy) {
    case 'clipboard-paste': {
      const buffer = await readFile(attachment.filePath)
      const png = toPng(buffer, attachment.fileName)

      await writeClipboardImage(png)
      // Odstęp daje systemowi czas na udostępnienie zawartości schowka innym procesom.
      await delay(80)
      write(CTRL_V)
      return
    }

    case 'bracketed-path':
      write(bracketedPaste(attachment.filePath))
      return

    case 'plain-path':
      // Cudzysłowy chronią ścieżki ze spacjami, których na Windows jest większość.
      write(`"${attachment.filePath}" `)
      return
  }
}

/**
 * Otacza tekst sekwencjami bracketed paste.
 *
 * Bez nich aplikacja terminalowa potraktowałaby wieloliniowy tekst jak serię naciśnięć
 * Enter i wysłała prompt po pierwszej linii.
 */
export function bracketedPaste(text: string): string {
  return `${ESC}[200~${text}${ESC}[201~`
}

/**
 * Schowek przyjmuje wyłącznie PNG, a użytkownik może dołączyć JPG, WEBP czy BMP.
 * `nativeImage` dekoduje wszystkie obsługiwane formaty i pozwala je przekodować.
 */
function toPng(buffer: Buffer, fileName: string): Buffer {
  if (fileName.toLowerCase().endsWith('.png')) return buffer

  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) throw new Error(tMain('err.imageRead', { name: fileName }))
  return image.toPNG()
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
