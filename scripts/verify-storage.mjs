/**
 * Sprawdza schemat bazy i zapytania warstwy cache na tymczasowej bazie SQLite.
 *
 * Uruchomienie: ELECTRON_RUN_AS_NODE=1 electron scripts/verify-storage.mjs
 * (better-sqlite3 to moduł natywny — musi działać pod ABI Electrona, nie systemowego Node)
 */
import { createRequire } from 'node:module'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { cleanupCompiled, importFromSource } from './lib/compile.mjs'

const { MIGRATIONS, migrate } = await importFromSource('src/main/storage/migrations.ts')
const { SessionCache } = await importFromSource('src/main/storage/session-cache.ts')

const require = createRequire(import.meta.url)
const Database = require('better-sqlite3')

const file = join(tmpdir(), `csm-verify-${Date.now()}.db`)
const results = []
const check = (name, fn) => {
  try {
    results.push({ name, ok: true, detail: fn() })
  } catch (error) {
    results.push({ name, ok: false, detail: error.message })
  }
}

const db = new Database(file)
db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

check('Migracje wykonują się od zera', () => {
  migrate(db)
  const version = db.pragma('user_version', { simple: true })
  if (version !== MIGRATIONS.length) throw new Error(`user_version=${version}`)
  return `user_version = ${version}`
})

check('Powstały wszystkie tabele', () => {
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
    .all()
    .map((row) => row.name)
    .sort()
  const expected = ['open_tabs', 'projects', 'session_cache', 'session_meta', 'settings']
  const missing = expected.filter((name) => !tables.includes(name))
  if (missing.length > 0) throw new Error(`brakuje: ${missing.join(', ')}`)
  return tables.join(', ')
})

check('Ponowna migracja jest bezpieczna (idempotencja)', () => {
  migrate(db)
  return 'druga migracja nic nie zmieniła'
})

const cache = new SessionCache(db)
const base = {
  sessionId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
  cwd: 'D:\\Projekty\\Przyklad',
  gitBranch: 'main',
  claudeVersion: '2.1.257',
  createdAt: 1_700_000_000_000,
  lastActivityAt: 1_700_000_100_000,
}

check('Zapis i odczyt wpisu cache', () => {
  cache.put(
    { ...base, filePath: 'C:\\p\\dir\\a.jsonl', title: 'Pierwszy prompt', sizeBytes: 5000 },
    111
  )
  const fresh = cache.getFresh('C:\\p\\dir\\a.jsonl', 111, 5000)
  if (!fresh) throw new Error('Wpis nie został odczytany')
  if (fresh.title !== 'Pierwszy prompt') throw new Error('Zły tytuł')
  return `title="${fresh.title}"`
})

check('Zmiana mtime unieważnia cache', () => {
  if (cache.getFresh('C:\\p\\dir\\a.jsonl', 999, 5000)) throw new Error('Zwrócono nieświeży wpis')
  return 'nieświeży wpis odrzucony'
})

check('Puste sesje nie trafiają na listę', () => {
  cache.put(
    { ...base, sessionId: 'pusta', filePath: 'C:\\p\\dir\\b.jsonl', title: null, sizeBytes: 146 },
    222
  )
  const listed = cache.listByCwd(base.cwd)
  if (listed.length !== 1) throw new Error(`Oczekiwano 1 wpisu, jest ${listed.length}`)
  return '146-bajtowa sesja bez tytułu pominięta'
})

check('Statystyki zgadzają się z listą', () => {
  const summary = cache.summarizeByCwd()
  const entry = summary.find((row) => row.cwd === base.cwd)
  if (entry?.session_count !== 1) throw new Error(`session_count=${entry?.session_count}`)
  return `${entry.session_count} sesja w ${entry.cwd}`
})

check('Dziedziczenie cwd po katalogu (ścieżki Windows w LIKE)', () => {
  const found = cache.getCwdInDirectory('C:\\p\\dir\\')
  if (found !== base.cwd) throw new Error(`otrzymano ${found}`)

  // Backslash i podkreślenie muszą być zaescape'owane, inaczej LIKE dopasuje obcy katalog.
  const other = cache.getCwdInDirectory('C:\\p\\di_\\')
  if (other !== null) throw new Error('Wieloznacznik LIKE nie został zaescape\'owany')
  return 'prefiks katalogu dopasowany dosłownie'
})

const increment = (over) => ({
    parsedBytes: 0, inputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0, outputTokens: 0,
    peakContext: 0, requestCount: 0, toolCallCount: 0, firstActivityAt: null, lastActivityAt: null,
    cwd: base.cwd, tools: new Map(), largeResults: [], daily: new Map(), pendingTools: {}, searchRows: [],
    ...over,
  })

