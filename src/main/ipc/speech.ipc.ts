/** Handlery IPC transkrypcji mowy i pobierania modeli. */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { IPC, PUSH } from '@shared/ipc-contract'
import type { SpeechStatus } from '@shared/types'
import {
  downloadModel,
  isModelDownloaded,
  modelPathFor,
  WHISPER_MODELS,
  type WhisperModelId,
} from '@main/speech/model-downloader'
import { WhisperCppProvider } from '@main/speech/whisper-cpp'
import type { SettingsService } from '@main/storage/settings'
import { tMain } from '@main/i18n'

const modelIdSchema = z.enum(
  WHISPER_MODELS.map((model) => model.id) as [WhisperModelId, ...WhisperModelId[]]
)

const transcribeSchema = z.object({
  /** Zawartość pliku WAV 16 kHz mono przygotowana przez renderer. */
  wav: z.instanceof(Uint8Array),
})

export function registerSpeechIpc(
  settings: SettingsService,
  getWindow: () => BrowserWindow | null
): void {
  const provider = new WhisperCppProvider()
  let download: AbortController | null = null

  const send = (channel: string, payload: unknown): void => {
    const window = getWindow()
    if (window && !window.isDestroyed()) window.webContents.send(channel, payload)
  }

  ipcMain.handle(IPC.speech.status, async (): Promise<SpeechStatus> => {
    const current = settings.get()
    return {
      executablePath: current.whisperExecutablePath,
      modelPath: current.whisperModelPath,
      language: current.whisperLanguage,
      models: await Promise.all(
        WHISPER_MODELS.map(async (model) => ({
          id: model.id,
          label: tMain(model.labelKey),
          approximateMB: model.approximateMB,
          downloaded: await isModelDownloaded(model.id),
          path: modelPathFor(model.id),
        }))
      ),
    }
  })

  ipcMain.handle(IPC.speech.pickExecutable, async (): Promise<string | null> => {
    const window = getWindow()
    const options: Electron.OpenDialogOptions = {
      title: tMain('dialog.pickWhisper'),
      properties: ['openFile'],
      filters: [{ name: tMain('dialog.executable'), extensions: ['exe'] }],
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || !result.filePaths[0]) return null

    settings.update({ whisperExecutablePath: result.filePaths[0] })
    return result.filePaths[0]
  })

  ipcMain.handle(IPC.speech.downloadModel, async (_event, raw: unknown): Promise<string> => {
    const modelId = modelIdSchema.parse(raw)

    // Drugie pobieranie w tle deptałoby po pliku tymczasowym pierwszego.
    download?.abort()
    download = new AbortController()

    try {
      const path = await downloadModel(
        modelId,
        (progress) => send(PUSH.speechProgress, progress),
        download.signal
      )
      settings.update({ whisperModelPath: path })
      return path
    } finally {
      download = null
    }
  })

  ipcMain.handle(IPC.speech.cancelDownload, (): void => {
    download?.abort()
  })

  ipcMain.handle(IPC.speech.transcribe, async (_event, raw: unknown): Promise<string> => {
    const { wav } = transcribeSchema.parse(raw)
    const current = settings.get()

    if (current.whisperExecutablePath === null || current.whisperModelPath === null) {
      throw new Error(tMain('err.speechNotConfigured'))
    }

    return provider.transcribe(wav, {
      executablePath: current.whisperExecutablePath,
      modelPath: current.whisperModelPath,
      language: current.whisperLanguage,
      threads: current.whisperThreads,
    })
  })
}
