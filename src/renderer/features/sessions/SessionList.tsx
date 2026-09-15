import { useMemo, useState } from 'react'
import {
  AlertTriangle,
  FileDown,
  GitFork,
  History,
  NotebookPen,
  PieChart,
  Play,
  Plus,
  Sparkles,
  Star,
  Tag,
  Trash2,
} from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import type { ClaudeSession, Project, PtyMode } from '@shared/types'
import { formatSize } from '@renderer/lib/format'
import { formatTokens, HEALTH_COLOR, HEALTH_KEY, healthOf } from '@renderer/lib/health'
import { SLOT, withSlot } from '@renderer/lib/slot'
import { useAppStore, type SessionFilter } from '@renderer/store/app-store'
import { useHandoffStore } from '@renderer/store/handoff-store'
import { useDates, useT } from '@renderer/store/i18n-store'

export interface SessionListProps {
  project: Project | null
  onOpen: (mode: PtyMode, session?: ClaudeSession) => void
  onShowBreakdown: (session: ClaudeSession) => void
}

const FILTERS: Array<{ id: SessionFilter; key: MessageKey }> = [
  { id: 'all', key: 'sessions.filter.all' },
  { id: 'favorites', key: 'sessions.filter.favorites' },
  { id: 'heavy', key: 'sessions.filter.heavy' },
  { id: 'today', key: 'sessions.filter.today' },
]

