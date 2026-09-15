/**
 * Odczyt aktualnego brancha.
 *
 * Świadomie bez uruchamiania `git` — lista projektów potrafi mieć kilkadziesiąt pozycji,
 * a odpalenie tylu procesów przy każdym odświeżeniu byłoby wolne i wymagałoby gita w PATH.
 * Nazwa brancha stoi wprost w `.git/HEAD`, więc wystarczy odczyt jednego małego pliku.
 */
import { readFile } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'

/**
 * @returns nazwa brancha, skrócony SHA przy odłączonym HEAD, albo `null` gdy to nie jest repozytorium
 */
export async function readGitBranch(projectPath: string): Promise<string | null> {
  const gitDir = await resolveGitDir(projectPath)
  if (gitDir === null) return null

  let head: string
  try {
    head = (await readFile(join(gitDir, 'HEAD'), 'utf8')).trim()
  } catch {
    return null
  }

  const ref = /^ref:\s*refs\/heads\/(.+)$/.exec(head)
  if (ref?.[1]) return ref[1]

  // Odłączony HEAD — w pliku stoi surowy SHA.
  return /^[0-9a-f]{40}$/i.test(head) ? head.slice(0, 7) : null
}

/**
 * Zwraca katalog z danymi gita. W zwykłym repozytorium to `.git/`, ale w worktree
 * i submodule `.git` jest plikiem z wpisem `gitdir: <ścieżka>`.
 */
async function resolveGitDir(projectPath: string): Promise<string | null> {
  const dotGit = join(projectPath, '.git')

  let content: string
  try {
    content = await readFile(dotGit, 'utf8')
  } catch (error) {
    // EISDIR oznacza zwykłe repozytorium — `.git` jest katalogiem, nie plikiem.
    return (error as NodeJS.ErrnoException).code === 'EISDIR' ? dotGit : null
  }

  const pointer = /^gitdir:\s*(.+)$/m.exec(content)?.[1]?.trim()
  if (!pointer) return null

  return isAbsolute(pointer) ? pointer : resolve(projectPath, pointer)
}
