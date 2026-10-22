import { writeFileSync, mkdirSync } from 'node:fs'
import { zlibSync } from 'fflate'
import { enhanceRgba } from '../src/lib/photo-engine.ts'
import { artifactBarPixels } from '../src/lib/sample.ts'

function crc32(buf: Uint8Array): number {
  let c = ~0 >>> 0
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i]
    for (let k = 0; k < 8; k++) {
      c = (c >>> 1) ^ (0xedb88320 & -(c & 1))
    }
  }
  return ~c >>> 0
}

function u32(n: number): Uint8Array {
  return Uint8Array.of((n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255)
}

function chunk(type: string, data: Uint8Array): Uint8Array {
  const name = Uint8Array.from(type, (ch) => ch.charCodeAt(0))
  const crcBuf = new Uint8Array(name.length + data.length)
  crcBuf.set(name)
  crcBuf.set(data, name.length)
  const out = new Uint8Array(12 + data.length)
  out.set(u32(data.length), 0)
  out.set(name, 4)
  out.set(data, 8)
  out.set(u32(crc32(crcBuf)), 8 + data.length)
  return out
}

function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
  const raw = new Uint8Array(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const row = y * (1 + width * 4)
    raw[row] = 0
    raw.set(rgba.subarray(y * width * 4, (y + 1) * width * 4), row + 1)
  }
  const ihdr = new Uint8Array(13)
  ihdr.set(u32(width), 0)
  ihdr.set(u32(height), 4)
  ihdr[8] = 8
  ihdr[9] = 6
  const signature = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
  const parts = [
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlibSync(raw, { level: 6 })),
    chunk('IEND', new Uint8Array()),
  ]
  const total = parts.reduce((n, p) => n + p.length, 0)
  const out = new Uint8Array(total)
  let o = 0
  for (const p of parts) {
    out.set(p, o)
    o += p.length
  }
  return out
}

const width = 360
const height = 240
const before = artifactBarPixels(width, height)
const after = enhanceRgba(before, width, height, { intensity: 1 })

const dest = process.argv[2] || '/cursor/stores/self/media/revelar-web'
mkdirSync(dest, { recursive: true })
writeFileSync(`${dest}/13-recovery-before.png`, encodePng(width, height, before))
writeFileSync(`${dest}/14-recovery-after.png`, encodePng(after.width, after.height, after.data))
console.log(
  `wrote 13/14 ${width}x${height} → ${after.width}x${after.height} scale=${after.scale.toFixed(2)}`,
)
