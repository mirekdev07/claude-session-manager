/**
 * Zbiera obrazy z trzech źródeł (schowek, drag & drop, wybór z dysku) i przekazuje je
 * do działającej sesji Claude Code.
 *
 * Warstwa istnieje po to, żeby sposób komunikacji z Claude Code (patrz `inject-strategies`)
 * dało się zmienić bez ruszania interfejsu (§12 planu).
 */
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import type { Attachment, InjectStrategy } from '@shared/types'
import type { ClaudeProcessManager } from '@main/claude/process-manager'
import { isSupportedImagePath, storeImage, SUPPORTED_EXTENSIONS } from './cache'
import { readClipboardImage } from './clipboard-service'
import { injectPrompt } from './inject-strategies'
import { tMain } from '@main/i18n'

export class ImageAttachmentProvider {
  /** Załączniki oczekujące na wysłanie, indeksowane po id. */
  private readonly pending = new Map<string, Attachment>()

  constructor(private readonly processes: ClaudeProcessManager) {}

  /** @throws gdy schowek nie zawiera obrazu albo obraz jest uszkodzony */
  async addFromClipboard(): Promise<Attachment> {
    const buffer = await readClipboardImage()
    if (buffer === null) throw new Error(tMain('images.noImageInClipboard'))
    return this.remember(await storeImage(buffer, 'clipboard.png', 'clipboard'))
  }

  /**
   * Dodaje obrazy wskazane ścieżkami — z Eksploratora, upuszczone na okno albo wybrane z dysku.
   *
   * Pliki nieobsługiwane są pomijane, a nie przerywają całej operacji: przy zaznaczeniu
   * kilkunastu plików jeden PDF nie powinien blokować pozostałych obrazów.
   */
  async addFromPaths(paths: string[], source: 'drop' | 'picker'): Promise<{
    attachments: Attachment[]
    skipped: string[]
  }> {
    const attachments: Attachment[] = []
    const skipped: string[] = []

    for (const path of paths) {
      if (!isSupportedImagePath(path)) {
        skipped.push(tMain('err.unsupportedFormat', { name: basename(path) }))
        continue
      }
      try {
        const buffer = await readFile(path)
        attachments.push(this.remember(await storeImage(buffer, basename(path), source)))
      } catch (error) {
        skipped.push(`${basename(path)} — ${messageOf(error)}`)
      }
    }

    return { attachments, skipped }
  }

  /** Obrazy upuszczone na okno docierają jako bajty, bo renderer nie ma dostępu do dysku. */
  async addFromBytes(fileName: string, bytes: Uint8Array): Promise<Attachment> {
    return this.remember(await storeImage(Buffer.from(bytes), fileName, 'drop'))
  }

  discard(attachmentId: string): void {
    // Plik zostaje w cache — sprząta go dopiero czyszczenie po czasie (§13 planu).
    this.pending.delete(attachmentId)
  }

  /**
   * Wysyła załączniki wraz z tekstem do wskazanego terminala.
   *
   * @throws gdy terminal nie istnieje albo któregoś obrazu nie da się odczytać
   */
  async send(params: {
    ptyId: string
    attachmentIds: string[]
    text: string
    strategy: InjectStrategy
    submit: boolean
  }): Promise<void> {
    const attachments = params.attachmentIds.map((id) => {
      const attachment = this.pending.get(id)
      if (!attachment) throw new Error(tMain('err.attachmentExpired'))
      return attachment
    })

    await injectPrompt({
      strategy: params.strategy,
      attachments,
      text: params.text,
      submit: params.submit,
      write: (data) => this.processes.write(params.ptyId, data),
    })

    for (const id of params.attachmentIds) this.pending.delete(id)
  }

  private remember(attachment: Attachment): Attachment {
    this.pending.set(attachment.id, attachment)
    return attachment
  }
}

/** Filtr okna wyboru plików. Nazwa jest w języku interfejsu, więc filtr budujemy przy każdym otwarciu. */
export function imageFileFilter(): { name: string; extensions: string[] } {
  return {
    name: tMain('dialog.images'),
    extensions: SUPPORTED_EXTENSIONS.map((extension) => extension.slice(1)),
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
