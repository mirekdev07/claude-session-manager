/**
 * Pobieranie modeli Whispera na żądanie.
 *
 * Model `large-v3-turbo` waży około 1,6 GB — dokładanie go do instalatora byłoby absurdem,
 * a większość użytkowników i tak wybierze inny rozmiar. Pobieramy więc dopiero wtedy,
 * gdy użytkownik świadomie o to poprosi, z paskiem postępu i możliwością przerwania.
 *
 * Pobieramy wyłącznie **dane** (plik modelu). Pliku wykonywalnego silnika aplikacja
 * nie ściąga sama — użytkownik wskazuje go w Ustawieniach.
 */
import { createWriteStream } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { app } from 'electron'
import type { MessageKey } from '@shared/i18n'
import { tMain } from '@main/i18n'

/** Oficjalne repozytorium modeli ggml prowadzone przez autora whisper.cpp. */
const MODEL_BASE_URL = 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main'

/** Etykiety są kluczami tłumaczeń — nazwę w języku interfejsu nadaje handler `speech:status`. */
export const WHISPER_MODELS = [
  { id: 'tiny', labelKey: 'whisper.tiny', approximateMB: 75 },
  { id: 'base', labelKey: 'whisper.base', approximateMB: 142 },
  { id: 'small', labelKey: 'whisper.small', approximateMB: 466 },
  { id: 'medium', labelKey: 'whisper.medium', approximateMB: 1500 },
  { id: 'large-v3-turbo', labelKey: 'whisper.large', approximateMB: 1560 },
] as const satisfies ReadonlyArray<{ id: string; labelKey: MessageKey; approximateMB: number }>

export type WhisperModelId = (typeof WHISPER_MODELS)[number]['id']

export interface DownloadProgress {
  modelId: WhisperModelId
  receivedBytes: number
  totalBytes: number | null
}

export function modelsDirectory(): string {
  return join(app.getPath('userData'), 'models')
}

export function modelPathFor(modelId: WhisperModelId): string {
  return join(modelsDirectory(), `ggml-${modelId}.bin`)
}

export async function isModelDownloaded(modelId: WhisperModelId): Promise<boolean> {
  try {
    return (await stat(modelPathFor(modelId))).size > 0
  } catch {
    return false
  }
}

/**
 * Pobiera model i zwraca ścieżkę gotowego pliku.
 *
 * Zapis idzie do pliku tymczasowego i dopiero po pełnym pobraniu jest przenoszony pod
 * docelową nazwę — przerwane pobieranie nie zostawia po sobie uszkodzonego modelu,
 * który przy następnym uruchomieniu wyglądałby na gotowy.
 *
 * @throws gdy pobieranie zawiedzie albo zostanie przerwane
 */
export async function downloadModel(
  modelId: WhisperModelId,
  onProgress: (progress: DownloadProgress) => void,
  signal?: AbortSignal
): Promise<string> {
  const directory = modelsDirectory()
  await mkdir(directory, { recursive: true })

  const target = modelPathFor(modelId)
  const temporary = `${target}.part`

  const response = await fetch(`${MODEL_BASE_URL}/ggml-${modelId}.bin`, { signal })
  if (!response.ok || !response.body) {
    throw new Error(tMain('err.modelDownload', { status: response.status }))
  }

  const header = response.headers.get('content-length')
  const totalBytes = header === null ? null : Number(header)

  let receivedBytes = 0
  const source = Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0])
  source.on('data', (chunk: Buffer) => {
    receivedBytes += chunk.byteLength
    onProgress({ modelId, receivedBytes, totalBytes })
  })

  try {
    await pipeline(source, createWriteStream(temporary), { signal })
    await rename(temporary, target)
    return target
  } catch (error) {
    await rm(temporary, { force: true })
    throw error instanceof Error && error.name === 'AbortError'
      ? new Error(tMain('err.downloadCancelled'))
      : error
  }
}
