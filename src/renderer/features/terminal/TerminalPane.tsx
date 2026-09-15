import { useRef, useState } from 'react'
import { ImageDown } from 'lucide-react'
import { ComposeBar } from './ComposeBar'
import { TerminalContextMenu } from './TerminalContextMenu'
import { XtermView, type TerminalHandle } from './XtermView'
import { RecordingOverlay } from '@renderer/features/voice/RecordingOverlay'
import { useAttachmentStore } from '@renderer/store/attachment-store'
import { useAppStore } from '@renderer/store/app-store'
import { useT } from '@renderer/store/i18n-store'
import { useTerminalStore, type TerminalTab } from '@renderer/store/terminal-store'

export interface TerminalPaneProps {
  tab: TerminalTab
}

/**
 * Wyciąga obrazy ze zdarzenia wklejenia.
 *
 * Zrzut ekranu z Narzędzia Wycinania trafia do `files`, ale nie każde źródło je wypełnia —
 * niektóre wystawiają obraz wyłącznie przez `items`. Sprawdzamy oba i odsiewamy duplikaty
 * po nazwie i rozmiarze, bo ten sam obraz bywa widoczny w obu kolekcjach.
 */
function collectImages(data: DataTransfer): File[] {
  const found = new Map<string, File>()

  for (const file of Array.from(data.files)) {
    if (file.type.startsWith('image/')) found.set(`${file.name}:${file.size}`, file)
  }

  for (const item of Array.from(data.items)) {
    if (item.kind !== 'file' || !item.type.startsWith('image/')) continue
    const file = item.getAsFile()
    if (file) found.set(`${file.name}:${file.size}`, file)
  }

  return [...found.values()]
}

/**
 * Jedna zakładka: terminal plus warstwa aplikacji pod nim.
 *
 * Obrazy przechwytujemy zdarzeniem `paste` w fazie przechwytywania, zanim dotrze ono
 * do ukrytego pola tekstowego xterma. `clipboardData` jest dostępne synchronicznie,
 * więc decyzję „to obraz, nie przepuszczaj dalej" podejmujemy natychmiast — bez tego
 * terminal zdążyłby wkleić towarzyszący obrazowi tekst (§16 planu).
 */
export function TerminalPane({ tab }: TerminalPaneProps): React.JSX.Element {
  const t = useT()
  const [isDragOver, setIsDragOver] = useState(false)
  const [menuAt, setMenuAt] = useState<{ x: number; y: number } | null>(null)

  // Uchwyt do terminala żyje poza stanem — jego pojawienie się nie musi przerysowywać panelu.
  const terminalRef = useRef<TerminalHandle | null>(null)

  const setInfo = useTerminalStore((state) => state.setInfo)
  const setStatus = useTerminalStore((state) => state.setStatus)
  const setExit = useTerminalStore((state) => state.setExit)
  const setError = useTerminalStore((state) => state.setError)
  const addFromFiles = useAttachmentStore((state) => state.addFromFiles)
  const appearance = useAppStore((state) => state.appearance)

  const handlePaste = (event: React.ClipboardEvent): void => {
    const images = collectImages(event.clipboardData)
    if (images.length === 0) return // sam tekst — niech xterm wklei go normalnie

    // Zatrzymujemy zdarzenie, zanim dotrze do wbudowanego w xterm handlera wklejania,
    // inaczej do terminala trafiłby jeszcze tekst towarzyszący obrazowi (§16 planu).
    event.preventDefault()
    event.stopPropagation()
    void addFromFiles(tab.id, images)
  }

  const handleDrop = (event: React.DragEvent): void => {
    event.preventDefault()
    setIsDragOver(false)

    const files = Array.from(event.dataTransfer.files)
    if (files.length > 0) void addFromFiles(tab.id, files)
  }

  return (
    <div
      className="relative flex h-full flex-col"
      onPasteCapture={handlePaste}
      onDragOver={(event) => {
        // Bez tego Electron przejąłby upuszczony plik i przeszedł pod jego adres.
        event.preventDefault()
        setIsDragOver(true)
      }}
      onDragLeave={(event) => {
        // Zdarzenie leci też przy przejściu nad dziecko — reagujemy dopiero na wyjście poza panel.
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setIsDragOver(false)
        }
      }}
      onDrop={handleDrop}
      onContextMenu={(event) => {
        event.preventDefault()
        if (terminalRef.current) setMenuAt({ x: event.clientX, y: event.clientY })
      }}
    >
      <div className="min-h-0 flex-1">
        <XtermView
          cwd={tab.projectPath}
          mode={tab.mode}
          sessionId={tab.sessionId}
          fontSize={appearance.fontSize}
          fontFamily={appearance.fontFamily}
          onInfo={(info) => setInfo(tab.id, info)}
          onStatus={(status) => setStatus(tab.id, status)}
          onExit={(event) => setExit(tab.id, event)}
          onError={(message) => setError(tab.id, message)}
          onReady={(handle) => {
            terminalRef.current = handle
          }}
        />
      </div>

      <ComposeBar
        tabId={tab.id}
        ptyId={tab.info?.ptyId ?? null}
        projectPath={tab.projectPath}
        status={tab.status}
        focusTerminal={() => terminalRef.current?.focus()}
      />

      <RecordingOverlay />

      {menuAt !== null && terminalRef.current !== null && (
        <TerminalContextMenu
          x={menuAt.x}
          y={menuAt.y}
          handle={terminalRef.current}
          onClose={() => setMenuAt(null)}
        />
      )}

      {isDragOver && (
        <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center border-2 border-dashed border-app-accent bg-app-bg/75">
          <div className="flex items-center gap-2 text-[13px] text-app-accent">
            <ImageDown size={18} />
            {t('terminal.dropHint')}
          </div>
        </div>
      )}
    </div>
  )
}
