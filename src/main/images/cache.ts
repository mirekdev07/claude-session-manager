/**
 * Cache obrazów przygotowanych do wysłania.
 *
 * Pliki lądują w katalogu danych aplikacji, nigdy w katalogu projektu (§13 planu) —
 * zrzuty ekranu nie mają zaśmiecać repozytoriów użytkownika.
 *
 * Plik musi przeżyć wysłanie promptu: Claude Code odczytuje obraz dopiero w trakcie
 * przetwarzania, więc kasowanie zaraz po wysłaniu prowadziłoby do wyścigu. Sprzątamy
 * dopiero przy starcie aplikacji i tylko pliki starsze niż `maxAgeHours`.
 */
import { randomUUID } from 'node:crypto'
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app, nativeImage } from 'electron'
import type { Attachment, AttachmentSource } from '@shared/types'
import { tMain } from '@main/i18n'

/** Powyżej tego rozmiaru miniatura idzie w megabajty i niepotrzebnie obciąża IPC. */
const THUMBNAIL_MAX_PX = 220

/** Claude Code i tak przeskaluje bardzo duże obrazy; my ograniczamy je wcześniej. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024

export const SUPPORTED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'] as const

export function isSupportedImagePath(path: string): boolean {
  const lower = path.toLowerCase()
  return SUPPORTED_EXTENSIONS.some((extension) => lower.endsWith(extension))
}

export function imageCacheDirectory(): string {
  return join(app.getPath('userData'), 'cache', 'images')
}

/**
 * Zapisuje obraz w cache i buduje jego opis dla interfejsu.
 *
 * @param buffer surowe bajty obrazu
 * @param originalName nazwa źródłowa; użyta do rozszerzenia i etykiety w UI
 * @throws gdy dane nie dają się odczytać jako obraz albo przekraczają limit rozmiaru
 */
export async function storeImage(
  buffer: Buffer,
  originalName: string,
  source: AttachmentSource
): Promise<Attachment> {
  if (buffer.byteLength === 0) throw new Error(tMain('err.emptyImage'))
  if (buffer.byteLength > MAX_IMAGE_BYTES) {
    throw new Error(
      tMain('err.imageTooLarge', {
        size: formatMegabytes(buffer.byteLength),
        limit: formatMegabytes(MAX_IMAGE_BYTES),
      })
    )
  }

  const image = nativeImage.createFromBuffer(buffer)
  if (image.isEmpty()) throw new Error(tMain('err.imageCorrupt'))

  const directory = imageCacheDirectory()
  await mkdir(directory, { recursive: true })

  const id = randomUUID()
  // Znacznik czasu w nazwie ułatwia ręczne sprzątanie i debugowanie cache.
  const fileName = `${timestampSlug()}_${id.slice(0, 4)}${extensionFor(originalName)}`
  const filePath = join(directory, fileName)
  await writeFile(filePath, buffer)

  const size = image.getSize()

  return {
    id,
    fileName: originalName || fileName,
    filePath,
    sizeBytes: buffer.byteLength,
    width: size.width,
    height: size.height,
    thumbnailDataUrl: buildThumbnail(image),
    source,
  }
}

/** Usuwa z cache pliki starsze niż podany wiek. Wołane przy starcie aplikacji. */
export async function cleanupOldImages(maxAgeHours: number): Promise<number> {
  const directory = imageCacheDirectory()
  const cutoff = Date.now() - maxAgeHours * 60 * 60 * 1000

  let entries: string[]
  try {
    entries = await readdir(directory)
  } catch {
    return 0 // katalog jeszcze nie istnieje
  }

  let removed = 0
  for (const entry of entries) {
    const path = join(directory, entry)
    try {
      if ((await stat(path)).mtimeMs >= cutoff) continue
      await unlink(path)
      removed++
    } catch {
      // Plik używany przez inny proces albo już usunięty — nie przerywamy sprzątania.
    }
  }
  return removed
}

/** Miniatura zmniejszona tak, by dłuższy bok nie przekraczał `THUMBNAIL_MAX_PX`. */
function buildThumbnail(image: Electron.NativeImage): string {
  const { width, height } = image.getSize()
  const longest = Math.max(width, height)

  const thumbnail =
    longest > THUMBNAIL_MAX_PX
      ? image.resize(
          width >= height
            ? { width: THUMBNAIL_MAX_PX, quality: 'good' }
            : { height: THUMBNAIL_MAX_PX, quality: 'good' }
        )
      : image

  return thumbnail.toDataURL()
}

function extensionFor(originalName: string): string {
  const lower = originalName.toLowerCase()
  const match = SUPPORTED_EXTENSIONS.find((extension) => lower.endsWith(extension))
  // Obrazy ze schowka nie mają nazwy pliku; Electron zwraca je jako PNG.
  return match ?? '.png'
}

function timestampSlug(): string {
  const now = new Date()
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}` +
    `_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
  )
}

function formatMegabytes(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}
