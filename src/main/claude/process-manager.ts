/**
 * Zarządza cyklem życia procesów `claude` uruchomionych w PTY.
 *
 * Renderer nigdy nie podaje ścieżki executable ani surowego argv — wysyła tylko tryb
 * i katalog, a argumenty składane są tutaj z zamkniętego zbioru (§24 planu).
 */
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { resolve as resolvePath } from 'node:path'
import * as pty from 'node-pty'
import type { AppSettings } from '@shared/settings'
import type { PtyCreateRequest, PtyExitEvent, PtyInfo, PtyStatusEvent } from '@shared/types'
import { locateClaudeCli } from './locator'
import { tMain } from '@main/i18n'

/** Jedna klatka — strumień z TUI potrafi generować setki zdarzeń na sekundę. */
const FLUSH_INTERVAL_MS = 16

/** Cisza dłuższa niż to oznacza, że Claude czeka na input, a nie pracuje. */
const IDLE_THRESHOLD_MS = 800

/**
 * Zmienne opisujące konkretną sesję-rodzica Claude Code.
 *
 * Gdy aplikacja zostanie uruchomiona z wnętrza sesji Claude Code (co robi się nagminnie
 * w trakcie developmentu), potomny proces dziedziczy te markery i wchodzi w tryb sesji
 * podrzędnej: przestaje zapisywać transkrypt, przez co nasze wykrywanie sesji nic nie znajduje.
 *
 * Lista jest jawna, nie oparta na prefiksie — pod `CLAUDE_*` kryją się też ustawienia
 * użytkownika (np. `CLAUDE_CONFIG_DIR`), których kasować nie wolno.
 */
const PARENT_SESSION_ENV_VARS = [
  'CLAUDECODE',
  'CLAUDE_CODE_BRIDGE_SESSION_ID',
  'CLAUDE_CODE_CHILD_SESSION',
  'CLAUDE_CODE_ENTRYPOINT',
  'CLAUDE_CODE_EXECPATH',
  'CLAUDE_CODE_MESSAGING_SOCKET',
  'CLAUDE_CODE_MESSAGING_TOKEN',
  'CLAUDE_CODE_SESSION_ID',
  'CLAUDE_EFFORT',
  'CLAUDE_PID',
] as const

function buildEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
    FORCE_COLOR: '3',
  }
  for (const key of PARENT_SESSION_ENV_VARS) delete env[key]
  return env
}

interface Session {
  info: PtyInfo
  process: pty.IPty
  buffer: string[]
  flushTimer: NodeJS.Timeout | null
  idleTimer: NodeJS.Timeout | null
  lastStatus: PtyStatusEvent['status']
}

export interface ProcessManagerEvents {
  onData(ptyId: string, chunk: string): void
  /** Wejście od użytkownika (klawiatura, wklejenie, wysyłka obrazów) — przed zapisem do PTY. */
  onInput?(ptyId: string, data: string): void
  onExit(event: PtyExitEvent): void
  onStatus(event: PtyStatusEvent): void
}

export class ClaudeProcessManager {
  private readonly sessions = new Map<string, Session>()

  /**
   * @param getSettings odczytywane przy każdym starcie procesu, żeby zmiana w Ustawieniach
   *                    działała bez restartu aplikacji
   */
  constructor(
    private readonly events: ProcessManagerEvents,
    private readonly getSettings: () => AppSettings
  ) {}

  /**
   * @throws gdy Claude Code nie jest dostępny albo `cwd` nie wskazuje na istniejący katalog
   */
  async create(request: PtyCreateRequest): Promise<PtyInfo> {
    const settings = this.getSettings()
    const cli = await locateClaudeCli(settings.claudeExecutablePath ?? undefined)
    if (!cli.ok) {
      throw new Error(tMain('err.claudeUnavailable', { detail: cli.detail }))
    }

    const cwd = this.validateCwd(request.cwd)
    const { args, sessionId } = buildArgs(request)
    // Flaga dotyczy każdego trybu: także wznowiona czy sforkowana sesja ma nie pytać o zgody.
    if (settings.skipPermissions) args.push('--dangerously-skip-permissions')
    args.push(...settings.claudeExtraArgs)

    const child = pty.spawn(cli.executablePath, args, {
      name: 'xterm-256color',
      cols: request.cols,
      rows: request.rows,
      cwd,
      env: buildEnv(),
      useConpty: true,
    })

    const info: PtyInfo = {
      ptyId: randomUUID(),
      pid: child.pid,
      cwd,
      mode: request.mode,
      sessionId,
      startedAt: Date.now(),
    }

    const session: Session = {
      info,
      process: child,
      buffer: [],
      flushTimer: null,
      idleTimer: null,
      lastStatus: 'running',
    }
    this.sessions.set(info.ptyId, session)

    child.onData((chunk) => this.handleData(session, chunk))
    child.onExit(({ exitCode, signal }) => this.handleExit(session, exitCode, signal ?? null))

    return info
  }

