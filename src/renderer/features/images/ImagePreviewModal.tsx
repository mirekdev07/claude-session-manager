import { useEffect } from 'react'
import { X } from 'lucide-react'
import type { Attachment } from '@shared/types'
import { formatSize } from '@renderer/lib/format'

export interface ImagePreviewModalProps {
  attachment: Attachment
  onClose: () => void
}

/**
 * Powiększony podgląd załącznika.
 *
 * Pokazujemy tę samą miniaturę co w pasku, tylko rozciągniętą — renderer nie ma dostępu
 * do dysku, a przesyłanie pełnego obrazu przez IPC tylko po to, by go obejrzeć,
 * byłoby kosztowne przy plikach wielomegabajtowych.
 */
export function ImagePreviewModal({
  attachment,
  onClose,
}: ImagePreviewModalProps): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-8"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex max-h-full max-w-full flex-col overflow-hidden rounded-lg border border-app-border bg-app-panel"
      >
        <header className="flex items-center gap-3 border-b border-app-border px-3 py-2">
          <span className="truncate text-[12px]">{attachment.fileName}</span>
          <span className="shrink-0 text-[11px] text-app-muted">
            {attachment.width}×{attachment.height} · {formatSize(attachment.sizeBytes)}
          </span>
          <button onClick={onClose} className="ml-auto text-app-muted hover:text-app-text">
            <X size={15} />
          </button>
        </header>

        <div className="min-h-0 overflow-auto p-3">
          <img
            src={attachment.thumbnailDataUrl}
            alt={attachment.fileName}
            className="max-h-[70vh] object-contain"
            style={{ imageRendering: 'auto' }}
          />
        </div>

        <footer className="border-t border-app-border px-3 py-1.5 text-[10px] text-app-muted">
          <span className="font-mono">{attachment.filePath}</span>
        </footer>
      </div>
    </div>
  )
}
