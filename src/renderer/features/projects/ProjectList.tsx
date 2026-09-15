import { useMemo, useState } from 'react'
import { FolderOpen, FolderPlus, Pencil, Search, Star, Trash2, X } from 'lucide-react'
import type { Project } from '@shared/types'
import { shortenPath } from '@renderer/lib/format'
import { useAppStore } from '@renderer/store/app-store'
import { useDates, useT } from '@renderer/store/i18n-store'

/**
 * Lewy panel: projekty przypięte oraz wykryte automatycznie z transkryptów Claude Code.
 *
 * Rozdzielenie na dwie sekcje jest celowe — pierwszym uruchomieniem wykrywa się
 * kilkadziesiąt katalogów, w tym przypadkowe. Użytkownik przypina to, czego używa,
 * a reszta zostaje pod ręką, ale nie zaśmieca góry listy.
 */
export function ProjectList(): React.JSX.Element {
  const t = useT()
  const projects = useAppStore((state) => state.projects)
  const query = useAppStore((state) => state.projectQuery)
  const setQuery = useAppStore((state) => state.setProjectQuery)
  const selected = useAppStore((state) => state.selectedProjectPath)
  const selectProject = useAppStore((state) => state.selectProject)
  const addProject = useAppStore((state) => state.addProject)
  const scanProgress = useAppStore((state) => state.scanProgress)

  const { pinned, discovered } = useMemo(() => {
    const needle = query.trim().toLowerCase()
    const matching = projects.filter(
      (project) =>
        needle === '' ||
        project.name.toLowerCase().includes(needle) ||
        project.path.toLowerCase().includes(needle)
    )
    return {
      pinned: matching.filter((project) => project.isTracked || project.isFavorite),
      discovered: matching.filter((project) => !project.isTracked && !project.isFavorite),
    }
  }, [projects, query])

  return (
    <aside className="flex h-full w-[260px] shrink-0 flex-col border-r border-app-border bg-app-panel">
      <div className="flex items-center gap-1.5 px-2 pt-2">
        <div className="relative min-w-0 flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-app-muted"
          />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('projects.searchPlaceholder')}
            spellCheck={false}
            className="w-full rounded-md border border-app-border bg-app-panel-2 py-1 pr-2 pl-7 text-[12px] outline-none placeholder:text-app-muted focus:border-app-accent-dim"
          />
          {query !== '' && (
            <button
              onClick={() => setQuery('')}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 text-app-muted hover:text-app-text"
              title={t('projects.clear')}
            >
              <X size={12} />
            </button>
          )}
        </div>
        <button
          onClick={() => void addProject()}
          title={t('projects.add')}
          className="shrink-0 rounded-md border border-app-border p-1.5 text-app-muted hover:bg-app-panel-2 hover:text-app-text"
        >
          <FolderPlus size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-1 py-2">
        <Section title={t('projects.pinned')} count={pinned.length}>
          {pinned.map((project) => (
            <ProjectItem
              key={project.path}
              project={project}
              isSelected={project.path === selected}
              onSelect={() => void selectProject(project.path)}
            />
          ))}
          {pinned.length === 0 && (
            <p className="px-2 py-1.5 text-[11px] text-app-muted">{t('projects.pinHint')}</p>
          )}
        </Section>

        {discovered.length > 0 && (
          <Section title={t('projects.discovered')} count={discovered.length}>
            {discovered.map((project) => (
              <ProjectItem
                key={project.path}
                project={project}
                isSelected={project.path === selected}
                onSelect={() => void selectProject(project.path)}
              />
            ))}
          </Section>
        )}
      </div>

      {scanProgress !== null && (
        <div className="border-t border-app-border px-3 py-1.5 text-[11px] text-app-muted">
          {t('projects.scanning', { scanned: scanProgress.scanned, total: scanProgress.total })}
        </div>
      )}
    </aside>
  )
}