  write(ptyId: string, data: string): void {
    const session = this.require(ptyId)
    this.events.onInput?.(ptyId, data)
    session.process.write(data)
  }

  resize(ptyId: string, cols: number, rows: number): void {
    this.require(ptyId).process.resize(cols, rows)
  }

  kill(ptyId: string): void {
    const session = this.sessions.get(ptyId)
    if (!session) return
    session.process.kill()
  }

  killAll(): void {
    for (const ptyId of [...this.sessions.keys()]) this.kill(ptyId)
  }

  get(ptyId: string): PtyInfo | undefined {
    return this.sessions.get(ptyId)?.info
  }

  /** Ile terminali działa w każdym katalogu — zasila znacznik "uruchomiona" na liście projektów. */
  runningCountByCwd(): Map<string, number> {
    const counts = new Map<string, number>()
    for (const session of this.sessions.values()) {
      counts.set(session.info.cwd, (counts.get(session.info.cwd) ?? 0) + 1)
    }
    return counts
  }

  // --- wewnętrzne ---

  private require(ptyId: string): Session {
    const session = this.sessions.get(ptyId)
    if (!session) throw new Error(tMain('err.unknownTerminal', { id: ptyId }))
    return session
  }

  private validateCwd(raw: string): string {
    const cwd = resolvePath(raw)
    let isDirectory = false
    try {
      isDirectory = statSync(cwd).isDirectory()
    } catch {
      throw new Error(tMain('err.dirMissing', { path: cwd }))
    }
    if (!isDirectory) throw new Error(tMain('err.notADirectory', { path: cwd }))
    return cwd
  }

  /** Zbiera wyjście w buforze i wysyła je jedną paczką na klatkę — inaczej IPC staje się wąskim gardłem. */
  private handleData(session: Session, chunk: string): void {
    session.buffer.push(chunk)
    this.markRunning(session)

    if (session.flushTimer) return
    session.flushTimer = setTimeout(() => {
      session.flushTimer = null
      const payload = session.buffer.join('')
      session.buffer.length = 0
      if (payload) this.events.onData(session.info.ptyId, payload)
    }, FLUSH_INTERVAL_MS)
  }

  /**
   * Status wyliczamy wyłącznie z aktywności strumienia i faktu życia procesu.
   * Celowo nie parsujemy TUI (§20 planu).
   */
  private markRunning(session: Session): void {
    this.emitStatus(session, 'running')
    if (session.idleTimer) clearTimeout(session.idleTimer)
    session.idleTimer = setTimeout(() => {
      this.emitStatus(session, 'waiting')
    }, IDLE_THRESHOLD_MS)
  }

  private emitStatus(session: Session, status: PtyStatusEvent['status']): void {
    if (session.lastStatus === status) return
    session.lastStatus = status
    this.events.onStatus({ ptyId: session.info.ptyId, status })
  }

  private handleExit(session: Session, exitCode: number, signal: number | null): void {
    if (session.flushTimer) clearTimeout(session.flushTimer)
    if (session.idleTimer) clearTimeout(session.idleTimer)

    const remaining = session.buffer.join('')
    if (remaining) this.events.onData(session.info.ptyId, remaining)

    this.sessions.delete(session.info.ptyId)
    this.emitStatusAfterExit(session)
    this.events.onExit({ ptyId: session.info.ptyId, exitCode, signal })
  }

  private emitStatusAfterExit(session: Session): void {
    session.lastStatus = 'closed'
    this.events.onStatus({ ptyId: session.info.ptyId, status: 'closed' })
  }
}

/**
 * Składa argumenty CLI dla wybranego trybu.
 *
 * Przy `new` nadajemy własny `--session-id`, dzięki czemu znamy identyfikator sesji
 * natychmiast, zamiast zgadywać go później po dacie modyfikacji plików transkryptów.
 */
function buildArgs(request: PtyCreateRequest): { args: string[]; sessionId: string | null } {
  switch (request.mode) {
    case 'new': {
      const sessionId = randomUUID()
      return { args: ['--session-id', sessionId], sessionId }
    }
    case 'continue':
      // Claude sam wybiera ostatnią rozmowę w tym katalogu — ID poznamy dopiero z transkryptu.
      return { args: ['--continue'], sessionId: null }
    case 'resume':
      return { args: ['--resume', request.sessionId!], sessionId: request.sessionId! }
    case 'fork':
      // Oryginalna sesja zostaje nietknięta, Claude nadaje forkowi nowe ID.
      return { args: ['--resume', request.sessionId!, '--fork-session'], sessionId: null }
  }
}
