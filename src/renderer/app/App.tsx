import { useEffect, useState } from 'react'
import { AlertTriangle, Search, Settings as SettingsIcon, TerminalSquare, X } from 'lucide-react'
import type { ClaudeSession, Project, PtyMode, SearchHit } from '@shared/types'
import { Dashboard } from '@renderer/features/dashboard/Dashboard'
import { HandoffDialog } from '@renderer/features/handoff/HandoffDialog'
import { SearchPanel } from '@renderer/features/search/SearchPanel'
import { ContextBreakdownPanel } from '@renderer/features/sessions/ContextBreakdownPanel'
import { SettingsPanel } from '@renderer/features/settings/SettingsPanel'
import { UsageIndicator } from '@renderer/features/usage/UsageIndicator'
import { ProjectList } from '@renderer/features/projects/ProjectList'
import { SessionList } from '@renderer/features/sessions/SessionList'
import { ImagePreviewModal } from '@renderer/features/images/ImagePreviewModal'
import { StatusBar } from '@renderer/features/terminal/StatusBar'
import { TerminalPane } from '@renderer/features/terminal/TerminalPane'
import { TerminalTabs } from '@renderer/features/terminal/TerminalTabs'
import { SLOT, withSlot } from '@renderer/lib/slot'
import { useAppStore } from '@renderer/store/app-store'
import { useAttachmentStore } from '@renderer/store/attachment-store'
import { useT } from '@renderer/store/i18n-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useTerminalStore } from '@renderer/store/terminal-store'
import { useVoiceStore } from '@renderer/store/voice-store'
import { CommandPalette } from './CommandPalette'
import { usePushToTalk } from './use-push-to-talk'

