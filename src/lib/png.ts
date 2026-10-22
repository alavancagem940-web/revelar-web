import { unzlibSync, zlibSync } from 'fflate'

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

function readU32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>>
    0
  )
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

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  if (pb <= pc) return b
  return c
}

function unfilter(raw: Uint8Array, width: number, height: number, bpp: number): Uint8Array {
  const stride = width * bpp
  const rows = new Uint8Array(height * stride)
  let src = 0
  let prev = new Uint8Array(stride)
  for (let y = 0; y < height; y++) {
    const type = raw[src++]
    const row = raw.subarray(src, src + stride)
    src += stride
    const dest = rows.subarray(y * stride, (y + 1) * stride)
    if (type === 0) {
      dest.set(row)
    } else if (type === 1) {
      for (let x = 0; x < stride; x++) {
        dest[x] = (row[x] + (x >= bpp ? dest[x - bpp] : 0)) & 255
      }
    } else if (type === 2) {
      for (let x = 0; x < stride; x++) dest[x] = (row[x] + prev[x]) & 255
    } else if (type === 3) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? dest[x - bpp] : 0
        dest[x] = (row[x] + ((a + prev[x]) >> 1)) & 255
      }
    } else if (type === 4) {
      for (let x = 0; x < stride; x++) {
        const a = x >= bpp ? dest[x - bpp] : 0
        const c = x >= bpp ? prev[x - bpp] : 0
        dest[x] = (row[x] + paeth(a, prev[x], c)) & 255
      }
    } else {
      throw new Error(`PNG: filtro ${type} não suportado.`)
    }
    prev = dest.slice()
  }
  return rows
}

export function encodePng(width: number, height: number, rgba: Uint8ClampedArray): Uint8Array {
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

export function decodePng(bytes: Uint8Array): {
  width: number
  height: number
  data: Uint8ClampedArray
} {
  const sig = Uint8Array.of(137, 80, 78, 71, 13, 10, 26, 10)
  for (let i = 0; i < 8; i++) {
    if (bytes[i] !== sig[i]) throw new Error('PNG inválido.')
  }
  let pos = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idatParts: Uint8Array[] = []
  while (pos + 12 <= bytes.length) {
    const length = readU32(bytes, pos)
    const type = String.fromCharCode(bytes[pos + 4], bytes[pos + 5], bytes[pos + 6], bytes[pos + 7])
    const data = bytes.subarray(pos + 8, pos + 8 + length)
    pos += 12 + length
    if (type === 'IHDR') {
      width = readU32(data, 0)
      height = readU32(data, 4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idatParts.push(data.slice())
    } else if (type === 'IEND') {
      break
    }
  }
  if (!width || !height) throw new Error('PNG sem IHDR.')
  if (bitDepth !== 8) throw new Error('PNG: só 8 bits.')
  if (interlace !== 0) throw new Error('PNG entrelaçado não suportado.')
  if (colorType !== 2 && colorType !== 6) throw new Error('PNG: só RGB ou RGBA.')
  const idatLen = idatParts.reduce((n, p) => n + p.length, 0)
  const idat = new Uint8Array(idatLen)
  let o = 0
  for (const p of idatParts) {
    idat.set(p, o)
    o += p.length
  }
  const raw = unzlibSync(idat)
  const bpp = colorType === 6 ? 4 : 3
  const rows = unfilter(raw, width, height, bpp)
  const data = new Uint8ClampedArray(width * height * 4)
  if (bpp === 4) {
    data.set(rows)
  } else {
    for (let p = 0, s = 0; p < data.length; p += 4, s += 3) {
      data[p] = rows[s]
      data[p + 1] = rows[s + 1]
      data[p + 2] = rows[s + 2]
      data[p + 3] = 255
    }
  }
  return { width, height, data }
}
