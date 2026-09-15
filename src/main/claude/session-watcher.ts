/**
 * Obserwuje katalog transkryptów, żeby lista sesji odświeżała się sama.
 *
 * Claude Code dopisuje do pliku po każdej wiadomości, więc zdarzenia sypią się gęsto.
 * Zbieramy je i przetwarzamy paczkami, zamiast czytać plik po każdym dopisanym bajcie.
 */
import chokidar, { type FSWatcher } from 'chokidar'
import type { ClaudeSessionProvider } from './session-provider'
import { claudeProjectsRoot } from './session-provider'

const BATCH_DELAY_MS = 500

export class SessionWatcher {
  private watcher: FSWatcher | null = null
  private readonly pending = new Set<string>()
  private timer: NodeJS.Timeout | null = null

  /**
   * @param onChange dostaje ścieżki projektów, których sesje się zmieniły
   */
  constructor(
    private readonly provider: ClaudeSessionProvider,
    private readonly onChange: (projectPaths: string[]) => void
  ) {}

  start(): void {
    if (this.watcher) return

    this.watcher = chokidar.watch(claudeProjectsRoot(), {
      // Interesują nas tylko transkrypty; katalog zawiera też podfoldery `memory`.
      ignored: (path, stats) => Boolean(stats?.isFile()) && !path.endsWith('.jsonl'),
      ignoreInitial: true,
      depth: 2,
      awaitWriteFinish: { stabilityThreshold: 300, pollInterval: 100 },
    })

    for (const event of ['add', 'change', 'unlink'] as const) {
      this.watcher.on(event, (path: string) => this.enqueue(path))
    }
  }

  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer)
    this.timer = null
    this.pending.clear()
    await this.watcher?.close()
    this.watcher = null
  }

  private enqueue(filePath: string): void {
    this.pending.add(filePath)
    if (this.timer) return
    this.timer = setTimeout(() => void this.flush(), BATCH_DELAY_MS)
  }

  private async flush(): Promise<void> {
    this.timer = null
    const files = [...this.pending]
    this.pending.clear()

    const affected = new Set<string>()
    for (const filePath of files) {
      // Ścieżkę projektu odczytujemy przed odświeżeniem, żeby znać ją także dla plików usuniętych.
      const before = this.projectPathOf(filePath)
      await this.provider.refresh(filePath)
      const after = this.projectPathOf(filePath)

      if (before) affected.add(before)
      if (after) affected.add(after)
    }

    if (affected.size > 0) this.onChange([...affected])
  }

  private projectPathOf(filePath: string): string | null {
    return this.provider.projectPathForTranscript(filePath)
  }
}