/** Środkowy panel: rozmowy Claude Code przypisane do wybranego katalogu. */
export function SessionList({ project, onOpen, onShowBreakdown }: SessionListProps): React.JSX.Element {
  const t = useT()
  const sessions = useAppStore((state) => state.sessions)
  const isLoading = useAppStore((state) => state.sessionsLoading)
  const filter = useAppStore((state) => state.sessionFilter)
  const setFilter = useAppStore((state) => state.setSessionFilter)
  const tagFilter = useAppStore((state) => state.tagFilter)
  const setTagFilter = useAppStore((state) => state.setTagFilter)
  const thresholds = useAppStore((state) => state.thresholds)

  const visible = useMemo(() => {
    const startOfToday = new Date()
    startOfToday.setHours(0, 0, 0, 0)
    return sessions.filter((session) => {
      if (tagFilter !== null && !session.tags.includes(tagFilter)) return false
      switch (filter) {
        case 'favorites':
          return session.isFavorite
        case 'heavy':
          return healthOf(session.metrics.peakContext, thresholds) === 'red'
        case 'today':
          return session.lastActivityAt >= startOfToday.getTime()
        default:
          return true
      }
    })
  }, [sessions, filter, tagFilter, thresholds])

  if (project === null) {
    return (
      <div className="flex w-[300px] shrink-0 items-center justify-center border-r border-app-border bg-app-panel px-6 text-center text-[12px] text-app-muted">
        {t('app.pickProjectLeft')}
      </div>
    )
  }

  return (
    <section className="flex w-[300px] shrink-0 flex-col border-r border-app-border bg-app-panel">
      <header className="border-b border-app-border px-3 py-2">
        <h2 className="truncate text-[12px] font-medium" title={project.path}>
          {project.name}
        </h2>
        <p className="truncate text-[10px] text-app-muted" title={project.path}>
          {project.path}
        </p>
      </header>

      <div className="flex flex-wrap gap-1 border-b border-app-border px-2 py-2">
        <ActionButton primary icon={<Plus size={12} />} onClick={() => onOpen('new')}>
          {t('sessions.new')}
        </ActionButton>
        <ActionButton
          icon={<History size={12} />}
          onClick={() => onOpen('continue')}
          disabled={sessions.length === 0}
          title={sessions.length === 0 ? t('sessions.noPrevious') : undefined}
        >
          {t('sessions.continueLast')}
        </ActionButton>
      </div>

      <div className="flex items-center gap-1 border-b border-app-border px-2 py-1.5">
        {FILTERS.map((option) => (
          <button
            key={option.id}
            onClick={() => setFilter(option.id)}
            className={`rounded px-1.5 py-0.5 text-[10px] ${
              filter === option.id ? 'bg-app-panel-2 text-app-text' : 'text-app-muted hover:text-app-text'
            }`}
          >
            {t(option.key)}
          </button>
        ))}
        {tagFilter !== null && (
          <button
            onClick={() => setTagFilter(null)}
            title={t('sessions.clearTag')}
            className="ml-auto flex items-center gap-1 rounded bg-app-accent/20 px-1.5 py-0.5 text-[10px] text-app-accent"
          >
            <Tag size={9} /> {tagFilter} ×
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-1">
        {isLoading && <p className="px-2 py-2 text-[11px] text-app-muted">{t('sessions.loading')}</p>}

        {!isLoading && sessions.length === 0 && (
          <p className="px-2 py-2 text-[11px] text-app-muted">{t('sessions.empty')}</p>
        )}

        {!isLoading && sessions.length > 0 && visible.length === 0 && (
          <p className="px-2 py-2 text-[11px] text-app-muted">{t('sessions.noMatch')}</p>
        )}

        {visible.map((session) => (
          <SessionItem
            key={session.sessionId}
            session={session}
            project={project}
            onOpen={onOpen}
            onShowBreakdown={onShowBreakdown}
          />
        ))}
      </div>
    </section>
  )
}

function SessionItem({
  session,
  project,
  onOpen,
  onShowBreakdown,
}: {
  session: ClaudeSession
  project: Project
  onOpen: (mode: PtyMode, session: ClaudeSession) => void
  onShowBreakdown: (session: ClaudeSession) => void
}): React.JSX.Element {
  const t = useT()
  const dates = useDates()
  const [isLabeling, setIsLabeling] = useState(false)
  const [labelDraft, setLabelDraft] = useState(session.label ?? '')
  const [isEditingMeta, setIsEditingMeta] = useState(false)
  const [notesDraft, setNotesDraft] = useState(session.notes ?? '')
  const [tagsDraft, setTagsDraft] = useState(session.tags.join(', '))
  const [confirmResume, setConfirmResume] = useState(false)

  const thresholds = useAppStore((state) => state.thresholds)
  const highlightedId = useAppStore((state) => state.highlightedSessionId)
  const toggleFavorite = useAppStore((state) => state.toggleSessionFavorite)
  const setLabel = useAppStore((state) => state.setSessionLabel)
  const setNotes = useAppStore((state) => state.setSessionNotes)
  const setTags = useAppStore((state) => state.setSessionTags)
  const setTagFilter = useAppStore((state) => state.setTagFilter)
  const removeFromIndex = useAppStore((state) => state.removeSessionFromIndex)
  const beginHandoff = useHandoffStore((state) => state.begin)

  const health = healthOf(session.metrics.peakContext, thresholds)
  const hasMetrics = session.metrics.requestCount > 0
  const heading = session.label ?? session.title ?? t('sessions.untitled')
  const isHighlighted = highlightedId === session.sessionId
  const peak = formatTokens(session.metrics.peakContext)

  const commitLabel = (): void => {
    setIsLabeling(false)
    const trimmed = labelDraft.trim()
    void setLabel(session.sessionId, trimmed === '' ? null : trimmed)
  }

  const commitMeta = (): void => {
    setIsEditingMeta(false)
    void setNotes(session.sessionId, notesDraft.trim() === '' ? null : notesDraft.trim())
    void setTags(
      session.sessionId,
      tagsDraft.split(',').map((tag) => tag.trim()).filter((tag) => tag !== '')
    )
  }

  const resume = (): void => {
    // Ciężka sesja: wznowienie zaczyna od przeczytania całego kontekstu — dajemy wybór.
    if (health === 'red' && !confirmResume) {
      setConfirmResume(true)
      return
    }
    setConfirmResume(false)
    onOpen('resume', session)
  }

  const exportMarkdown = async (): Promise<void> => {
    await window.api.sessions.exportMarkdown(session.sessionId)
  }

  const tooltip =
    t('sessions.tooltip', {
      created: dates.dateTime(session.createdAt),
      last: dates.dateTime(session.lastActivityAt),
      id: session.sessionId,
      size: formatSize(session.sizeBytes),
    }) +
    (hasMetrics
      ? t('sessions.tooltipMetrics', {
          peak,
          health: t(HEALTH_KEY[health]),
          requests: session.metrics.requestCount,
          tools: session.metrics.toolCallCount,
        })
      : '')

  return (
    <article
      id={`session-${session.sessionId}`}
      className={`group rounded-md px-2 py-1.5 ${
        isHighlighted ? 'bg-app-accent/15 ring-1 ring-app-accent/40' : 'hover:bg-app-panel-2/60'
      }`}
      title={tooltip}
    >
      <div className="flex items-start gap-1.5">
        <span
          className={`mt-1.5 size-[7px] shrink-0 rounded-full ${hasMetrics ? HEALTH_COLOR[health] : 'bg-app-border'}`}
          title={
            hasMetrics
              ? t('sessions.healthDot', { health: t(HEALTH_KEY[health]), peak })
              : t('sessions.metricsPending')
          }
        />

        {isLabeling ? (
          <input
            autoFocus
            value={labelDraft}
            onChange={(event) => setLabelDraft(event.target.value)}
            onBlur={commitLabel}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitLabel()
              if (event.key === 'Escape') {
                setLabelDraft(session.label ?? '')
                setIsLabeling(false)
              }
            }}
            placeholder={t('sessions.labelPlaceholder')}
            className="mb-1 w-full rounded border border-app-accent-dim bg-app-bg px-1 text-[12px] outline-none"
          />
        ) : (
          <p className="line-clamp-2 min-w-0 flex-1 text-[12px] leading-snug">
            {session.isFavorite && (
              <Star size={10} className="mr-1 inline fill-app-accent text-app-accent" />
            )}
            {heading}
          </p>
        )}
      </div>

      <div className="mt-0.5 flex items-center gap-2 pl-[13px] text-[10px] text-app-muted">
        <span className="font-mono">{session.sessionId.slice(0, 8)}</span>
        {hasMetrics && (
          <span className="tabular-nums" title={t('sessions.peakTitle')}>
            {peak}
          </span>
        )}
        {session.gitBranch !== null && <span className="truncate">⑂ {session.gitBranch}</span>}
        <span className="ml-auto shrink-0">{dates.relative(session.lastActivityAt)}</span>
      </div>

      {(session.tags.length > 0 || session.notes !== null) && !isEditingMeta && (
        <div className="mt-1 flex flex-wrap items-center gap-1 pl-[13px]">
          {session.tags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tag)}
              title={t('sessions.tagFilterTitle', { tag })}
              className="rounded bg-app-panel-2 px-1.5 py-0.5 text-[9px] text-app-muted hover:text-app-text"
            >
              #{tag}
            </button>
          ))}
          {session.notes !== null && (
            <span className="min-w-0 flex-1 truncate text-[10px] text-app-muted" title={session.notes}>
              {session.notes}
            </span>
          )}
        </div>
      )}

      {isEditingMeta && (
        <div className="mt-1.5 space-y-1 pl-[13px]">
          <input
            autoFocus
            value={tagsDraft}
            onChange={(event) => setTagsDraft(event.target.value)}
            placeholder={t('sessions.tagsPlaceholder')}
            className="w-full rounded border border-app-border bg-app-bg px-1.5 py-0.5 text-[11px] outline-none focus:border-app-accent-dim"
          />
          <textarea
            value={notesDraft}
            onChange={(event) => setNotesDraft(event.target.value)}
            placeholder={t('sessions.notesPlaceholder')}
            rows={2}
            className="w-full resize-none rounded border border-app-border bg-app-bg px-1.5 py-0.5 text-[11px] outline-none focus:border-app-accent-dim"
          />
          <div className="flex justify-end gap-1">
            <button
              onClick={() => setIsEditingMeta(false)}
              className="rounded border border-app-border px-1.5 py-0.5 text-[10px] text-app-muted hover:text-app-text"
            >
              {t('sessions.cancel')}
            </button>
            <button
              onClick={commitMeta}
              className="rounded bg-app-accent px-1.5 py-0.5 text-[10px] font-medium text-app-bg"
            >
              {t('sessions.save')}
            </button>
          </div>
        </div>
      )}

      {confirmResume && (
        <div className="mt-1.5 rounded-md border border-app-warn/50 bg-app-warn/10 px-2 py-1.5 pl-[13px] text-[10px]">
          <p className="mb-1 flex items-start gap-1">
            <AlertTriangle size={11} className="mt-0.5 shrink-0 text-app-warn" />
            <span>{withSlot(t('sessions.resumeWarning', { peak: SLOT }), <strong>{peak}</strong>)}</span>
          </p>
          <div className="flex gap-1">
            <button
              onClick={resume}
              className="rounded border border-app-border px-1.5 py-0.5 text-[10px] hover:bg-app-panel-2"
            >
              {t('sessions.resumeAnyway')}
            </button>
            <button
              onClick={() => {
                setConfirmResume(false)
                beginHandoff(session, project)
              }}
              className="rounded bg-app-accent px-1.5 py-0.5 text-[10px] font-medium text-app-bg"
            >
              {t('sessions.handoffNew')}
            </button>
            <button
              onClick={() => setConfirmResume(false)}
              className="ml-auto text-app-muted hover:text-app-text"
            >
              {t('sessions.cancel')}
            </button>
          </div>
        </div>
      )}

      <div className="mt-1 flex items-center gap-1 pl-[13px] opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
        <MiniButton icon={<Play size={11} />} onClick={resume}>
          {t('sessions.resume')}
        </MiniButton>
        <MiniButton
          icon={<GitFork size={11} />}
          onClick={() => onOpen('fork', session)}
          title={t('sessions.forkTitle')}
        >
          {t('sessions.fork')}
        </MiniButton>
        <MiniButton
          icon={<Sparkles size={11} />}
          onClick={() => beginHandoff(session, project)}
          title={t('sessions.handoffTitle')}
        >
          {t('sessions.handoff')}
        </MiniButton>

        <div className="ml-auto flex items-center">
          <IconButton
            title={hasMetrics ? t('sessions.breakdown') : t('sessions.metricsPending')}
            onClick={() => onShowBreakdown(session)}
            disabled={!hasMetrics}
          >
            <PieChart size={11} />
          </IconButton>
          <IconButton title={t('sessions.notesAndTags')} onClick={() => setIsEditingMeta((open) => !open)}>
            <NotebookPen size={11} />
          </IconButton>
          <IconButton title={t('sessions.export')} onClick={() => void exportMarkdown()}>
            <FileDown size={11} />
          </IconButton>
          <IconButton
            title={session.isFavorite ? t('sessions.unfavorite') : t('sessions.favorite')}
            onClick={() => void toggleFavorite(session)}
          >
            <Star size={11} className={session.isFavorite ? 'fill-app-accent text-app-accent' : ''} />
          </IconButton>
          <IconButton title={t('sessions.label')} onClick={() => setIsLabeling(true)}>
            <Tag size={11} />
          </IconButton>
          <IconButton title={t('sessions.hide')} onClick={() => void removeFromIndex(session.sessionId)}>
            <Trash2 size={11} />
          </IconButton>
        </div>
      </div>
    </article>
  )
}

function ActionButton({
  icon,
  children,
  onClick,
  primary,
  disabled,
  title,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  primary?: boolean
  disabled?: boolean
  title?: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${
        primary
          ? 'bg-app-accent font-medium text-app-bg hover:bg-app-accent/90'
          : 'border border-app-border hover:bg-app-panel-2'
      }`}
    >
      {icon}
      {children}
    </button>
  )
}

function MiniButton({
  icon,
  children,
  onClick,
  title,
}: {
  icon: React.ReactNode
  children: React.ReactNode
  onClick: () => void
  title?: string
}): React.JSX.Element {
  return (
    <button
      onClick={onClick}
      title={title}
      className="flex items-center gap-1 rounded border border-app-border px-1.5 py-0.5 text-[10px] text-app-muted hover:bg-app-panel-2 hover:text-app-text"
    >
      {icon}
      {children}
    </button>
  )
}

function IconButton({
  title,
  onClick,
  disabled,
  children,
}: {
  title: string
  onClick: () => void
  disabled?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="rounded p-1 text-app-muted hover:bg-app-border hover:text-app-text disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
