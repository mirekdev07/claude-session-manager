/**
 * Sprawdza parser przyrostowy metryk na prawdziwych transkryptach.
 *
 * Kluczowa właściwość: sumy z parsowania w kilku przyrostach — z granicami wymuszonymi
 * w środku linii — muszą zgadzać się co do tokena z parsowaniem całego pliku od zera.
 * Bez tego metryki aktywnej sesji rozjeżdżałyby się z każdym dopiskiem.
 *
 * Uruchomienie: npm run verify:metrics
 */
import { readdir, stat } from 'node:fs/promises'
import { homedir } from 'node:os'
import { basename, join } from 'node:path'
import { cleanupCompiled, importFromSource } from './lib/compile.mjs'

const { readTranscriptIncrement } = await importFromSource('src/main/claude/transcript-metrics.ts')

const root = join(homedir(), '.claude', 'projects')
const candidates = []
for (const dir of await readdir(root, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  for (const file of await readdir(join(root, dir.name), { withFileTypes: true })) {
    if (!file.isFile() || !file.name.endsWith('.jsonl')) continue
    const path = join(root, dir.name, file.name)
    candidates.push({ path, size: (await stat(path)).size })
  }
}
candidates.sort((a, b) => b.size - a.size)
const sample = candidates.slice(0, 4)

let failures = 0
const started = Date.now()

for (const { path, size } of sample) {
  const whole = await readTranscriptIncrement(path, 0)

  // Trzy przyrosty z granicami celowo w środku linii — parser ma je sam przesunąć do granicy linii.
  const cuts = [Math.floor(size * 0.37), Math.floor(size * 0.71)]
  const first = await readTranscriptIncrement(path, 0, {}, cuts[0])
  const second = await readTranscriptIncrement(path, first.parsedBytes, first.pendingTools, cuts[1])
  const third = await readTranscriptIncrement(path, second.parsedBytes, second.pendingTools)

  const sum = (key) => first[key] + second[key] + third[key]
  const merged = {
    inputTokens: sum('inputTokens'),
    cacheCreationTokens: sum('cacheCreationTokens'),
    cacheReadTokens: sum('cacheReadTokens'),
    outputTokens: sum('outputTokens'),
    requestCount: sum('requestCount'),
    toolCallCount: sum('toolCallCount'),
    peakContext: Math.max(first.peakContext, second.peakContext, third.peakContext),
    parsedBytes: third.parsedBytes,
    searchRows: first.searchRows.length + second.searchRows.length + third.searchRows.length,
  }

  const mergedTools = new Map()
  for (const part of [first, second, third]) {
    for (const [name, agg] of part.tools) {
      const cur = mergedTools.get(name) ?? { calls: 0, resultChars: 0 }
      cur.calls += agg.calls
      cur.resultChars += agg.resultChars
      mergedTools.set(name, cur)
    }
  }
  let toolMismatch = 0
  for (const [name, agg] of whole.tools) {
    const m = mergedTools.get(name)
    if (!m || m.calls !== agg.calls || m.resultChars !== agg.resultChars) toolMismatch++
  }

  const checks = [
    ['input_tokens', whole.inputTokens, merged.inputTokens],
    ['cache_creation', whole.cacheCreationTokens, merged.cacheCreationTokens],
    ['cache_read', whole.cacheReadTokens, merged.cacheReadTokens],
    ['output_tokens', whole.outputTokens, merged.outputTokens],
    ['requests', whole.requestCount, merged.requestCount],
    ['tool_calls', whole.toolCallCount, merged.toolCallCount],
    ['peak_context', whole.peakContext, merged.peakContext],
    ['parsed_bytes', whole.parsedBytes, merged.parsedBytes],
    ['search_rows', whole.searchRows.length, merged.searchRows],
    ['narzędzia (rozbieżne)', 0, toolMismatch],
  ]

  const bad = checks.filter(([, a, b]) => a !== b)
  failures += bad.length
  const mb = (size / 1024 / 1024).toFixed(1)
  console.log(`${bad.length === 0 ? '[OK]  ' : '[FAIL]'} ${basename(path).slice(0, 8)}  ${mb.padStart(6)} MB  ` +
    `req=${whole.requestCount}  peak=${Math.round(whole.peakContext / 1000)}k  tools=${whole.tools.size}  ` +
    `pending_po_1=${Object.keys(first.pendingTools).length}`)
  for (const [name, a, b] of bad) console.log(`        ${name}: całość=${a} przyrosty=${b}`)

  // Granica przyrostu ma wypadać na końcu linii, nie w jej środku.
  if (first.parsedBytes > cuts[0] || second.parsedBytes > cuts[1]) {
    failures++
    console.log('        [FAIL] offset przyrostu przekroczył zadaną granicę')
  }
  // Plik niedopisany po ostatnim znaku nowej linii musi zostać w całości skonsumowany.
  if (whole.parsedBytes !== size) {
    console.log(`        uwaga: ostatnia linia bez znaku nowej linii (${size - whole.parsedBytes} B zostaje na następny przebieg)`)
  }
}

console.log(`\nCzas: ${Date.now() - started} ms dla ${sample.length} największych transkryptów`)
console.log(failures === 0 ? '=== WSZYSTKO PRZESZŁO ===' : `=== NIEUDANE: ${failures} ===`)
cleanupCompiled()
process.exit(failures === 0 ? 0 : 1)
