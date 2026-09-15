import { create } from 'zustand'
import type { Attachment } from '@shared/types'
import { tNow } from './i18n-store'

/**
 * Załączniki i tekst promptu — osobno dla każdej zakładki.
 *
 * Przełączenie zakładki nie może zabrać obrazów przygotowanych w innej sesji,
 * dlatego stan jest kluczowany po `tabId`, a nie globalny.
 */
interface TabDraft {
  attachments: Attachment[]
  text: string
}

interface AttachmentState {
  drafts: Record<string, TabDraft>
  previewAttachmentId: string | null
  busy: boolean
  notice: string | null

  draftFor: (tabId: string) => TabDraft
  setText: (tabId: string, text: string) => void
  appendText: (tabId: string, text: string) => void
  addFromClipboard: (tabId: string) => Promise<void>
  addFromFiles: (tabId: string, files: File[]) => Promise<void>
  addFromPicker: (tabId: string) => Promise<void>
  captureScreen: (tabId: string) => Promise<void>
  remove: (tabId: string, attachmentId: string) => Promise<void>
  clear: (tabId: string) => void
  send: (tabId: string, ptyId: string) => Promise<void>
  openPreview: (attachmentId: string | null) => void
  dismissNotice: () => void
}

const EMPTY_DRAFT: TabDraft = { attachments: [], text: '' }

export const useAttachmentStore = create<AttachmentState>((set, get) => ({
  drafts: {},
  previewAttachmentId: null,
  busy: false,
  notice: null,

  draftFor: (tabId) => get().drafts[tabId] ?? EMPTY_DRAFT,

  setText: (tabId, text) => set((state) => ({ drafts: patch(state.drafts, tabId, { text }) })),

  appendText: (tabId, text) =>
    set((state) => {
      const current = state.drafts[tabId] ?? EMPTY_DRAFT
      // Transkrypcja dopisuje się do tego, co już jest — nie kasuje wpisanego tekstu (§17 planu).
      const joined = current.text === '' ? text : `${current.text} ${text}`
      return { drafts: patch(state.drafts, tabId, { text: joined }) }
    }),

  addFromClipboard: async (tabId) => {
    await withBusy(set, async () => {
      const content = await window.api.images.readClipboard()

      if (content.kind === 'image') {
        addAttachments(set, tabId, [await window.api.images.addFromClipboard()])
        return
      }

      if (content.kind === 'files' && content.imagePaths.length > 0) {
        const result = await window.api.images.addFromPaths(content.imagePaths)
        addAttachments(set, tabId, result.attachments)
        if (result.skipped.length > 0) set({ notice: result.skipped.join('; ') })
        return
      }

      set({ notice: tNow('images.noImageInClipboard') })
    })
  },

  addFromFiles: async (tabId, files) => {
    await withBusy(set, async () => {
      const added: Attachment[] = []
      const skipped: string[] = []

      for (const file of files) {
        if (!file.type.startsWith('image/')) {
          skipped.push(tNow('images.notImage', { name: file.name }))
          continue
        }
        try {
          const bytes = new Uint8Array(await file.arrayBuffer())
          added.push(await window.api.images.addFromBytes(file.name, bytes))
        } catch (error) {
          skipped.push(`${file.name} — ${messageOf(error)}`)
        }
      }

      addAttachments(set, tabId, added)
      if (skipped.length > 0) set({ notice: skipped.join('; ') })
    })
  },

  addFromPicker: async (tabId) => {
    await withBusy(set, async () => {
      const result = await window.api.images.pick()
      addAttachments(set, tabId, result.attachments)
      if (result.skipped.length > 0) set({ notice: result.skipped.join('; ') })
    })
  },

  captureScreen: async (tabId) => {
    await withBusy(set, async () => {
      const attachment = await window.api.images.captureScreen()
      if (attachment !== null) addAttachments(set, tabId, [attachment])
    })
  },

  remove: async (tabId, attachmentId) => {
    await window.api.images.discard(attachmentId)
    set((state) => {
      const current = state.drafts[tabId] ?? EMPTY_DRAFT
      return {
        drafts: patch(state.drafts, tabId, {
          attachments: current.attachments.filter((item) => item.id !== attachmentId),
        }),
        previewAttachmentId:
          state.previewAttachmentId === attachmentId ? null : state.previewAttachmentId,
      }
    })
  },

  clear: (tabId) =>
    set((state) => ({ drafts: patch(state.drafts, tabId, { attachments: [], text: '' }) })),

  send: async (tabId, ptyId) => {
    const draft = get().draftFor(tabId)
    if (draft.attachments.length === 0 && draft.text.trim() === '') return

    await withBusy(set, async () => {
      await window.api.images.send({
        ptyId,
        attachmentIds: draft.attachments.map((attachment) => attachment.id),
        text: draft.text,
        submit: true,
      })
      set((state) => ({ drafts: patch(state.drafts, tabId, { attachments: [], text: '' }) }))
    })
  },

  openPreview: (previewAttachmentId) => set({ previewAttachmentId }),
  dismissNotice: () => set({ notice: null }),
}))

type SetState = (updater: (state: AttachmentState) => Partial<AttachmentState>) => void
type SetStatePlain = (partial: Partial<AttachmentState>) => void

function patch(
  drafts: Record<string, TabDraft>,
  tabId: string,
  changes: Partial<TabDraft>
): Record<string, TabDraft> {
  return { ...drafts, [tabId]: { ...(drafts[tabId] ?? EMPTY_DRAFT), ...changes } }
}

function addAttachments(set: SetState, tabId: string, added: Attachment[]): void {
  if (added.length === 0) return
  set((state) => {
    const current = state.drafts[tabId] ?? EMPTY_DRAFT
    return { drafts: patch(state.drafts, tabId, { attachments: [...current.attachments, ...added] }) }
  })
}

/** Blokuje równoległe operacje na plikach i zamienia wyjątek w komunikat dla użytkownika. */
async function withBusy(
  set: SetState & SetStatePlain,
  operation: () => Promise<void>
): Promise<void> {
  set({ busy: true, notice: null } as Partial<AttachmentState>)
  try {
    await operation()
  } catch (error) {
    set({ notice: messageOf(error) } as Partial<AttachmentState>)
  } finally {
    set({ busy: false } as Partial<AttachmentState>)
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
