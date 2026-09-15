import { X } from 'lucide-react'
import type { Attachment } from '@shared/types'
import { formatSize } from '@renderer/lib/format'
import { useT } from '@renderer/store/i18n-store'

export interface AttachmentChipProps {
  attachment: Attachment
  onRemove: () => void
  onOpenPreview: () => void
}

/** Miniatura obrazu oczekującego na wysłanie. */
export function AttachmentChip({
  attachment,
  onRemove,
  onOpenPreview,
}: AttachmentChipProps): React.JSX.Element {
  const t = useT()

  return (
    <div
      className="group relative shrink-0 overflow-hidden rounded-md border border-app-border bg-app-panel-2"
      title={`${attachment.fileName}\n${attachment.width}×${attachment.height} · ${formatSize(
        attachment.sizeBytes
      )}`}
    >
      <button onClick={onOpenPreview} className="block cursor-zoom-in">
        <img
          src={attachment.thumbnailDataUrl}
          alt={attachment.fileName}
          className="h-[52px] w-[72px] object-cover"
        />
      </button>

      <div className="max-w-[72px] truncate px-1 pb-0.5 text-[9px] text-app-muted">
        {attachment.fileName}
      </div>

      <button
        onClick={onRemove}
        title={t('images.remove')}
        className="absolute top-0.5 right-0.5 rounded bg-app-bg/80 p-0.5 text-app-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-app-text"
      >
        <X size={11} />
      </button>
    </div>
  )
}
