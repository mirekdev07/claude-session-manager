/** Minimalna wersja lokatora na potrzeby testu dymnego (pełna wersja żyje w src/main/claude/locator.ts). */
import { execFile } from 'node:child_process'
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

export async function locateClaude() {
  const appData = process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')
  const native = join(appData, 'npm', 'node_modules', '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')
  if (existsSync(native)) return native

  try {
    const { stdout } = await execFileAsync('where', ['claude'], { timeout: 5000 })
    for (const line of stdout.split(/\r?\n/)) {
      const path = line.trim()
      if (path && !/\.(cmd|ps1|bat)$/i.test(path) && statSync(path).isFile()) return path
    }
  } catch {
    /* brak w PATH */
  }

  return null
}
