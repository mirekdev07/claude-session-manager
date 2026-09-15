import { Columns2, RotateCw, X } from 'lucide-react'
import type { MessageKey } from '@shared/i18n'
import type { PtyStatus } from '@shared/types'
import { useT } from '@renderer/store/i18n-store'
import { useTerminalStore, type TerminalTab } from '@renderer/store/terminal-store'

const STATUS_COLOR: Record<PtyStatus, string> = {
  running: 'bg-app-ok',
  waiting: 'bg-app-warn',
  closed: 'bg-app-muted',
  error: 'bg-app-error',
}

const STATUS_KEY: Record<PtyStatus, MessageKey> = {
  running: 'tabs.status.running',
  waiting: 'tabs.status.waiting',
  closed: 'tabs.status.closed',
  error: 'tabs.status.error',
}

/** Pasek zakładek w stylu IDE. Każda zakładka trzyma własny proces PTY. */
export function TerminalTabs(): React.JSX.Element | null {
  const tabs = useTerminalStore((state) => state.tabs)
  const activeTabId = useTerminalStore((state) => state.activeTabId)
  const splitTabId = useTerminalStore((state) => state.splitTabId)
  const selectTab = useTerminalStore((state) => state.selectTab)
  const closeTab = useTerminalStore((state) => state.closeTab)
  const restartTab = useTerminalStore((state) => state.restartTab)
  const toggleSplit = useTerminalStore((state) => state.toggleSplit)

  if (tabs.length === 0) return null

  return (
    <div className="flex h-[34px] shrink-0 items-stretch gap-px overflow-x-auto border-b border-app-border bg-app-panel">
      {tabs.map((tab) => (
        <TabButton
          key={tab.id}
          tab={tab}
          isActive={tab.id === activeTabId}
          isSplit={tab.id === splitTabId}
          canSplit={tabs.length > 1}
          onSelect={() => selectTab(tab.id)}
          onClose={() => closeTab(tab.id)}
          onRestart={() => restartTab(tab.id)}
          onToggleSplit={() => toggleSplit(tab.id)}
        />
      ))}
    </div>
  )
}

function TabButton({
  tab,
  isActive,
  isSplit,
  canSplit,
  onSelect,
  onClose,
  onRestart,
  onToggleSplit,
}: {
  tab: TerminalTab
  isActive: boolean
  isSplit: boolean
  canSplit: boolean
  onSelect: () => void
  onClose: () => void
  onRestart: () => void
  onToggleSplit: () => void
}): React.JSX.Element {
  const t = useT()
  const isDead = tab.status === 'closed' || tab.status === 'error'

  const tooltip =
    `${tab.projectPath}\n${t(STATUS_KEY[tab.status])}` +
    (tab.exitCode !== null ? ` ${t('tabs.exitCode', { code: tab.exitCode })}` : '') +
    (isSplit ? `\n${t('tabs.splitNote')}` : '')

  return (
    <div
      onClick={onSelect}
      onAuxClick={(event) => {
        // Środkowy przycisk zamyka zakładkę — zachowanie znane z przeglądarek i IDE.
        if (event.button === 1) onClose()
      }}
      title={tooltip}
      className={`group flex max-w-[240px] min-w-[150px] cursor-default items-center gap-2 border-r border-app-border px-3 text-[11px] ${
        isActive ? 'bg-app-bg text-app-text' : isSplit ? 'bg-app-bg/60 text-app-text' : 'text-app-muted hover:bg-app-panel-2'
      }`}
    >
      <span className={`size-[6px] shrink-0 rounded-full ${STATUS_COLOR[tab.status]}`} />
      <span className={`min-w-0 flex-1 truncate ${isDead ? 'line-through opacity-60' : ''}`}>
        {tab.title}
      </span>

      {isDead && (
        <button
          title={t('tabs.restart')}
          onClick={(event) => {
            event.stopPropagation()
            onRestart()
          }}
          className="shrink-0 rounded p-0.5 hover:bg-app-border hover:text-app-text"
        >
          <RotateCw size={11} />
        </button>
      )}

      {canSplit && (
        <button
          title={isSplit ? t('tabs.splitOff') : t('tabs.splitOn')}
          onClick={(event) => {
            event.stopPropagation()
            onToggleSplit()
          }}
          className={`shrink-0 rounded p-0.5 hover:bg-app-border hover:text-app-text ${
            isSplit ? 'text-app-accent opacity-100' : 'opacity-0 group-hover:opacity-100'
          }`}
        >
          <Columns2 size={11} />
        </button>
      )}

      <button
        title={t('tabs.close')}
        onClick={(event) => {
          event.stopPropagation()
          onClose()
        }}
        className="shrink-0 rounded p-0.5 opacity-0 group-hover:opacity-100 hover:bg-app-border hover:text-app-text"
      >
        <X size={11} />
      </button>
    </div>
  )
}
