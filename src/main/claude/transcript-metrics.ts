/**
 * Przyrostowe wyciąganie metryk i tekstu rozmowy z transkryptu.
 *
 * `transcript-reader` czyta tylko nagłówek pliku, bo lista sesji nie potrzebuje więcej.
 * Metryki tokenów i indeks pełnotekstowy potrzebują całej treści — ale aktywna sesja
 * dopisuje do pliku po każdej wiadomości, a te pliki mają dziesiątki megabajtów.
 * Dlatego czytamy wyłącznie fragment dopisany od ostatniego przebiegu i doliczamy go
 * do już zapisanych sum.
 *
 * Konsumujemy tylko linie zakończone znakiem nowej linii. Ostatnia, niedokończona linia
 * (Claude Code może właśnie ją pisać) zostaje na następny przebieg — stąd zwracany offset
 * zawsze wskazuje granicę linii.
 */
import { createReadStream } from 'node:fs'

/** Poniżej tej wielkości pojedynczy wynik narzędzia nie trafia na listę największych. */
const LARGE_RESULT_MIN_CHARS = 20_000

/** Tekst jednej wiadomości w indeksie; dłuższe fragmenty to niemal zawsze wklejone pliki. */
const SEARCH_TEXT_MAX_CHARS = 20_000

/** Ile niedomkniętych wywołań narzędzi pamiętamy między przyrostami. */
const PENDING_TOOLS_MAX = 200

export interface ToolAggregate {
  calls: number
  resultChars: number
}

export interface LargeResult {
  toolName: string
  resultChars: number
  timestamp: number | null
}

export interface DailyBucket {
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
  requests: number
}

export interface SearchRow {
  timestamp: number | null
  role: 'user' | 'assistant'
  text: string
}

export interface TranscriptIncrement {
  /** Offset za ostatnią w pełni przetworzoną linią. */
  parsedBytes: number
  inputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  outputTokens: number
  peakContext: number
  requestCount: number
  toolCallCount: number
  firstActivityAt: number | null
  lastActivityAt: number | null
  cwd: string | null
  tools: Map<string, ToolAggregate>
  largeResults: LargeResult[]
  daily: Map<string, DailyBucket>
  /** Wywołania, których wynik jeszcze nie nadszedł — do przekazania następnemu przebiegowi. */
  pendingTools: Record<string, string>
  searchRows: SearchRow[]
}

interface Usage {
  input_tokens?: number
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
  output_tokens?: number
}

interface ContentBlock {
  type?: string
  id?: string
  name?: string
  text?: string
  tool_use_id?: string
  content?: unknown
}

interface Entry {
  type?: string
  cwd?: string
  timestamp?: string
  isSidechain?: boolean
  promptSource?: string
  message?: { usage?: Usage; content?: unknown }
}

/**
 * @param fromByte offset granicy linii, od którego czytać (0 = cały plik)
 * @param pendingTools niedomknięte wywołania z poprzedniego przebiegu
 * @param until opcjonalny koniec odczytu (bajt wyłączny) — używany przez testy do
 *              wymuszenia granicy przyrostu w środku linii
 */
export async function readTranscriptIncrement(
  filePath: string,
  fromByte: number,
  pendingTools: Record<string, string> = {},
  until?: number
): Promise<TranscriptIncrement> {
  const result: TranscriptIncrement = {
    parsedBytes: fromByte,
    inputTokens: 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
    outputTokens: 0,
    peakContext: 0,
    requestCount: 0,
    toolCallCount: 0,
    firstActivityAt: null,
    lastActivityAt: null,
    cwd: null,
    tools: new Map(),
    largeResults: [],
    daily: new Map(),
    pendingTools: { ...pendingTools },
    searchRows: [],
  }

  const stream = createReadStream(filePath, {
    start: fromByte,
    ...(until !== undefined ? { end: until - 1 } : {}),
  })

  let remainder: Buffer = Buffer.alloc(0)

  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const buffer = remainder.length === 0 ? chunk : Buffer.concat([remainder, chunk])
    let start = 0

    for (;;) {
      const newline = buffer.indexOf(0x0a, start)
      if (newline === -1) break

      const lineBytes = newline - start
      processLine(buffer.subarray(start, newline), result)
      result.parsedBytes += lineBytes + 1
      start = newline + 1
    }

    remainder = start < buffer.length ? Buffer.from(buffer.subarray(start)) : Buffer.alloc(0)
  }

  trimPending(result.pendingTools)
  return result
}

