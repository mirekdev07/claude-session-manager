/** Handlery IPC dla załączników obrazowych. */
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { z } from 'zod'
import { IPC } from '@shared/ipc-contract'
import type { Attachment, ClipboardContent } from '@shared/types'
import { imageFileFilter, type ImageAttachmentProvider } from '@main/images/attachment-provider'
import { tMain } from '@main/i18n'
import { readClipboard } from '@main/images/clipboard-service'
import { captureScreenRegion } from '@main/images/screen-capture'
import type { SettingsService } from '@main/storage/settings'

const attachmentIdSchema = z.string().uuid()

const addFromBytesSchema = z.object({
  fileName: z.string().min(1).max(260),
  bytes: z.instanceof(Uint8Array),
})

const addFromPathsSchema = z.array(z.string().min(1).max(4096)).max(50)

const sendSchema = z.object({
  ptyId: z.string().uuid(),
  attachmentIds: z.array(attachmentIdSchema).max(20),
  text: z.string().max(100_000),
  submit: z.boolean(),
})

export interface AddResult {
  attachments: Attachment[]
  skipped: string[]
}

export function registerImagesIpc(
  images: ImageAttachmentProvider,
  settings: SettingsService,
  getWindow: () => BrowserWindow | null
): void {
  ipcMain.handle(IPC.images.readClipboard, async (): Promise<ClipboardContent> => readClipboard())

  ipcMain.handle(IPC.images.addFromClipboard, async (): Promise<Attachment> =>
    images.addFromClipboard()
  )

  ipcMain.handle(IPC.images.addFromPaths, async (_event, raw: unknown): Promise<AddResult> =>
    images.addFromPaths(addFromPathsSchema.parse(raw), 'drop')
  )

  ipcMain.handle(IPC.images.addFromBytes, async (_event, raw: unknown): Promise<Attachment> => {
    const { fileName, bytes } = addFromBytesSchema.parse(raw)
    return images.addFromBytes(fileName, bytes)
  })

  ipcMain.handle(IPC.images.pick, async (): Promise<AddResult> => {
    const window = getWindow()
    const options: Electron.OpenDialogOptions = {
      title: tMain('dialog.pickImages'),
      properties: ['openFile', 'multiSelections'],
      filters: [imageFileFilter()],
    }
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options)

    if (result.canceled || result.filePaths.length === 0) return { attachments: [], skipped: [] }
    return images.addFromPaths(result.filePaths, 'picker')
  })

  ipcMain.handle(IPC.images.discard, (_event, raw: unknown): void => {
    images.discard(attachmentIdSchema.parse(raw))
  })

  ipcMain.handle(IPC.images.captureScreen, async (): Promise<Attachment | null> => {
    const png = await captureScreenRegion(getWindow())
    if (png === null) return null
    return images.addFromBytes('screenshot.png', new Uint8Array(png))
  })

  ipcMain.handle(IPC.images.send, async (_event, raw: unknown): Promise<void> => {
    const request = sendSchema.parse(raw)
    await images.send({ ...request, strategy: settings.get().imageInjectStrategy })
  })
}
