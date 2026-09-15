/**
 * Generuje prawdziwy plik PNG bez sięgania po biblioteki graficzne.
 *
 * `nativeImage` jest niedostępne pod `ELECTRON_RUN_AS_NODE`, a testy strategii wysyłania
 * potrzebują obrazu, który Claude Code faktycznie da radę odczytać — nie atrapy.
 */
import { deflateSync } from 'node:zlib'

/**
 * @param width szerokość w pikselach
 * @param height wysokość w pikselach
 * @param painter zwraca [r, g, b] dla podanego piksela
 */
export function createPng(width, height, painter) {
  const raw = Buffer.alloc(height * (1 + width * 3))
  let offset = 0

  for (let y = 0; y < height; y++) {
    raw[offset++] = 0 // filtr "None" dla całego wiersza
    for (let x = 0; x < width; x++) {
      const [r, g, b] = painter(x, y)
      raw[offset++] = r
      raw[offset++] = g
      raw[offset++] = b
    }
  }

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // głębia bitowa
  ihdr[9] = 2 // typ koloru: truecolor
  // pozycje 10–12 zostają zerami: kompresja deflate, filtr adaptacyjny, brak przeplotu

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function chunk(type, data) {
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length, 0)

  const typeAndData = Buffer.concat([Buffer.from(type, 'ascii'), data])

  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(typeAndData), 0)

  return Buffer.concat([length, typeAndData, crc])
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}
