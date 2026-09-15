/**
 * Generuje ikonę aplikacji (Etap 12.2) bez narzędzi graficznych.
 *
 * Znak: ciemna zaokrąglona płytka w kolorze tła aplikacji, na niej pomarańczowy znak
 * zachęty terminala `❯` i kursor `_` — to samo, co użytkownik widzi w każdej sesji.
 * electron-builder sam robi z `resources/icon.png` plik `.ico`.
 *
 * Uruchomienie: node scripts/make-icon.mjs
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createPng } from './lib/make-png.mjs'

const SIZE = 512
const BG = [13, 13, 15]
const PLATE = [26, 26, 31]
const ACCENT = [217, 119, 87]

const radius = 96
const inset = 16

/** Odległość punktu od odcinka — do rysowania kresek o zadanej grubości. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax
  const dy = by - ay
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared))
  const cx = ax + t * dx
  const cy = ay + t * dy
  return Math.hypot(px - cx, py - cy)
}

function insideRoundedRect(x, y) {
  const left = inset
  const top = inset
  const right = SIZE - inset
  const bottom = SIZE - inset
  if (x < left || x > right || y < top || y > bottom) return false
  const cx = Math.max(left + radius, Math.min(right - radius, x))
  const cy = Math.max(top + radius, Math.min(bottom - radius, y))
  return Math.hypot(x - cx, y - cy) <= radius
}

const chevronStroke = 34
const chevron = [
  [176, 168, 288, 256], // ramię górne
  [288, 256, 176, 344], // ramię dolne
]
const cursor = [312, 352, 400, 352]

const png = createPng(SIZE, SIZE, (x, y) => {
  if (!insideRoundedRect(x, y)) return BG

  const onChevron = chevron.some(([ax, ay, bx, by]) => distanceToSegment(x, y, ax, ay, bx, by) <= chevronStroke / 2)
  const onCursor = distanceToSegment(x, y, ...cursor) <= 14
  if (onChevron || onCursor) return ACCENT

  return PLATE
})

const output = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icon.png')
mkdirSync(dirname(output), { recursive: true })
writeFileSync(output, png)
console.log(`zapisano ${output} (${SIZE}×${SIZE}, ${png.length} B)`)