function processLine(raw: Buffer, result: TranscriptIncrement): void {
  if (raw.length === 0) return

  let entry: Entry
  try {
    entry = JSON.parse(raw.toString('utf8')) as Entry
  } catch {
    return // uszkodzona linia nie może przerwać zliczania
  }

  result.cwd ??= entry.cwd ?? null

  const timestamp = entry.timestamp ? Date.parse(entry.timestamp) : NaN
  const ts = Number.isFinite(timestamp) ? timestamp : null
  if (ts !== null) {
    result.firstActivityAt = result.firstActivityAt === null ? ts : Math.min(result.firstActivityAt, ts)
    result.lastActivityAt = result.lastActivityAt === null ? ts : Math.max(result.lastActivityAt, ts)
  }

  const content = entry.message?.content
  const blocks = Array.isArray(content) ? (content as ContentBlock[]) : []

  for (const block of blocks) {
    if (typeof block !== 'object' || block === null) continue

    if (block.type === 'tool_use') {
      const name = block.name ?? 'nieznane'
      result.toolCallCount++
      aggregate(result.tools, name).calls++
      if (block.id) result.pendingTools[block.id] = name
      continue
    }

    if (block.type === 'tool_result') {
      const chars = measure(block.content)
      const name = (block.tool_use_id && result.pendingTools[block.tool_use_id]) || 'nieznane'
      if (block.tool_use_id) delete result.pendingTools[block.tool_use_id]

      aggregate(result.tools, name).resultChars += chars
      if (chars >= LARGE_RESULT_MIN_CHARS) {
        result.largeResults.push({ toolName: name, resultChars: chars, timestamp: ts })
      }
    }
  }

  collectSearchText(entry, content, blocks, ts, result)

  if (entry.type !== 'assistant') return
  const usage = entry.message?.usage
  if (!usage) return

  const input = usage.input_tokens ?? 0
  const cacheCreation = usage.cache_creation_input_tokens ?? 0
  const cacheRead = usage.cache_read_input_tokens ?? 0
  const output = usage.output_tokens ?? 0

  result.inputTokens += input
  result.cacheCreationTokens += cacheCreation
  result.cacheReadTokens += cacheRead
  result.outputTokens += output
  result.requestCount++
  result.peakContext = Math.max(result.peakContext, input + cacheCreation + cacheRead)

  if (ts !== null) {
    const bucket = dailyBucket(result.daily, localDay(ts))
    bucket.inputTokens += input
    bucket.cacheCreationTokens += cacheCreation
    bucket.cacheReadTokens += cacheRead
    bucket.outputTokens += output
    bucket.requests++
  }
}

/**
 * Do indeksu trafia tekst rozmowy: prompty wpisane przez użytkownika i odpowiedzi modelu.
 * Wyniki narzędzi celowo pomijamy — to głównie zrzuty plików, a szuka się rozmowy.
 */
function collectSearchText(
  entry: Entry,
  content: unknown,
  blocks: ContentBlock[],
  ts: number | null,
  result: TranscriptIncrement
): void {
  if (entry.isSidechain === true) return

  if (entry.type === 'user') {
    if (entry.promptSource !== 'typed') return
    const text =
      typeof content === 'string'
        ? content
        : blocks
            .filter((block) => block.type === 'text' && typeof block.text === 'string')
            .map((block) => block.text as string)
            .join('\n')
    pushSearchRow(result, ts, 'user', text)
    return
  }

  if (entry.type === 'assistant') {
    const text = blocks
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('\n')
    pushSearchRow(result, ts, 'assistant', text)
  }
}

function pushSearchRow(
  result: TranscriptIncrement,
  ts: number | null,
  role: SearchRow['role'],
  text: string
): void {
  const cleaned = text
    // Bloki systemowe wstrzykiwane do promptu nie są treścią rozmowy.
    .replace(/<[a-z-]+>[\s\S]*?<\/[a-z-]+>/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
  if (cleaned === '') return
  result.searchRows.push({ timestamp: ts, role, text: cleaned.slice(0, SEARCH_TEXT_MAX_CHARS) })
}

/** Rozmiar wyniku narzędzia w znakach — przybliżenie tokenów, nie ich dokładna liczba. */
function measure(content: unknown): number {
  if (typeof content === 'string') return content.length
  if (Array.isArray(content)) {
    let total = 0
    for (const item of content) {
      if (typeof item === 'string') total += item.length
      else if (item && typeof item === 'object' && typeof (item as { text?: unknown }).text === 'string') {
        total += ((item as { text: string }).text).length
      } else total += JSON.stringify(item ?? '').length
    }
    return total
  }
  return content === undefined || content === null ? 0 : JSON.stringify(content).length
}

function aggregate(map: Map<string, ToolAggregate>, name: string): ToolAggregate {
  let entry = map.get(name)
  if (!entry) {
    entry = { calls: 0, resultChars: 0 }
    map.set(name, entry)
  }
  return entry
}

function dailyBucket(map: Map<string, DailyBucket>, day: string): DailyBucket {
  let bucket = map.get(day)
  if (!bucket) {
    bucket = { inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0, requests: 0 }
    map.set(day, bucket)
  }
  return bucket
}

/** Dzień w czasie lokalnym — użytkownik myśli o „dzisiaj" w swojej strefie, nie w UTC. */
export function localDay(timestamp: number): string {
  const date = new Date(timestamp)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function trimPending(pending: Record<string, string>): void {
  const keys = Object.keys(pending)
  if (keys.length <= PENDING_TOOLS_MAX) return
  for (const key of keys.slice(0, keys.length - PENDING_TOOLS_MAX)) delete pending[key]
}
