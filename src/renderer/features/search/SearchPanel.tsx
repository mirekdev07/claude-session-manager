import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, Search, X } from 'lucide-react'
import type { SearchHit } from '@shared/types'
import { shortenPath } from '@renderer/lib/format'
import { useDates, useT } from '@renderer/store/i18n-store'

export interface SearchPanelProps {
  isOpen: boolean
  onClose: () => void
  /** Pokaż sesję na liście (projekt + podświetlenie), bez uruchamiania procesu. */
  onReveal: (hit: SearchHit) => void
  /** Wznów sesję od razu w nowej zakładce. */
  onResume: (hit: SearchHit) => void
  projectName: (path: string | null) => string
}

const DEBOUNCE_MS = 180

/**
 * Wyszukiwanie po wszystkich rozmowach (Etap 9), `Ctrl+Shift+F`.
 *
 * Indeks obejmuje tekst promptów i odpowiedzi, nie wyniki narzędzi — szuka się rozmowy,
 * nie zawartości wczytanych plików.
 */
export function SearchPanel({ isOpen, onClose, onReveal, onResume, projectName }: SearchPanelProps): React.JSX.Element | null {
  const t = useT()
  const dates = useDates()
  const [query, setQuery] = useState('')
  const [hits, setHits] = useState<SearchHit[]>([])
  const [isSearching, setIsSearching] = useState(false)
  const [highlighted, setHighlighted] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!isOpen) return
    inputRef.current?.focus()
    inputRef.current?.select()
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, onClose])

  // Zapytanie leci z opóźnieniem, żeby nie odpytywać bazy przy każdej literze.
  useEffect(() => {
    if (!isOpen) return
    const trimmed = query.trim()
    if (trimmed.length < 2) {
      setHits([])
      return
    }
    setIsSearching(true)
    const timer = window.setTimeout(() => {
      void window.api.sessions
        .search(trimmed)
        .then((results) => {
          setHits(results)
          setHighlighted(0)
        })
        .finally(() => setIsSearching(false))
    }, DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [query, isOpen])

  if (!isOpen) return null

  return (
    <div onClick={onClose} className="absolute inset-0 z-50 flex justify-center bg-black/60 pt-[10vh]">
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-fit max-h-[70vh] w-[720px] max-w-full flex-col overflow-hidden rounded-lg border border-app-border bg-app-panel"
      >
        <div className="flex items-center gap-2 border-b border-app-border px-4">
          <Search size={14} className="shrink-0 text-app-muted" />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setHighlighted((index) => Math.min(index + 1, hits.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setHighlighted((index) => Math.max(index - 1, 0))
              }
              if (event.key === 'Enter' && hits[highlighted]) {
                onReveal(hits[highlighted])
                onClose()
              }
            }}
            placeholder={t('search.placeholder')}
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent py-3 text-[13px] outline-none placeholder:text-app-muted"
          />
          {isSearching && <Loader2 size={13} className="shrink-0 animate-spin text-app-muted" />}
          <button onClick={onClose} className="shrink-0 text-app-muted hover:text-app-text">
            <X size={14} />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {query.trim().length < 2 && (
            <p className="px-4 py-3 text-[12px] text-app-muted">{t('search.minChars')}</p>
          )}

          {query.trim().length >= 2 && !isSearching && hits.length === 0 && (
            <p className="px-4 py-3 text-[12px] text-app-muted">{t('search.noHits')}</p>
          )}

          {hits.map((hit, index) => (
            <div
              key={`${hit.sessionId}-${hit.timestamp ?? index}`}
              onMouseEnter={() => setHighlighted(index)}
              onClick={() => {
                onReveal(hit)
                onClose()
              }}
              className={`group flex cursor-default items-start gap-3 px-4 py-2 ${
                index === highlighted ? 'bg-app-panel-2' : ''
              }`}
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 text-[10px] text-app-muted">
                  <span className="font-medium text-app-text">{projectName(hit.projectPath)}</span>
                  <span className="truncate" title={hit.projectPath ?? ''}>
                    {hit.projectPath ? shortenPath(hit.projectPath, 36) : ''}
                  </span>
                  <span className="ml-auto shrink-0">
                    {hit.role === 'user' ? t('search.you') : t('search.claude')} ·{' '}
                    {dates.relative(hit.timestamp ?? hit.lastActivityAt)}
                  </span>
                </div>
                <p className="mt-0.5 line-clamp-2 text-[12px] leading-snug">
                  <Snippet text={hit.snippet} />
                </p>
                {hit.title !== null && (
                  <p className="mt-0.5 truncate text-[10px] text-app-muted">
                    {t('search.sessionPrefix', { title: hit.title })}
                  </p>
                )}
              </div>
              <button
                onClick={(event) => {
                  event.stopPropagation()
                  onResume(hit)
                  onClose()
                }}
                title={t('search.resumeTitle')}
                className="flex shrink-0 items-center gap-1 rounded border border-app-border px-1.5 py-0.5 text-[10px] text-app-muted opacity-0 group-hover:opacity-100 hover:bg-app-panel hover:text-app-text"
              >
                <Play size={10} /> {t('search.resume')}
              </button>
            </div>
          ))}
        </div>

        <footer className="border-t border-app-border px-4 py-1.5 text-[10px] text-app-muted">
          {t('search.footer')}
        </footer>
      </div>
    </div>
  )
}

/** Trafienia są oznaczone przez FTS5 znakami ⟦ ⟧ — zamieniamy je na wyróżnienie. */
function Snippet({ text }: { text: string }): React.JSX.Element {
  const parts = text.split(/(⟦[^⟧]*⟧)/g)
  return (
    <>
      {parts.map((part, index) =>
        part.startsWith('⟦') ? (
          <mark key={index} className="rounded bg-app-accent/25 px-0.5 text-app-text">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={index}>{part}</span>
        )
      )}
    </>
  )
}