check('Przyrost metryk dolicza się do sum i kubełków dziennych', () => {
  const day = new Date().toISOString().slice(0, 10)
  cache.put({ ...base, sessionId: 'm1', filePath: 'C:\\p\\dir\\m.jsonl', title: 'Metryki', sizeBytes: 9000 }, 1)

  cache.applyIncrement('C:\\p\\dir\\m.jsonl', 'm1', increment({
    parsedBytes: 4000, inputTokens: 100, cacheReadTokens: 50_000, outputTokens: 20, peakContext: 50_100,
    requestCount: 1, toolCallCount: 2,
    tools: new Map([['Read', { calls: 2, resultChars: 30_000 }]]),
    largeResults: [{ toolName: 'Read', resultChars: 25_000, timestamp: Date.now() }],
    daily: new Map([[day, { inputTokens: 100, cacheCreationTokens: 0, cacheReadTokens: 50_000, outputTokens: 20, requests: 1 }]]),
    searchRows: [{ timestamp: Date.now(), role: 'user', text: 'napraw webhook stripe w handlerze' }],
  }), false)
  cache.applyIncrement('C:\\p\\dir\\m.jsonl', 'm1', increment({
    parsedBytes: 9000, inputTokens: 200, cacheReadTokens: 160_000, outputTokens: 30, peakContext: 160_200,
    requestCount: 1, toolCallCount: 1,
    tools: new Map([['Read', { calls: 1, resultChars: 10_000 }], ['Bash', { calls: 1, resultChars: 500 }]]),
    daily: new Map([[day, { inputTokens: 200, cacheCreationTokens: 0, cacheReadTokens: 160_000, outputTokens: 30, requests: 1 }]]),
    searchRows: [{ timestamp: Date.now(), role: 'assistant', text: 'Poprawiłem obsługę webhooka' }],
  }), false)

  const row = cache.getBySession('m1')
  if (row.parsed_bytes !== 9000) throw new Error(`parsed_bytes=${row.parsed_bytes}`)
  if (row.input_tokens !== 300 || row.cache_read_tokens !== 210_000) throw new Error('sumy tokenów nie zgadzają się')
  if (row.peak_context !== 160_200) throw new Error(`peak=${row.peak_context}`)
  if (row.request_count !== 2 || row.tool_call_count !== 3) throw new Error('liczniki nie zgadzają się')

  const tools = cache.toolUsage('m1')
  const read = tools.find((t) => t.tool_name === 'Read')
  if (!read || read.calls !== 3 || read.result_chars !== 40_000) throw new Error('agregacja narzędzi nie zgadza się')

  const usage = cache.usageByProject(day)
  const project = usage.find((u) => u.cwd === base.cwd)
  if (!project || project.requests !== 2 || project.max_peak_context !== 160_200) throw new Error('kubełki dzienne nie zgadzają się')
  return `parsed=${row.parsed_bytes}, tokeny=${row.input_tokens + row.cache_read_tokens + row.output_tokens}, Read=${read.calls}×, projekt=${project.requests} zap.`
})

check('Wyszukiwanie pełnotekstowe znajduje prefiksy i polskie znaki', () => {
  const hits = cache.search('{text folded} : ("webhook"*)', 10)
  if (hits.length !== 2) throw new Error(`trafień: ${hits.length}`)
  if (!hits.some((h) => h.snippet.includes('⟦'))) throw new Error('brak podświetlenia')
  const polish = cache.search('{text folded} : ("poprawilem"*)', 10)
  if (polish.length !== 1) throw new Error('remove_diacritics nie działa: "poprawilem" powinno trafić "Poprawiłem"')
  return `${hits.length} trafienia, diakrytyki ignorowane`
})

check('Reset metryk po skróceniu pliku zeruje wszystko', () => {
  cache.applyIncrement('C:\\p\\dir\\m.jsonl', 'm1', increment({ parsedBytes: 100, requestCount: 1, inputTokens: 5, peakContext: 5 }), true)
  const row = cache.getBySession('m1')
  if (row.input_tokens !== 5 || row.request_count !== 1 || row.peak_context !== 5) throw new Error('reset nie wyzerował sum')
  if (cache.toolUsage('m1').length !== 0) throw new Error('reset nie wyczyścił narzędzi')
  if (cache.search('{text folded} : ("webhook"*)', 10).length !== 0) throw new Error('reset nie wyczyścił indeksu')
  return 'sumy, narzędzia i indeks wyzerowane'
})

check('Usunięcie transkryptu czyści cache', () => {
  cache.remove('C:\\p\\dir\\a.jsonl')
  if (cache.getBySession(base.sessionId) !== null) throw new Error('Wpis został')
  return 'wpis usunięty'
})

db.close()
cleanupCompiled()
for (const suffix of ['', '-wal', '-shm']) rmSync(`${file}${suffix}`, { force: true })

for (const { name, ok, detail } of results) {
  console.log(`${ok ? '[OK]  ' : '[FAIL]'} ${name} — ${detail}`)
}
const failed = results.filter((result) => !result.ok).length
console.log(`\n=== ${failed === 0 ? 'WSZYSTKO PRZESZŁO' : `NIEUDANE: ${failed}`} ===`)
process.exit(failed === 0 ? 0 : 1)
