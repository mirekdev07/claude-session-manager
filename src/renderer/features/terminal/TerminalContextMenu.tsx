import { useEffect } from 'react'
import { ClipboardPaste, Copy, Eraser, TextSelect } from 'lucide-react'
import { useT } from '@renderer/store/i18n-store'
import type { TerminalHandle } from './XtermView'

export interface TerminalContextMenuProps {
  x: number
  y: number
  handle: TerminalHandle
  onClose: () => void
}

/**
 * Menu pod prawym przyciskiem myszy.
 *
 * W terminalu `Ctrl+C` wysyła sygnał przerwania, więc kopiowanie musi mieć inną drogę.
 * Skróty `Ctrl+Shift+C` i `Ctrl+Insert` działają, ale bywają nieoczywiste — to menu
 * jest widoczną alternatywą, która sama pokazuje właściwe skróty.
 */
export function TerminalContextMenu({
  x,
  y,
  handle,
  onClose,
}: TerminalContextMenuProps): React.JSX.Element {
  const t = useT()

  useEffect(() => {
    const close = (): void => onClose()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    // `mousedown` zamyka menu także przy kliknięciu w terminal pod spodem.
    window.addEventListener('mousedown', close)
    window.addEventListener('resize', close)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('resize', close)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])

  const hasSelection = handle.hasSelection()

  const paste = async (): Promise<void> => {
    const content = await window.api.images.readClipboard()
    if (content.kind === 'text') handle.paste(content.text)
  }

  return (
    <div
      // Bez tego `mousedown` z nasłuchu wyżej zamknąłby menu, zanim zadziała kliknięcie.
      onMouseDown={(event) => event.stopPropagation()}
      style={{ left: x, top: y }}
      className="fixed z-50 min-w-[220px] overflow-hidden rounded-md border border-app-border bg-app-panel py-1 shadow-xl"
    >
      <Item
        icon={<Copy size={12} />}
        label={t('menu.copy')}
        shortcut="Ctrl+Shift+C"
        disabled={!hasSelection}
        onClick={() => {
          handle.copySelection()
          onClose()
        }}
      />
      <Item
        icon={<ClipboardPaste size={12} />}
        label={t('menu.paste')}
        shortcut="Ctrl+V"
        onClick={() => {
          void paste()
          onClose()
        }}
      />
      <div className="my-1 border-t border-app-border" />
      <Item
        icon={<TextSelect size={12} />}
        label={t('menu.selectAll')}
        shortcut="Ctrl+Shift+A"
        onClick={() => {
          handle.selectAll()
          onClose()
        }}
      />
      <Item
        icon={<Eraser size={12} />}
        label={t('menu.clearSelection')}
        disabled={!hasSelection}
        onClick={() => {
          handle.clearSelection()
          onClose()
        }}
      />
    </div>
  )
}

function Item({
  icon,
  label,
  shortcut,
  disabled,
  onClick,
}: {
  icon: React.ReactNode
  label: string
  shortcut?: string
  disabled?: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left text-[12px] hover:bg-app-panel-2 disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      <span className="shrink-0 text-app-muted">{icon}</span>
      <span className="flex-1">{label}</span>
      {shortcut !== undefined && (
        <span className="shrink-0 font-mono text-[10px] text-app-muted">{shortcut}</span>
      )}
    </button>
  )
}
