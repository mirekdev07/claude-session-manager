/** Schematy walidacji payloadów IPC. Main nigdy nie ufa danym z renderera (§24 planu). */
import { z } from 'zod'

export const ptyModeSchema = z.enum(['new', 'continue', 'resume', 'fork'])

/** UUID v4 — format, jakiego wymaga `claude --session-id`. */
export const sessionIdSchema = z
  .string()
  .regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'Invalid session ID')

const colsSchema = z.number().int().min(20).max(1000)
const rowsSchema = z.number().int().min(5).max(500)

export const ptyCreateSchema = z
  .object({
    cwd: z.string().min(1).max(4096),
    mode: ptyModeSchema,
    sessionId: sessionIdSchema.optional(),
    cols: colsSchema,
    rows: rowsSchema,
  })
  .refine((v) => (v.mode === 'resume' || v.mode === 'fork' ? Boolean(v.sessionId) : true), {
    message: 'Modes resume and fork require sessionId',
    path: ['sessionId'],
  })

export const ptyIdSchema = z.string().uuid()

export const ptyWriteSchema = z.object({
  ptyId: ptyIdSchema,
  /** Limit chroni przed zalaniem PTY jednym gigantycznym wklejeniem. */
  data: z.string().max(1_000_000),
})

export const ptyResizeSchema = z.object({
  ptyId: ptyIdSchema,
  cols: colsSchema,
  rows: rowsSchema,
})

export const projectPathSchema = z.string().min(1).max(4096)

export const projectRenameSchema = z.object({
  path: projectPathSchema,
  /** `null` przywraca nazwę katalogu. */
  displayName: z.string().max(120).nullable(),
})

export const projectFavoriteSchema = z.object({
  path: projectPathSchema,
  isFavorite: z.boolean(),
})

export const sessionLabelSchema = z.object({
  sessionId: z.string().min(1).max(200),
  label: z.string().max(120).nullable(),
})

export const sessionFavoriteSchema = z.object({
  sessionId: z.string().min(1).max(200),
  isFavorite: z.boolean(),
})

export const recentLimitSchema = z.number().int().min(1).max(200).optional()
