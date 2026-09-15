import { useEffect, useRef } from 'react'
import { Camera, ClipboardPaste, ImagePlus, Loader2, Mic, SendHorizontal } from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import type { PtyStatus } from '@shared/types'
import { AttachmentChip } from '@renderer/features/images/AttachmentChip'
import { shortenPath } from '@renderer/lib/format'
import { useAttachmentStore } from '@renderer/store/attachment-store'
import { useT } from '@renderer/store/i18n-store'
import { useVoiceStore } from '@renderer/store/voice-store'

const STATUS_KEY: Record<PtyStatus, MessageKey> = {
  running: 'compose.status.running',
  waiting: 'compose.status.waiting',
  closed: 'compose.status.closed',
  error: 'compose.status.error',
}

const STATUS_COLOR: Record<PtyStatus, string> = {
  running: 'bg-app-ok',
  waiting: 'bg-app-warn',
  closed: 'bg-app-muted',
  error: 'bg-app-error',
}

export interface ComposeBarProps {
  tabId: string
  ptyId: string | null
  projectPath: string
  status: PtyStatus
  /** Oddaje fokus terminalowi — po wysłaniu albo po Esc w polu tekstowym. */
  focusTerminal?: () => void
}

/**
 * Warstwa aplikacji nad dolną krawędzią terminala (§15 planu).
 *
 * Domyślnie to jedna cienka linia ze statusem — terminal zachowuje pełne skupienie
 * i całą przestrzeń. Pole tekstowe i miniatury rozwijają się dopiero, gdy pojawi się
 * załącznik albo transkrypcja głosowa. Po wysłaniu pasek zwija się z powrotem.
 */
export function ComposeBar({
  tabId,
  ptyId,
  projectPath,
  status,
  focusTerminal,
}: ComposeBarProps): React.JSX.Element {
  const t = useT()
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const draft = useAttachmentStore((state) => state.drafts[tabId]) ?? { attachments: [], text: '' }
  const busy = useAttachmentStore((state) => state.busy)
  const setText = useAttachmentStore((state) => state.setText)
  const addFromClipboard = useAttachmentStore((state) => state.addFromClipboard)
  const addFromPicker = useAttachmentStore((state) => state.addFromPicker)
  const captureScreen = useAttachmentStore((state) => state.captureScreen)
  const remove = useAttachmentStore((state) => state.remove)
  const send = useAttachmentStore((state) => state.send)
  const openPreview = useAttachmentStore((state) => state.openPreview)

  const voicePhase = useVoiceStore((state) => state.phase)
  const startVoice = useVoiceStore((state) => state.start)
  const stopVoice = useVoiceStore((state) => state.stopAndTranscribe)

  const attachmentCount = draft.attachments.length
  const isExpanded = attachmentCount > 0 || draft.text !== ''
  const canSend = ptyId !== null && (attachmentCount > 0 || draft.text.trim() !== '')

  /*
   * Obraz wklejony nad terminalem albo tekst z dyktowania rozwijają pasek — fokus przechodzi
   * do pola tekstowego, żeby dało się od razu dopisać treść i wysłać Enterem, bez klikania.
   * Zależność od liczby załączników: kolejny obraz też ma zostawić kursor w polu.
   */
  useEffect(() => {
    if (isExpanded) textareaRef.current?.focus()
  }, [isExpanded, attachmentCount])

  const submit = (): void => {
    if (!canSend || ptyId === null) return
    // Po wysłaniu pasek się zwija, a wejście wraca do terminala — tam toczy się rozmowa.
    void send(tabId, ptyId).then(() => focusTerminal?.())
  }

  return (
    <div className="shrink-0 border-t border-app-border bg-app-panel">
      {attachmentCount > 0 && (
        <div className="flex gap-2 overflow-x-auto border-b border-app-border px-2 py-2">
          {draft.attachments.map((attachment) => (
            <AttachmentChip
              key={attachment.id}
              attachment={attachment}
              onRemove={() => void remove(tabId, attachment.id)}
              onOpenPreview={() => openPreview(attachment.id)}
            />
          ))}
        </div>
      )}

      {isExpanded && (
        <div className="border-b border-app-border px-2 py-2">
          <textarea
            ref={textareaRef}
            value={draft.text}
            onChange={(event) => setText(tabId, event.target.value)}
            onKeyDown={(event) => {
              // Shift+Enter zostawiamy na łamanie linii, jak w każdym edytorze promptów.
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault()
                submit()
              }
              if (event.key === 'Escape') {
                textareaRef.current?.blur()
                focusTerminal?.()
              }
            }}
            rows={2}
            placeholder={t('compose.placeholder')}
            className="w-full resize-none rounded-md border border-app-border bg-app-panel-2 px-2 py-1.5 text-[12px] leading-snug outline-none placeholder:text-app-muted focus:border-app-accent-dim"
          />
        </div>
      )}

      <div className="flex items-center gap-2 px-2 py-1.5 text-[11px] text-app-muted">
        <button
          onClick={() => (voicePhase === 'recording' ? void stopVoice() : void startVoice(tabId))}
          disabled={voicePhase === 'transcribing'}
          title={t('compose.dictate')}
          className={`rounded p-1 hover:bg-app-panel-2 disabled:opacity-40 ${
            voicePhase === 'recording' ? 'bg-app-accent text-app-bg' : 'hover:text-app-text'
          }`}
        >
          <Mic size={13} />
        </button>

        <BarButton
          icon={<ImagePlus size={12} />}
          onClick={() => void addFromPicker(tabId)}
          disabled={busy}
        >
          {t('compose.addImage')}
        </BarButton>

        <BarButton
          icon={<ClipboardPaste size={12} />}
          onClick={() => void addFromClipboard(tabId)}
          disabled={busy}
          title={t('compose.pasteImageTitle')}
        >
          {t('compose.pasteImage')}
        </BarButton>

        <BarButton
          icon={<Camera size={12} />}
          onClick={() => void captureScreen(tabId)}
          disabled={busy}
          title={t('compose.screenshotTitle')}
        >
          {t('compose.screenshot')}
        </BarButton>

        {busy && <Loader2 size={12} className="animate-spin" />}

        <span className="ml-2 min-w-0 truncate font-mono" title={projectPath}>
          {shortenPath(projectPath, 34)}
        </span>

        <span className="ml-auto flex shrink-0 items-center gap-1.5">
          <span className={`size-[6px] rounded-full ${STATUS_COLOR[status]}`} />
          {t(STATUS_KEY[status])}
        </span>

        {isExpanded && (
          <button
            onClick={submit}
            disabled={!canSend || busy}
            title={t('compose.sendTitle')}
            className="flex shrink-0 items-center gap-1.5 rounded-md bg-app-accent px-2.5 py-1 text-[11px] font-medium text-app-bg hover:bg-app-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <SendHorizontal size={12} />
            {t('compose.send')}
          </button>
        )}
      </div>
    </div>
  )
}

function BarButton({
  icon,
  children,
  onClick,
  disabled,
  title,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  disabled?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className="flex items-center gap-1 rounded px-1.5 py-1 hover:bg-app-panel-2 hover:text-app-text disabled:cursor-not-allowed disabled:opacity-40"
    >
      {icon}
      {children}
    </button>
  )
}
