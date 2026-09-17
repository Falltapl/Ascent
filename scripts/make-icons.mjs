/**
 * Generates the app icons with no image dependencies — raw RGBA pixels
 * encoded to PNG via zlib, which ships with Node. Renders at 4x and box-
 * filters down, which is what keeps the rounded corners and the ring edges
 * from looking jagged.
 *
 * The mark must match src/components/Logo.tsx: in a 64-unit box, a ring of
 * radius 15 and stroke 5.5 with round caps, covering 270° clockwise from
 * 12 o'clock, plus a centre dot of radius 4.5.
 */
import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'

const SS = 4 // supersample factor

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (buf) => {
  let c = 0xffffffff
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePNG(w, h, rgba) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0
  // each scanline is prefixed with filter byte 0 (None)
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]
const lerp = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

/** Signed "inside" test for a rounded square. */
function inRounded(x, y, size, pad, r) {
  const lo = pad, hi = size - pad
  if (x < lo || x > hi || y < lo || y > hi) return false
  const cx = Math.min(Math.max(x, lo + r), hi - r)
  const cy = Math.min(Math.max(y, lo + r), hi - r)
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r
}

function render(size, { padRatio = 0, bg = null } = {}) {
  const S = size * SS
  const big = Buffer.alloc(S * S * 4)
  const A = hex('#a855f7'), B = hex('#22d3ee'), INK = hex('#0a0a14')
  const pad = S * padRatio
  const r = (S - pad * 2) * 0.235

  // Everything below is in the same 64-unit space as Logo.tsx's viewBox.
  const box = S - pad * 2
  const HALF = 5.5 / 2
  const capA = [32, 17]  // 12 o'clock, where the arc starts
  const capB = [17, 32]  // 9 o'clock, 270° later
  const inMark = (u, v) => {
    const dx = u - 32, dy = v - 32
    const d = Math.hypot(dx, dy)
    if (d <= 4.5) return true                                   // centre dot
    if (Math.abs(d - 15) <= HALF) {
      // screen coords (y down): clockwise is increasing atan2, starting at -90°
      const a = (((Math.atan2(dy, dx) * 180) / Math.PI + 90) % 360 + 360) % 360
      if (a <= 270) return true                                 // the arc
    }
    return Math.hypot(u - capA[0], v - capA[1]) <= HALF         // round caps
        || Math.hypot(u - capB[0], v - capB[1]) <= HALF
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4
      if (!inRounded(x, y, S, pad, r)) {
        if (bg) { big[i] = bg[0]; big[i+1] = bg[1]; big[i+2] = bg[2]; big[i+3] = 255 }
        continue
      }
      const t = (x + y) / (2 * S)
      const c = lerp(A, B, t)
      const u = ((x + 0.5 - pad) / box) * 64
      const v = ((y + 0.5 - pad) / box) * 64
      const px = inMark(u, v) ? INK : c
      big[i] = px[0]; big[i+1] = px[1]; big[i+2] = px[2]; big[i+3] = 255
    }
  }

  // box-filter down from the supersampled buffer
  const out = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0, 0]
      for (let dy = 0; dy < SS; dy++) for (let dx = 0; dx < SS; dx++) {
        const j = ((y * SS + dy) * S + (x * SS + dx)) * 4
        acc[0] += big[j]; acc[1] += big[j+1]; acc[2] += big[j+2]; acc[3] += big[j+3]
      }
      const n = SS * SS, i = (y * size + x) * 4
      out[i] = acc[0]/n | 0; out[i+1] = acc[1]/n | 0; out[i+2] = acc[2]/n | 0; out[i+3] = acc[3]/n | 0
    }
  }
  return encodePNG(size, size, out)
}

mkdirSync('public', { recursive: true })
const jobs = [
  ['public/icon-192.png', render(192)],
  ['public/icon-512.png', render(512)],
  // maskable needs the safe-zone padding so platform masks don't clip the mark
  ['public/icon-maskable-512.png', render(512, { padRatio: 0.14, bg: [10, 10, 20] })],
  ['public/apple-touch-icon.png', render(180, { padRatio: 0, bg: null })],
]
for (const [path, buf] of jobs) {
  writeFileSync(path, buf)
  console.log(`  ${path.padEnd(34)} ${(buf.length / 1024).toFixed(1)} KB`)
}
