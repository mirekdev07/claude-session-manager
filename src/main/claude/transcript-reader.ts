/**
 * Wyciąga metadane sesji z pliku transkryptu Claude Code (`<uuid>.jsonl`).
 *
 * Transkrypty potrafią mieć dziesiątki megabajtów, a my potrzebujemy z nich kilku pól.
 * Dlatego czytamy strumieniowo tylko początek pliku i przerywamy, gdy mamy komplet danych.
 *
 * To jedyne miejsce w aplikacji, które zna wewnętrzny format plików Claude Code (§3 planu).
 */
import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { basename } from 'node:path'
import { createInterface } from 'node:readline'

/** Poza tym limitem przestajemy szukać — pierwszy prompt użytkownika zawsze jest wcześniej. */
const MAX_HEAD_LINES = 400
const MAX_HEAD_BYTES = 1_000_000
const MAX_TITLE_LENGTH = 120

export interface SessionMetadata {
  sessionId: string
  filePath: string
  /** Katalog roboczy sesji — źródło prawdy dla przypisania sesji do projektu. */
  cwd: string | null
  gitBranch: string | null
  /** Wersja Claude Code, która utworzyła sesję. */
  claudeVersion: string | null
  /** Pierwszy prompt wpisany przez użytkownika; `null`, gdy sesja nie ma jeszcze treści. */
  title: string | null
  createdAt: number
  lastActivityAt: number
  sizeBytes: number
}

/** Kształt wpisów, które nas interesują. Reszta pól transkryptu jest celowo ignorowana. */
interface TranscriptEntry {
  type?: string
  sessionId?: string
  cwd?: string
  gitBranch?: string
  version?: string
  isSidechain?: boolean
  promptSource?: string
  message?: { content?: unknown }
}

export async function readSessionMetadata(filePath: string): Promise<SessionMetadata | null> {
  let stats: Awaited<ReturnType<typeof stat>>
  try {
    stats = await stat(filePath)
  } catch {
    return null // plik zniknął między listowaniem katalogu a odczytem
  }
  if (!stats.isFile() || stats.size === 0) return null

  const head = await readHead(filePath)

  return {
    sessionId: head.sessionId ?? basename(filePath, '.jsonl'),
    filePath,
    cwd: head.cwd,
    gitBranch: head.gitBranch,
    claudeVersion: head.claudeVersion,
    title: head.title,
    createdAt: stats.birthtimeMs,
    // mtime jest pewniejsze niż ostatnia linia pliku: bywa nią wpis sterujący bez znacznika czasu.
    lastActivityAt: stats.mtimeMs,
    sizeBytes: stats.size,
  }
}

interface HeadResult {
  sessionId: string | null
  cwd: string | null
  gitBranch: string | null
  claudeVersion: string | null
  title: string | null
}

async function readHead(filePath: string): Promise<HeadResult> {
  const result: HeadResult = {
    sessionId: null,
    cwd: null,
    gitBranch: null,
    claudeVersion: null,
    title: null,
  }

  const stream = createReadStream(filePath, { encoding: 'utf8', end: MAX_HEAD_BYTES })
  const lines = createInterface({ input: stream, crlfDelay: Infinity })

  let lineCount = 0
  try {
    for await (const line of lines) {
      if (++lineCount > MAX_HEAD_LINES) break
      if (line.length === 0) continue

      let entry: TranscriptEntry
      try {
        entry = JSON.parse(line) as TranscriptEntry
      } catch {
        continue // uszkodzona linia nie może zablokować odczytu całej sesji
      }

      result.sessionId ??= entry.sessionId ?? null
      result.cwd ??= entry.cwd ?? null
      result.gitBranch ??= normalizeBranch(entry.gitBranch)
      result.claudeVersion ??= entry.version ?? null

      // `promptSource: 'typed'` odróżnia prawdziwy prompt użytkownika od treści
      // wstrzykniętych przez hooki i mechanizmy systemowe.
      if (
        result.title === null &&
        entry.type === 'user' &&
        entry.promptSource === 'typed' &&
        entry.isSidechain !== true
      ) {
        result.title = extractTitle(entry.message?.content)
      }

      if (result.cwd !== null && result.title !== null && result.gitBranch !== null) break
    }
  } finally {
    lines.close()
    stream.destroy()
  }

  return result
}

/**
 * Dla katalogów spoza repozytorium Claude Code zapisuje `gitBranch: "HEAD"`.
 * To nie jest nazwa gałęzi, tylko brak informacji — w interfejsie byłoby mylące.
 */
function normalizeBranch(branch: string | undefined): string | null {
  if (!branch || branch === 'HEAD') return null
  return branch
}

/** Zamienia treść wiadomości (string albo tablica bloków) na jednolinijkowy tytuł. */
function extractTitle(content: unknown): string | null {
  const raw = flattenContent(content)
  if (raw === null) return null

  const cleaned = raw
    // Bloki systemowe (`<system-reminder>`, `<command-name>`) nie są częścią promptu użytkownika.
    .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()

  if (cleaned === '') return null
  return cleaned.length > MAX_TITLE_LENGTH ? `${cleaned.slice(0, MAX_TITLE_LENGTH - 1)}…` : cleaned
}

function flattenContent(content: unknown): string | null {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return null

  const texts = content
    .filter(
      (block): block is { type: string; text: string } =>
        typeof block === 'object' &&
        block !== null &&
        (block as { type?: unknown }).type === 'text' &&
        typeof (block as { text?: unknown }).text === 'string'
    )
    .map((block) => block.text)

  return texts.length > 0 ? texts.join(' ') : null
}
