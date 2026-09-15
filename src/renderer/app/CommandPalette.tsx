import { useEffect, useMemo, useState } from 'react'
import {
  Camera,
  Code2,
  Columns2,
  FolderOpen,
  FolderPlus,
  GitFork,
  History,
  ImagePlus,
  Mic,
  Play,
  Search,
  Settings,
  Square,
} from 'lucide-react'
import { useAppStore } from '@renderer/store/app-store'
import { useAttachmentStore } from '@renderer/store/attachment-store'
import { useT } from '@renderer/store/i18n-store'
import { useSettingsStore } from '@renderer/store/settings-store'
import { useTerminalStore } from '@renderer/store/terminal-store'
import { useVoiceStore } from '@renderer/store/voice-store'

interface Command {
  id: string
  label: string
  hint?: string
  icon: React.ReactNode
  disabled?: boolean
  run: () => void
}

export interface CommandPaletteProps {
  onOpenSearch: () => void
}

/** Paleta poleceń otwierana skrótem Ctrl+K (§22 planu). */
export function CommandPalette({ onOpenSearch }: CommandPaletteProps): React.JSX.Element | null {
  const t = useT()
  const [isOpen, setIsOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [highlighted, setHighlighted] = useState(0)

  const projects = useAppStore((state) => state.projects)
  const selectedProjectPath = useAppStore((state) => state.selectedProjectPath)
  const sessions = useAppStore((state) => state.sessions)
  const selectProject = useAppStore((state) => state.selectProject)
  const addProject = useAppStore((state) => state.addProject)
  const openProjectFolder = useAppStore((state) => state.openProjectFolder)

  const tabs = useTerminalStore((state) => state.tabs)
  const activeTabId = useTerminalStore((state) => state.activeTabId)
  const openTab = useTerminalStore((state) => state.openTab)
  const closeTab = useTerminalStore((state) => state.closeTab)
  const toggleSplit = useTerminalStore((state) => state.toggleSplit)
  const splitTabId = useTerminalStore((state) => state.splitTabId)

  const openSettings = useSettingsStore((state) => state.open)
  const addFromPicker = useAttachmentStore((state) => state.addFromPicker)
  const captureScreen = useAttachmentStore((state) => state.captureScreen)
  const voicePhase = useVoiceStore((state) => state.phase)
  const startVoice = useVoiceStore((state) => state.start)
  const stopVoice = useVoiceStore((state) => state.stopAndTranscribe)

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key.toLowerCase() === 'k' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        setIsOpen((open) => !open)
        setQuery('')
        setHighlighted(0)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [])

  const selectedProject = projects.find((project) => project.path === selectedProjectPath) ?? null
  const latestSession = sessions[0] ?? null

  const commands = useMemo<Command[]>(() => {
    const openInProject = (mode: 'new' | 'continue' | 'resume' | 'fork'): void => {
      if (!selectedProject) return
      openTab({
        projectPath: selectedProject.path,
        projectName: selectedProject.name,
        mode,
        session: mode === 'resume' || mode === 'fork' ? (latestSession ?? undefined) : undefined,
      })
    }

    const base: Command[] = [
      {
        id: 'new-session',
        label: t('palette.newSession'),
        hint: selectedProject?.name,
        icon: <Play size={13} />,
        disabled: selectedProject === null,
        run: () => openInProject('new'),
      },
      {
        id: 'continue',
        label: t('palette.continue'),
        hint: selectedProject?.name,
        icon: <History size={13} />,
        disabled: selectedProject === null,
        run: () => openInProject('continue'),
      },
      {
        id: 'resume',
        label: t('palette.resume'),
        hint: latestSession?.title ?? undefined,
        icon: <Play size={13} />,
        disabled: latestSession === null,
        run: () => openInProject('resume'),
      },
      {
        id: 'fork',
        label: t('palette.fork'),
        hint: t('palette.forkHint'),
        icon: <GitFork size={13} />,
        disabled: latestSession === null,
        run: () => openInProject('fork'),
      },
      {
        id: 'search',
        label: t('palette.search'),
        hint: 'Ctrl+Shift+F',
        icon: <Search size={13} />,
        run: onOpenSearch,
      },
      {
        id: 'add-project',
        label: t('palette.addProject'),
        icon: <FolderPlus size={13} />,
        run: () => void addProject(),
      },
      {
        id: 'open-editor',
        label: t('palette.openEditor'),
        hint: t('palette.openEditorHint'),
        icon: <Code2 size={13} />,
        disabled: selectedProject === null,
        run: () => {
          if (!selectedProject) return
          void window.api.projects.openInEditor(selectedProject.path).then((error) => {
            if (error !== null) useAppStore.setState({ error })
          })
        },
      },
      {
        id: 'capture-screen',
        label: t('palette.capture'),
        hint: t('palette.captureHint'),
        icon: <Camera size={13} />,
        disabled: activeTabId === null,
        run: () => activeTabId !== null && void captureScreen(activeTabId),
      },
      {
        id: 'split',
        label: splitTabId !== null ? t('palette.splitOff') : t('palette.splitOn'),
        hint: t('palette.splitHint'),
        icon: <Columns2 size={13} />,
        disabled: tabs.length < 2,
        run: () => {
          if (splitTabId !== null) {
            toggleSplit(splitTabId)
            return
          }
          const other = tabs.find((tab) => tab.id !== activeTabId)
          if (other) toggleSplit(other.id)
        },
      },
      {
        id: 'open-folder',
        label: t('palette.openFolder'),
        hint: selectedProject?.path,
        icon: <FolderOpen size={13} />,
        disabled: selectedProject === null,
        run: () => selectedProject && void openProjectFolder(selectedProject.path),
      },
      {
        id: 'microphone',
        label: voicePhase === 'recording' ? t('palette.stopRecording') : t('palette.dictate'),
        hint: 'Ctrl+Shift+Space',
        icon: <Mic size={13} />,
        disabled: activeTabId === null,
        run: () => {
          if (activeTabId === null) return
          if (voicePhase === 'recording') void stopVoice()
          else void startVoice(activeTabId)
        },
      },
      {
        id: 'add-image',
        label: t('palette.addImage'),
        icon: <ImagePlus size={13} />,
        disabled: activeTabId === null,
        run: () => activeTabId !== null && void addFromPicker(activeTabId),
      },
      {
        id: 'settings',
        label: t('palette.settings'),
        icon: <Settings size={13} />,
        run: () => void openSettings(),
      },
      {
        id: 'kill',
        label: t('palette.kill'),
        hint: tabs.find((tab) => tab.id === activeTabId)?.title,
        icon: <Square size={13} />,
        disabled: activeTabId === null,
        run: () => activeTabId !== null && closeTab(activeTabId),
      },
    ]

    // Przełączanie projektu: każdy projekt to osobne polecenie, żeby dało się je wyszukać po nazwie.
    const projectCommands: Command[] = projects.slice(0, 40).map((project) => ({
      id: `project:${project.path}`,
      label: t('palette.goTo', { name: project.name }),
      hint: project.path,
      icon: <FolderOpen size={13} />,
      run: () => void selectProject(project.path),
    }))

    return [...base, ...projectCommands]
  }, [
    t,
    projects,
    selectedProject,
    latestSession,
    tabs,
    activeTabId,
    splitTabId,
    voicePhase,
    openTab,
    closeTab,
    toggleSplit,
    captureScreen,
    onOpenSearch,
    addProject,
    openProjectFolder,
    selectProject,
    openSettings,
    addFromPicker,
    startVoice,
    stopVoice,
  ])

  const matches = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return commands
    return commands.filter(
      (command) =>
        command.label.toLowerCase().includes(needle) ||
        (command.hint ?? '').toLowerCase().includes(needle)
    )
  }, [commands, query])

  if (!isOpen) return null

  const run = (command: Command | undefined): void => {
    if (!command || command.disabled === true) return
    setIsOpen(false)
    command.run()
  }

  return (
    <div
      onClick={() => setIsOpen(false)}
      className="absolute inset-0 z-50 flex justify-center bg-black/60 pt-[12vh]"
    >
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex h-fit max-h-[60vh] w-[560px] max-w-full flex-col overflow-hidden rounded-lg border border-app-border bg-app-panel"
      >
        <input
          autoFocus
          value={query}
          onChange={(event) => {
            setQuery(event.target.value)
            setHighlighted(0)
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') setIsOpen(false)
            if (event.key === 'ArrowDown') {
              event.preventDefault()
              setHighlighted((index) => Math.min(index + 1, matches.length - 1))
            }
            if (event.key === 'ArrowUp') {
              event.preventDefault()
              setHighlighted((index) => Math.max(index - 1, 0))
            }
            if (event.key === 'Enter') run(matches[highlighted])
          }}
          placeholder={t('palette.placeholder')}
          className="border-b border-app-border bg-transparent px-4 py-3 text-[13px] outline-none placeholder:text-app-muted"
        />

        <div className="min-h-0 flex-1 overflow-y-auto py-1">
          {matches.length === 0 && (
            <p className="px-4 py-3 text-[12px] text-app-muted">{t('palette.none')}</p>
          )}

          {matches.map((command, index) => (
            <button
              key={command.id}
              onClick={() => run(command)}
              onMouseEnter={() => setHighlighted(index)}
              disabled={command.disabled}
              className={`flex w-full items-center gap-2.5 px-4 py-1.5 text-left text-[12px] disabled:opacity-35 ${
                index === highlighted ? 'bg-app-panel-2' : ''
              }`}
            >
              <span className="shrink-0 text-app-muted">{command.icon}</span>
              <span className="shrink-0">{command.label}</span>
              {command.hint !== undefined && (
                <span className="min-w-0 truncate text-[11px] text-app-muted">{command.hint}</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
