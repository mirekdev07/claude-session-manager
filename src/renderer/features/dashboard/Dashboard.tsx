import { useEffect, useState } from 'react'
import { FolderPlus, Play, Sparkles } from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import type { ClaudeSession, Project } from '@shared/types'
import { useAppStore } from '@renderer/store/app-store'
import { useDates, useT } from '@renderer/store/i18n-store'

/** Ekran startowy: szybki dostęp do ostatnich projektów i rozmów (§19 planu). */
export function Dashboard({
  onOpenSession,
}: {
  onOpenSession: (project: Project, session?: ClaudeSession) => void
}): React.JSX.Element {
  const t = useT()
  const dates = useDates()
  const projects = useAppStore((state) => state.projects)
  const selectProject = useAppStore((state) => state.selectProject)
  const addProject = useAppStore((state) => state.addProject)

  const [recentSessions, setRecentSessions] = useState<ClaudeSession[]>([])

  useEffect(() => {
    void window.api.sessions.listRecent(6).then(setRecentSessions)
    // Lista odświeża się przy każdej zmianie projektów, czyli także po zakończeniu skanu.
  }, [projects])

  const recentProjects = projects.filter((project) => project.sessionCount > 0).slice(0, 6)

  return (
    <div className="h-full overflow-y-auto px-10 py-8">
      <h1 className="mb-1 text-[22px] font-medium tracking-tight">{t(greetingKey())}</h1>
      <p className="mb-8 text-[12px] text-app-muted">{t('dashboard.subtitle')}</p>

      <section className="mb-8">
        <h2 className="mb-3 text-[10px] font-semibold tracking-wider text-app-muted uppercase">
          {t('dashboard.recentProjects')}
        </h2>

        {recentProjects.length === 0 ? (
          <button
            onClick={() => void addProject()}
            className="flex items-center gap-2 rounded-md border border-dashed border-app-border px-4 py-3 text-[12px] text-app-muted hover:border-app-accent-dim hover:text-app-text"
          >
            <FolderPlus size={14} />
            {t('dashboard.addFirst')}
          </button>
        ) : (
          <div className="grid grid-cols-2 gap-2 xl:grid-cols-3">
            {recentProjects.map((project) => (
              <button
                key={project.path}
                onClick={() => void selectProject(project.path)}
                className="rounded-md border border-app-border bg-app-panel px-3 py-2.5 text-left hover:border-app-accent-dim"
              >
                <div className="flex items-center gap-1.5">
                  {project.runningSessions > 0 && (
                    <span className="size-[6px] shrink-0 rounded-full bg-app-ok" />
                  )}
                  <span className="min-w-0 truncate text-[13px]">{project.name}</span>
                </div>
                <div className="truncate text-[10px] text-app-muted" title={project.path}>
                  {project.path}
                </div>
                <div className="mt-1 flex items-center gap-2 text-[10px] text-app-muted">
                  <span>{t('projects.sessionCount', { count: project.sessionCount })}</span>
                  {project.gitBranch !== null && <span>⑂ {project.gitBranch}</span>}
                  <span className="ml-auto">{dates.relative(project.lastActivityAt)}</span>
                </div>
              </button>
            ))}
          </div>
        )}
      </section>

      {recentSessions.length > 0 && (
        <section>
          <h2 className="mb-3 text-[10px] font-semibold tracking-wider text-app-muted uppercase">
            {t('dashboard.recentSessions')}
          </h2>

          <div className="space-y-1">
            {recentSessions.map((session) => {
              const project = projects.find((candidate) => candidate.path === session.projectPath)
              return (
                <button
                  key={session.sessionId}
                  onClick={() => project && onOpenSession(project, session)}
                  disabled={project === undefined}
                  className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-left hover:bg-app-panel disabled:opacity-40"
                >
                  <Play size={12} className="shrink-0 text-app-muted" />
                  <span className="min-w-0 flex-1 truncate text-[12px]">
                    {session.label ?? session.title ?? t('sessions.untitled')}
                  </span>
                  <span className="shrink-0 text-[11px] text-app-muted">
                    {project?.name ?? '—'}
                  </span>
                  <span className="w-[110px] shrink-0 text-right text-[10px] text-app-muted">
                    {dates.relative(session.lastActivityAt)}
                  </span>
                </button>
              )
            })}
          </div>
        </section>
      )}

      <p className="mt-10 flex items-center gap-1.5 text-[11px] text-app-muted">
        <Sparkles size={12} />
        {t('dashboard.paletteHint')}
      </p>
    </div>
  )
}

function greetingKey(): MessageKey {
  const hour = new Date().getHours()
  if (hour < 5) return 'dashboard.night'
  if (hour < 12) return 'dashboard.morning'
  if (hour < 18) return 'dashboard.afternoon'
  return 'dashboard.evening'
}
