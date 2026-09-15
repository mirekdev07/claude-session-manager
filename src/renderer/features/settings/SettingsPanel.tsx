import { useEffect } from 'react'
import { Check, Download, FolderSearch, Loader2, X } from 'lucide-react'
import type { WhisperLanguage } from '@shared/i18n'
import type { AppSettings } from '@shared/settings'
import { formatSize } from '@renderer/lib/format'
import { useT } from '@renderer/store/i18n-store'
import { useSettingsStore } from '@renderer/store/settings-store'

/** Ustawienia w podziale na sekcje z §23 planu. */
export function SettingsPanel(): React.JSX.Element | null {
  const t = useT()
  const isOpen = useSettingsStore((state) => state.isOpen)
  const close = useSettingsStore((state) => state.close)
  const settings = useSettingsStore((state) => state.settings)
  const cli = useSettingsStore((state) => state.cli)
  const speech = useSettingsStore((state) => state.speech)
  const download = useSettingsStore((state) => state.download)
  const error = useSettingsStore((state) => state.error)
  const update = useSettingsStore((state) => state.update)
  const pickWhisper = useSettingsStore((state) => state.pickWhisperExecutable)
  const downloadModel = useSettingsStore((state) => state.downloadModel)
  const cancelDownload = useSettingsStore((state) => state.cancelDownload)

  useEffect(() => {
    if (!isOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isOpen, close])

  if (!isOpen) return null

  return (
    <div onClick={close} className="absolute inset-0 z-50 flex justify-center bg-black/60 p-10">
      <div
        onClick={(event) => event.stopPropagation()}
        className="flex w-[720px] max-w-full flex-col overflow-hidden rounded-lg border border-app-border bg-app-panel"
      >
        <header className="flex items-center border-b border-app-border px-4 py-3">
          <h2 className="text-[14px] font-medium">{t('settings.title')}</h2>
          <button onClick={close} className="ml-auto text-app-muted hover:text-app-text">
            <X size={16} />
          </button>
        </header>

        {settings === null ? (
          <div className="flex items-center gap-2 p-6 text-[12px] text-app-muted">
            <Loader2 size={14} className="animate-spin" /> {t('settings.loading')}
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
            <Section title={t('settings.section.claude')}>
              <Row label={t('settings.detectedPath')}>
                <span className="font-mono text-[11px] break-all">
                  {cli?.ok === true ? cli.executablePath : '—'}
                </span>
              </Row>
              <Row label={t('settings.version')}>
                <span className="text-[12px]">
                  {cli?.ok === true ? (
                    cli.version
                  ) : (
                    <span className="text-app-error">{t('settings.unavailable')}</span>
                  )}
                </span>
              </Row>
              <Row label={t('settings.customPath')} hint={t('settings.customPathHint')}>
                <TextInput
                  value={settings.claudeExecutablePath ?? ''}
                  placeholder={t('settings.customPathPlaceholder')}
                  onCommit={(value) =>
                    void update({ claudeExecutablePath: value === '' ? null : value })
                  }
                />
              </Row>
              <Row label={t('settings.skipPermissions')} hint={t('settings.skipPermissionsHint')}>
                <Toggle
                  checked={settings.skipPermissions}
                  onChange={(value) => void update({ skipPermissions: value })}
                  label={t('settings.skipPermissionsToggle')}
                />
              </Row>
              <Row label={t('settings.extraArgs')} hint={t('settings.extraArgsHint')}>
                <TextInput
                  value={settings.claudeExtraArgs.join(' ')}
                  placeholder={t('settings.extraArgsPlaceholder')}
                  onCommit={(value) =>
                    void update({
                      claudeExtraArgs: value.split(/\s+/).filter((part) => part !== ''),
                    })
                  }
                />
              </Row>
            </Section>

            <Section title={t('settings.section.voice')}>
              <Row label={t('settings.whisperEngine')} hint={t('settings.whisperEngineHint')}>
                <div className="flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate font-mono text-[11px]">
                    {speech?.executablePath ?? t('settings.notSet')}
                  </span>
                  <button
                    onClick={() => void pickWhisper()}
                    className="flex shrink-0 items-center gap-1.5 rounded-md border border-app-border px-2 py-1 text-[11px] hover:bg-app-panel-2"
                  >
                    <FolderSearch size={12} /> {t('settings.pickFile')}
                  </button>
                </div>
              </Row>

              <Row label={t('settings.model')} hint={t('settings.modelHint')}>
                <div className="space-y-1.5">
                  {(speech?.models ?? []).map((model) => {
                    const isActive = settings.whisperModelPath === model.path
                    const isDownloading = download?.modelId === model.id

                    return (
                      <div key={model.id} className="flex items-center gap-2 text-[11px]">
                        <span className="min-w-0 flex-1 truncate">{model.label}</span>
                        <span className="shrink-0 text-app-muted">~{model.approximateMB} MB</span>

                        {isDownloading ? (
                          <>
                            <span className="shrink-0 tabular-nums text-app-muted">
                              {formatSize(download.receivedBytes)}
                              {download.totalBytes !== null &&
                                ` / ${formatSize(download.totalBytes)}`}
                            </span>
                            <button
                              onClick={() => void cancelDownload()}
                              className="shrink-0 rounded border border-app-border px-1.5 py-0.5 hover:bg-app-panel-2"
                            >
                              {t('settings.cancelDownload')}
                            </button>
                          </>
                        ) : model.downloaded ? (
                          isActive ? (
                            <span className="flex shrink-0 items-center gap-1 text-app-ok">
                              <Check size={11} /> {t('settings.active')}
                            </span>
                          ) : (
                            <button
                              onClick={() => void update({ whisperModelPath: model.path })}
                              className="shrink-0 rounded border border-app-border px-1.5 py-0.5 hover:bg-app-panel-2"
                            >
                              {t('settings.use')}
                            </button>
                          )
                        ) : (
                          <button
                            onClick={() => void downloadModel(model.id)}
                            disabled={download !== null}
                            className="flex shrink-0 items-center gap-1 rounded border border-app-border px-1.5 py-0.5 hover:bg-app-panel-2 disabled:opacity-40"
                          >
                            <Download size={11} /> {t('settings.download')}
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </Row>

              <Row label={t('settings.speechLanguage')}>
                <Select
                  value={settings.whisperLanguage}
                  options={[
                    { value: 'auto', label: t('settings.auto') },
                    { value: 'pl', label: t('lang.pl') },
                    { value: 'en', label: t('lang.en') },
                  ]}
                  onChange={(value) => void update({ whisperLanguage: value as WhisperLanguage })}
                />
              </Row>

              <Row label={t('settings.threads')}>
                <NumberInput
                  value={settings.whisperThreads}
                  min={1}
                  max={64}
                  onCommit={(value) => void update({ whisperThreads: value })}
                />
              </Row>
            </Section>

            <Section title={t('settings.section.images')}>
              <Row label={t('settings.injectStrategy')} hint={t('settings.injectHint')}>
                <Select
                  value={settings.imageInjectStrategy}
                  options={[
                    { value: 'bracketed-path', label: t('settings.inject.bracketed') },
                    { value: 'clipboard-paste', label: t('settings.inject.clipboard') },
                    { value: 'plain-path', label: t('settings.inject.plain') },
                  ]}
                  onChange={(value) =>
                    void update({
                      imageInjectStrategy: value as AppSettings['imageInjectStrategy'],
                    })
                  }
                />
              </Row>
              <Row label={t('settings.cacheAge')} hint={t('settings.cacheAgeHint')}>
                <NumberInput
                  value={settings.imageCacheMaxAgeHours}
                  min={1}
                  max={720}
                  onCommit={(value) => void update({ imageCacheMaxAgeHours: value })}
                />
              </Row>
            </Section>

            <Section title={t('settings.section.sessions')}>
              <Row label={t('settings.notifications')} hint={t('settings.notificationsHint')}>
                <Toggle
                  checked={settings.notifyOnWaiting}
                  onChange={(value) => void update({ notifyOnWaiting: value })}
                  label={t('settings.notifyToggle')}
                />
              </Row>
              <Row label={t('settings.healthThresholds')} hint={t('settings.healthHint')}>
                <div className="flex items-center gap-2 text-[11px] text-app-muted">
                  <NumberInput
                    value={settings.healthWarnAt}
                    min={1000}
                    max={2_000_000}
                    onCommit={(value) => void update({ healthWarnAt: value })}
                  />
                  <span>{t('settings.yellowFrom')}</span>
                  <NumberInput
                    value={settings.healthDangerAt}
                    min={1000}
                    max={2_000_000}
                    onCommit={(value) => void update({ healthDangerAt: value })}
                  />
                  <span>{t('settings.redFrom')}</span>
                </div>
              </Row>
              <Row label={t('settings.reopenTabs')} hint={t('settings.reopenTabsHint')}>
                <Toggle
                  checked={settings.reopenTabsOnStart}
                  onChange={(value) => void update({ reopenTabsOnStart: value })}
                  label={t('settings.reopenToggle')}
                />
              </Row>
            </Section>

            <Section title={t('settings.section.appearance')}>
              <Row label={t('settings.fontSize')}>
                <NumberInput
                  value={settings.terminalFontSize}
                  min={8}
                  max={28}
                  onCommit={(value) => void update({ terminalFontSize: value })}
                />
              </Row>
              <Row label={t('settings.fontFamily')}>
                <TextInput
                  value={settings.terminalFontFamily}
                  onCommit={(value) => value !== '' && void update({ terminalFontFamily: value })}
                />
              </Row>
            </Section>
          </div>
        )}

        {error !== null && (
          <footer className="border-t border-app-border px-4 py-2 text-[12px] text-app-error">
            {error}
          </footer>
        )}
      </div>
    </div>
  )
}

function Section({
  title,
  children,
}: {
  title: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-[10px] font-semibold tracking-wider text-app-muted uppercase">
        {title}
      </h3>
      <div className="space-y-3">{children}</div>
    </section>
  )
}

function Row({
  label,
  hint,
  children,
}: {
  label: string
  hint?: string
  children: React.ReactNode
}): React.JSX.Element {
  return (
    <div className="grid grid-cols-[190px_1fr] items-start gap-3">
      <div>
        <div className="pt-1 text-[12px]">{label}</div>
        {hint !== undefined && <div className="text-[10px] text-app-muted">{hint}</div>}
      </div>
      <div>{children}</div>
    </div>
  )
}

/** Zapisuje dopiero po opuszczeniu pola albo Enterze — zapis na każdą literę zalewałby bazę. */
function TextInput({
  value,
  placeholder,
  onCommit,
}: {
  value: string
  placeholder?: string
  onCommit: (value: string) => void
}): React.JSX.Element {
  return (
    <input
      defaultValue={value}
      key={value}
      placeholder={placeholder}
      spellCheck={false}
      onBlur={(event) => onCommit(event.target.value.trim())}
      onKeyDown={(event) => {
        if (event.key === 'Enter') event.currentTarget.blur()
      }}
      className="w-full rounded-md border border-app-border bg-app-panel-2 px-2 py-1 font-mono text-[11px] outline-none focus:border-app-accent-dim"
    />
  )
}

function NumberInput({
  value,
  min,
  max,
  onCommit,
}: {
  value: number
  min: number
  max: number
  onCommit: (value: number) => void
}): React.JSX.Element {
  return (
    <input
      type="number"
      defaultValue={value}
      key={value}
      min={min}
      max={max}
      onBlur={(event) => {
        const parsed = Number(event.target.value)
        if (Number.isFinite(parsed)) onCommit(Math.min(max, Math.max(min, Math.round(parsed))))
      }}
      className="w-[90px] rounded-md border border-app-border bg-app-panel-2 px-2 py-1 text-[12px] outline-none focus:border-app-accent-dim"
    />
  )
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean
  onChange: (value: boolean) => void
  label: string
}): React.JSX.Element {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-[12px]">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="accent-app-accent"
      />
      {label}
    </label>
  )
}

function Select({
  value,
  options,
  onChange,
}: {
  value: string
  options: Array<{ value: string; label: string }>
  onChange: (value: string) => void
}): React.JSX.Element {
  return (
    <select
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-full rounded-md border border-app-border bg-app-panel-2 px-2 py-1 text-[12px] outline-none focus:border-app-accent-dim"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  )
}
