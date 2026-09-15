/**
 * Schemat ustawień aplikacji — współdzielony, bo main go waliduje, a renderer
 * potrzebuje typu do formularza. Renderer importuje wyłącznie typ, więc `zod`
 * nie trafia do jego bundla.
 */
import { z } from 'zod'
import { WHISPER_LANGUAGES } from './i18n/locales'

export const settingsSchema = z.object({
  /**
   * Sposób przekazywania obrazów do Claude Code.
   *
   * Domyślne `bracketed-path` wybrane eksperymentalnie (`npm run verify:inject`):
   * jako jedyne sprawia, że TUI tworzy natywny załącznik `[Image #1]`. Nie rusza przy tym
   * systemowego schowka i działa tak samo dla obrazów ze schowka, upuszczonych i wybranych z dysku.
   */
  imageInjectStrategy: z
    .enum(['bracketed-path', 'clipboard-paste', 'plain-path'])
    .default('bracketed-path'),
  /** Po ilu godzinach sprzątać obrazy z cache. Plik musi przeżyć wysłanie promptu (§13). */
  imageCacheMaxAgeHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(48),
  /** Powiadomienie systemowe, gdy sesja w nieaktywnej zakładce skończy pracę. */
  notifyOnWaiting: z.boolean().default(true),
  /** Progi zdrowia sesji wg szczytowego kontekstu (tokeny). */
  healthWarnAt: z.number().int().min(1000).max(2_000_000).default(100_000),
  healthDangerAt: z.number().int().min(1000).max(2_000_000).default(150_000),
  /** Przywracanie zakładek po restarcie uruchamia procesy Claude przy starcie — świadomy wybór, nie domyślne. */
  reopenTabsOnStart: z.boolean().default(false),
  terminalFontSize: z.number().int().min(8).max(28).default(13),
  terminalFontFamily: z.string().min(1).max(200).default("'Cascadia Code', Consolas, monospace"),
  /**
   * `--dangerously-skip-permissions` przy każdym starcie sesji — Claude nie pyta o zgodę
   * na narzędzia. Domyślnie włączone, bo w tej aplikacji sesje pracują bez nadzoru;
   * przełącznik w Ustawieniach → Claude Code.
   */
  skipPermissions: z.boolean().default(true),
  /** Dodatkowe argumenty dopisywane do każdego uruchomienia `claude`. */
  claudeExtraArgs: z.array(z.string().max(200)).max(20).default([]),
  /** Ręcznie wskazana ścieżka do executable; `null` = wykrywanie automatyczne. */
  claudeExecutablePath: z.string().max(4096).nullable().default(null),

  /** Ścieżka do `whisper-cli.exe`. `null` = silnik mowy nieskonfigurowany. */
  whisperExecutablePath: z.string().max(4096).nullable().default(null),
  /** Ścieżka do modelu `.bin` w formacie ggml. */
  whisperModelPath: z.string().max(4096).nullable().default(null),
  /** `auto` pozwala Whisperowi wykryć język; wymuszenie bywa pewniejsze przy krótkich nagraniach. */
  whisperLanguage: z.enum(WHISPER_LANGUAGES).default('auto'),
  /** Ile wątków CPU dostaje whisper.cpp. */
  whisperThreads: z.number().int().min(1).max(64).default(8),
})

export type AppSettings = z.infer<typeof settingsSchema>

export const DEFAULT_SETTINGS: AppSettings = settingsSchema.parse({})