function Section({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mb-3">
      <h2 className="px-2 pb-1 text-[10px] font-semibold tracking-wider text-app-muted uppercase">
        {title} <span className="font-normal">({count})</span>
      </h2>
      {children}
    </section>
  )
}

function ProjectItem({
  project,
  isSelected,
  onSelect,
}: {
  project: Project
  isSelected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const t = useT()
  const dates = useDates()
  const [isRenaming, setIsRenaming] = useState(false)
  const [draft, setDraft] = useState(project.name)

  const toggleFavorite = useAppStore((state) => state.toggleProjectFavorite)
  const renameProject = useAppStore((state) => state.renameProject)
  const removeProject = useAppStore((state) => state.removeProject)
  const openFolder = useAppStore((state) => state.openProjectFolder)

  const commitRename = (): void => {
    setIsRenaming(false)
    const trimmed = draft.trim()
    if (trimmed !== project.name) {
      void renameProject(project.path, trimmed === '' ? null : trimmed)
    }
  }

  return (
    <div
      onClick={onSelect}
      className={`group relative cursor-default rounded-md px-2 py-1.5 ${
        isSelected ? 'bg-app-panel-2' : 'hover:bg-app-panel-2/60'
      } ${project.exists ? '' : 'opacity-45'}`}
      title={project.exists ? project.path : t('projects.missingDir', { path: project.path })}
    >
      <div className="flex items-center gap-1.5">
        {project.runningSessions > 0 && (
          <span
            className="size-[6px] shrink-0 rounded-full bg-app-ok"
            title={t('projects.running', { count: project.runningSessions })}
          />
        )}

        {isRenaming ? (
          <input
            autoFocus
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onBlur={commitRename}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitRename()
              if (event.key === 'Escape') {
                setDraft(project.name)
                setIsRenaming(false)
              }
            }}
            onClick={(event) => event.stopPropagation()}
            className="min-w-0 flex-1 rounded border border-app-accent-dim bg-app-bg px-1 text-[12px] outline-none"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12px]">{project.name}</span>
        )}

        <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <IconButton
            title={project.isFavorite ? t('projects.unpin') : t('projects.pin')}
            onClick={() => void toggleFavorite(project)}
          >
            <Star size={12} className={project.isFavorite ? 'fill-app-accent text-app-accent' : ''} />
          </IconButton>
          <IconButton title={t('projects.rename')} onClick={() => setIsRenaming(true)}>
            <Pencil size={12} />
          </IconButton>
          <IconButton title={t('projects.openExplorer')} onClick={() => void openFolder(project.path)}>
            <FolderOpen size={12} />
          </IconButton>
          <IconButton title={t('projects.remove')} onClick={() => void removeProject(project.path)}>
            <Trash2 size={12} />
          </IconButton>
        </div>

        {project.isFavorite && (
          <Star size={11} className="shrink-0 fill-app-accent text-app-accent group-hover:hidden" />
        )}
      </div>

      <div className="flex items-center gap-1.5 pl-0 text-[10px] text-app-muted">
        <span className="truncate" title={project.path}>
          {shortenPath(project.path, 30)}
        </span>
      </div>

      <div className="flex items-center gap-2 text-[10px] text-app-muted">
        <span>{t('projects.sessionCount', { count: project.sessionCount })}</span>
        {project.gitBranch !== null && <span className="truncate">⑂ {project.gitBranch}</span>}
        <span className="ml-auto shrink-0">{dates.relative(project.lastActivityAt)}</span>
      </div>
    </div>
  )
}

function IconButton({
  title,
  onClick,
  children,
}: {
  title: string
  onClick: () => void
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <button
      title={title}
      onClick={(event) => {
        // Bez tego kliknięcie w ikonę wybrałoby także sam projekt.
        event.stopPropagation()
        onClick()
      }}
      className="rounded p-0.5 text-app-muted hover:bg-app-border hover:text-app-text"
    >
      {children}
    </button>
  )
}