export function App(): React.JSX.Element {
  const t = useT()
  const init = useAppStore((state) => state.init)
  const cli = useAppStore((state) => state.cli)
  const projects = useAppStore((state) => state.projects)
  const selectedProjectPath = useAppStore((state) => state.selectedProjectPath)
  const error = useAppStore((state) => state.error)
  const dismissError = useAppStore((state) => state.dismissError)

  const tabs = useTerminalStore((state) => state.tabs)
  const activeTabId = useTerminalStore((state) => state.activeTabId)
  const openTab = useTerminalStore((state) => state.openTab)
  const selectTab = useTerminalStore((state) => state.selectTab)
  const selectProject = useAppStore((state) => state.selectProject)
  const highlightSession = useAppStore((state) => state.highlightSession)

  const [isSearchOpen, setIsSearchOpen] = useState(false)
  const [breakdownSession, setBreakdownSession] = useState<ClaudeSession | null>(null)

  // Ctrl+Shift+F — wyszukiwanie po wszystkich rozmowach (Etap 9).
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.code === 'KeyF' && (event.ctrlKey || event.metaKey) && event.shiftKey) {
        event.preventDefault()
        setIsSearchOpen(true)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  // Zapis otwartych zakładek przy każdej zmianie — przywracanie zależy od ustawienia (Etap 12.1).
  useEffect(
    () =>
      useTerminalStore.subscribe((state, previous) => {
        if (state.tabs === previous.tabs) return
        void window.api.tabs.save(state.toSaved())
      }),
    []
  )

  const drafts = useAttachmentStore((state) => state.drafts)
  const previewAttachmentId = useAttachmentStore((state) => state.previewAttachmentId)
  const openPreview = useAttachmentStore((state) => state.openPreview)
  const notice = useAttachmentStore((state) => state.notice)
  const dismissNotice = useAttachmentStore((state) => state.dismissNotice)

  const voiceError = useVoiceStore((state) => state.error)
  const dismissVoiceError = useVoiceStore((state) => state.dismissError)
  const openSettings = useSettingsStore((state) => state.open)

  usePushToTalk(activeTabId)

  useEffect(() => {
    void init().then(async () => {
      const settings = await window.api.settings.get()
      if (!settings.reopenTabsOnStart) return
      const saved = await window.api.tabs.load()
      const known = useAppStore.getState().projects
      for (const tab of saved) {
        const project = known.find((candidate) => candidate.path === tab.projectPath)
        openTab({
          projectPath: tab.projectPath,
          projectName: project?.name ?? tab.projectPath.split(/[\\/]/).pop() ?? tab.projectPath,
          mode: tab.mode,
          sessionId: tab.sessionId ?? undefined,
        })
      }
    })
  }, [init, openTab])

  // Upuszczenie pliku poza panelem terminala kazałoby Electronowi przejść pod jego adres
  // i zastąpić interfejs aplikacji zawartością pliku.
  useEffect(() => {
    const swallow = (event: DragEvent): void => event.preventDefault()
    window.addEventListener('dragover', swallow)
    window.addEventListener('drop', swallow)
    return () => {
      window.removeEventListener('dragover', swallow)
      window.removeEventListener('drop', swallow)
    }
  }, [])

  const selectedProject = projects.find((project) => project.path === selectedProjectPath) ?? null
  const activeTab = tabs.find((tab) => tab.id === activeTabId) ?? null

  // Main nie wie, którą zakładkę widać — a od tego zależy, czy powiadomienie ma sens.
  const activePtyId = activeTab?.info?.ptyId ?? null
  useEffect(() => {
    void window.api.app.setActivePty(activePtyId)
  }, [activePtyId])

  // Kliknięcie w powiadomienie systemowe przenosi na zakładkę, której dotyczyło.
  useEffect(
    () =>
      window.api.app.onFocusPty((ptyId) => {
        const tab = useTerminalStore.getState().tabs.find((candidate) => candidate.info?.ptyId === ptyId)
        if (tab) selectTab(tab.id)
      }),
    [selectTab]
  )

  const previewAttachment =
    previewAttachmentId === null
      ? null
      : (Object.values(drafts)
          .flatMap((draft) => draft.attachments)
          .find((attachment) => attachment.id === previewAttachmentId) ?? null)

  const handleOpen = (mode: PtyMode, session?: ClaudeSession): void => {
    if (!selectedProject) return
    openTab({
      projectPath: selectedProject.path,
      projectName: selectedProject.name,
      mode,
      session,
    })
  }

  const handleOpenFromDashboard = (project: Project, session?: ClaudeSession): void => {
    openTab({
      projectPath: project.path,
      projectName: project.name,
      mode: session ? 'resume' : 'new',
      session,
    })
  }

  const projectNameFor = (path: string | null): string => {
    if (path === null) return '—'
    return projects.find((project) => project.path === path)?.name ?? (path.split(/[\\/]/).pop() ?? path)
  }

  /** Trafienie z wyszukiwarki: pokaż projekt i podświetl sesję, bez uruchamiania procesu. */
  const revealHit = (hit: SearchHit): void => {
    if (hit.projectPath === null) return
    void selectProject(hit.projectPath).then(() => {
      highlightSession(hit.sessionId)
      window.setTimeout(() => {
        document.getElementById(`session-${hit.sessionId}`)?.scrollIntoView({ block: 'center' })
      }, 50)
    })
  }

  const resumeHit = (hit: SearchHit): void => {
    if (hit.projectPath === null) return
    openTab({
      projectPath: hit.projectPath,
      projectName: projectNameFor(hit.projectPath),
      mode: 'resume',
      sessionId: hit.sessionId,
    })
  }

  return (
    <div className="flex h-full flex-col bg-app-bg text-app-text">
      <header className="drag-region titlebar-safe flex h-[38px] shrink-0 items-center gap-3 border-b border-app-border px-3">
        <TerminalSquare size={15} className="shrink-0 text-app-accent" />
        <span className="text-[12px] font-medium tracking-tight">{t('app.title')}</span>

        {activeTab !== null && (
          <span className="truncate text-[11px] text-app-muted">
            {activeTab.projectName}
            {activeTab.info?.sessionId != null && (
              <span className="ml-2 font-mono">{activeTab.info.sessionId.slice(0, 8)}</span>
            )}
          </span>
        )}

        <div className="ml-auto flex shrink-0 items-center gap-3">
          <button
            onClick={() => setIsSearchOpen(true)}
            title={t('app.searchTitle')}
            className="no-drag flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-app-muted hover:bg-app-panel-2 hover:text-app-text"
          >
            <Search size={13} /> {t('app.search')}
          </button>

          <UsageIndicator />

          <span className="text-[11px] text-app-muted">
            {cli === null && t('app.detecting')}
            {cli?.ok === true && t('app.claudeVersion', { version: cli.version })}
            {cli?.ok === false && <span className="text-app-error">{t('app.claudeUnavailable')}</span>}
          </span>
        </div>

        <button
          onClick={() => void openSettings()}
          title={t('app.settings')}
          className="no-drag shrink-0 rounded p-1 text-app-muted hover:bg-app-panel-2 hover:text-app-text"
        >
          <SettingsIcon size={14} />
        </button>
      </header>

      {cli?.ok === false ? (
        <ClaudeMissing detail={cli.detail} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <ProjectList />
          <SessionList project={selectedProject} onOpen={handleOpen} onShowBreakdown={setBreakdownSession} />

          <main className="flex min-w-0 flex-1 flex-col">
            <TerminalTabs />
            <TerminalArea onOpenFromDashboard={handleOpenFromDashboard} />
          </main>
        </div>
      )}

      <StatusBar
        cwd={activeTab?.projectPath ?? selectedProject?.path ?? ''}
        info={activeTab?.info ?? null}
        status={activeTab?.status ?? 'closed'}
        error={activeTab?.error ?? null}
      />

      {previewAttachment !== null && (
        <ImagePreviewModal attachment={previewAttachment} onClose={() => openPreview(null)} />
      )}

      <SettingsPanel />
      <CommandPalette onOpenSearch={() => setIsSearchOpen(true)} />
      <SearchPanel
        isOpen={isSearchOpen}
        onClose={() => setIsSearchOpen(false)}
        onReveal={revealHit}
        onResume={resumeHit}
        projectName={projectNameFor}
      />
      <HandoffDialog />
      {breakdownSession !== null && (
        <ContextBreakdownPanel session={breakdownSession} onClose={() => setBreakdownSession(null)} />
      )}

      <Toast message={error} onDismiss={dismissError} />
      <Toast message={notice} onDismiss={dismissNotice} offsetClass="bottom-20" />
      <Toast message={voiceError} onDismiss={dismissVoiceError} offsetClass="bottom-30" />
    </div>
  )
}

