/**
 * Eksport rozmowy do Markdown (Etap 12.6).
 *
 * Zapisujemy to, co czyta człowiek: prompty i odpowiedzi. Wyniki narzędzi pomijamy —
 * to głównie zrzuty plików, które i tak leżą w projekcie.
 */
import { localeTag } from '@shared/i18n'
import { mainLocale, tMain } from '@main/i18n'
import { readTranscriptIncrement } from './transcript-metrics'

export interface ExportSource {
  sessionId: string
  title: string | null
  projectPath: string | null
  transcriptPath: string
}

export async function renderMarkdown(source: ExportSource): Promise<string> {
  const increment = await readTranscriptIncrement(source.transcriptPath, 0)
  const dateTag = localeTag(mainLocale())

  const lines: string[] = [
    `# ${source.title ?? tMain('export.title')}`,
    '',
    `- ${tMain('export.session')}: \`${source.sessionId}\``,
    source.projectPath ? `- ${tMain('export.project')}: \`${source.projectPath}\`` : null,
    `- ${tMain('export.messages')}: ${increment.searchRows.length}`,
    `- ${tMain('export.requests')}: ${increment.requestCount}`,
    '',
    '---',
    '',
  ].filter((line): line is string => line !== null)

  const you = tMain('export.you')
  const claude = tMain('export.claude')

  for (const row of increment.searchRows) {
    const stamp = row.timestamp !== null ? new Date(row.timestamp).toLocaleString(dateTag) : ''
    lines.push(`## ${row.role === 'user' ? you : claude}${stamp ? ` · ${stamp}` : ''}`)
    lines.push('')
    lines.push(row.text)
    lines.push('')
  }

  return lines.join('\n')
}
