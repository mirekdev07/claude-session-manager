/**
 * Rozpoznaje zawartość schowka, żeby Ctrl+V zachował się zgodnie z intencją (§16 planu).
 *
 * Electron 44 zastąpił dawne synchroniczne `readImage`/`readBuffer` interfejsem
 * wzorowanym na W3C: `clipboard.read()` zwraca listę `ClipboardItem`, każdy z listą
 * typów MIME i asynchronicznym `getType()`. Cała warstwa jest więc asynchroniczna.
 *
 * Kolejność rozpoznawania ma znaczenie: obraz wygrywa z tekstem, bo przy zrzucie ekranu
 * z Windows w schowku bywa dodatkowo pusty albo bezużyteczny tekst. Zwykłe wklejanie
 * tekstu do terminala musi pozostać nietknięte.
 */
import { existsSync } from 'node:fs'
import { clipboard } from 'electron'
import type { ClipboardContent } from '@shared/types'
import { isSupportedImagePath } from './cache'

/** Typ MIME, o który prosimy przy odczycie obrazu; Windows zawsze udostępnia PNG. */
const PREFERRED_IMAGE_TYPE = 'image/png'

export async function readClipboard(): Promise<ClipboardContent> {
  const items = await safeRead()

  if (items.some(hasImageType)) return { kind: 'image' }

  const paths = await readFilePaths(items)
  if (paths.length > 0) {
    return { kind: 'files', paths, imagePaths: paths.filter(isSupportedImagePath) }
  }

  const text = await clipboard.readText().catch(() => '')
  return text === '' ? { kind: 'empty' } : { kind: 'text', text }
}

/** Surowe bajty obrazu ze schowka. `null`, gdy schowek nie zawiera obrazu. */
export async function readClipboardImage(): Promise<Buffer | null> {
  const items = await safeRead()
  const item = items.find(hasImageType)
  if (!item) return null

  const type = item.types.find((candidate) => candidate === PREFERRED_IMAGE_TYPE) ??
    item.types.find((candidate) => candidate.startsWith('image/'))
  if (type === undefined) return null

  try {
    const blob = await item.getType(type)
    // `getType` deklaruje też zakładkę Electrona; dla typów obrazowych zawsze dostajemy Blob.
    if (!(blob instanceof Blob)) return null
    return Buffer.from(await blob.arrayBuffer())
  } catch {
    return null // zawartość schowka zmieniła się między odczytami
  }
}

/** Umieszcza obraz w systemowym schowku — potrzebne strategii `clipboard-paste`. */
export async function writeClipboardImage(png: Buffer): Promise<void> {
  const { ClipboardItem } = await import('electron')
  const blob = new Blob([new Uint8Array(png)], { type: PREFERRED_IMAGE_TYPE })
  await clipboard.write([new ClipboardItem({ [PREFERRED_IMAGE_TYPE]: blob })])
}

function hasImageType(item: Electron.ClipboardItem): boolean {
  return item.types.some((type) => type.startsWith('image/'))
}

async function safeRead(): Promise<Electron.ClipboardItem[]> {
  try {
    return await clipboard.read()
  } catch {
    return [] // schowek zablokowany przez inną aplikację
  }
}

/**
 * Ścieżki plików skopiowanych w menedżerze plików.
 *
 * Preferujemy standardowy `text/uri-list`. Gdy go nie ma, sprawdzamy, czy tekst
 * w schowku sam jest ścieżką do istniejącego pliku — tak działa „Kopiuj jako ścieżkę"
 * w Eksploratorze Windows i wiele narzędzi zrzutów ekranu.
 */
async function readFilePaths(items: Electron.ClipboardItem[]): Promise<string[]> {
  const uriItem = items.find((item) => item.types.includes('text/uri-list'))
  if (uriItem) {
    try {
      const blob = await uriItem.getType('text/uri-list')
      if (blob instanceof Blob) {
        const parsed = parseUriList(await blob.text())
        if (parsed.length > 0) return parsed
      }
    } catch {
      // spadamy do heurystyki tekstowej poniżej
    }
  }

  const text = await clipboard.readText().catch(() => '')
  return parsePathLines(text)
}

function parseUriList(content: string): string[] {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== '' && !line.startsWith('#'))
    .map((line) => {
      if (!line.startsWith('file://')) return line
      try {
        return decodeURIComponent(new URL(line).pathname).replace(/^\/([A-Za-z]:)/, '$1')
      } catch {
        return line
      }
    })
    .filter((path) => existsSync(path))
}

function parsePathLines(text: string): string[] {
  if (text.trim() === '') return []

  const candidates = text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^"(.*)"$/, '$1'))
    .filter((line) => line !== '')

  // Wszystko musi być istniejącym plikiem — inaczej zwykły tekst zostałby uznany za listę plików.
  if (candidates.length === 0 || candidates.length > 50) return []
  return candidates.every((path) => existsSync(path)) ? candidates : []
}