/** Krótki komunikat w rogu okna. Błędy mają być zrozumiałe i możliwe do zamknięcia (§18 planu). */
function Toast({
  message,
  onDismiss,
  offsetClass = 'bottom-10',
}: {
  message: string | null
  onDismiss: () => void
  offsetClass?: string
}): React.JSX.Element | null {
  if (message === null) return null

  return (
    <div
      className={`absolute right-4 ${offsetClass} z-50 flex max-w-[440px] items-start gap-2 rounded-md border border-app-error/50 bg-app-panel-2 px-3 py-2 text-[12px] shadow-lg`}
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-app-error" />
      <span className="flex-1">{message}</span>
      <button onClick={onDismiss} className="shrink-0 text-app-muted hover:text-app-text">
        <X size={13} />
      </button>
    </div>
  )
}

/**
 * Wszystkie terminale pozostają zamontowane — odmontowanie zabiłoby proces Claude.
 * Nieaktywne chowamy przez `visibility`, która zachowuje wymiary, więc xterm
 * po powrocie na wierzch nie musi się przeliczać od zera.
 */
function TerminalArea({
  onOpenFromDashboard,
}: {
  onOpenFromDashboard: (project: Project, session?: ClaudeSession) => void
}): React.JSX.Element {
  const tabs = useTerminalStore((state) => state.tabs)
  const activeTabId = useTerminalStore((state) => state.activeTabId)
  const splitTabId = useTerminalStore((state) => state.splitTabId)
  const hasSplit = splitTabId !== null && splitTabId !== activeTabId && tabs.some((tab) => tab.id === splitTabId)

  // Dopóki nie ma otwartej zakładki, główny obszar pełni rolę ekranu startowego.
  if (tabs.length === 0) {
    return (
      <div className="min-h-0 flex-1">
        <Dashboard onOpenSession={onOpenFromDashboard} />
      </div>
    )
  }

  /*
   * Split view bez przemontowania: każdy panel jest zawsze absolutnie pozycjonowanym
   * dzieckiem tego samego kontenera, a widoczne dostają tylko inne `left`/`width`.
   * Przeniesienie panelu między rodzicami w drzewie Reacta odmontowałoby XtermView
   * i zabiło proces Claude.
   */
  const placement = (tabId: string): React.CSSProperties | null => {
    if (tabId === activeTabId) return hasSplit ? { left: 0, width: '50%' } : { left: 0, width: '100%' }
    if (hasSplit && tabId === splitTabId) return { left: '50%', width: '50%' }
    return null
  }

  return (
    <div className="relative min-h-0 flex-1">
      {tabs.map((tab) => {
        const style = placement(tab.id)
        return (
          <div
            key={tab.id}
            style={style ?? undefined}
            className={`absolute inset-y-0 ${
              style === null ? 'pointer-events-none invisible left-0 w-full' : ''
            } ${style !== null && tab.id === splitTabId ? 'border-l border-app-border' : ''}`}
          >
            <TerminalPane tab={tab} />
          </div>
        )
      })}
    </div>
  )
}

function ClaudeMissing({ detail }: { detail: string }): React.JSX.Element {
  const t = useT()

  return (
    <div className="flex min-h-0 flex-1 items-center justify-center p-8">
      <div className="max-w-[520px] rounded-lg border border-app-border bg-app-panel p-5">
        <h2 className="mb-2 flex items-center gap-2 text-[14px] font-medium">
          <AlertTriangle size={16} className="text-app-error" />
          {t('app.missingTitle')}
        </h2>
        <p className="mb-3 text-[12px] leading-relaxed text-app-muted">{detail}</p>
        <p className="text-[12px] text-app-muted">
          {withSlot(
            t('app.missingBody', { command: SLOT }),
            <code className="rounded bg-app-panel-2 px-1 font-mono">claude</code>
          )}
        </p>
      </div>
    </div>
  )
}
