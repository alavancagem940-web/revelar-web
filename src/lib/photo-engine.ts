import { recoverRgba } from './recovery.ts'
import { clamp } from './utils.ts'

export type ProgressFn = (percent: number, status: string) => void

export type EnhanceOptions = {
  intensity?: number
  /** Passe mais leve (vídeo): menos tiles, só unsharp fino. */
  fast?: boolean
  /** Deblock + Lanczos antes do punch. Padrão: ligado (fotos). */
  recover?: boolean
  /** Fator de upscale já aplicado — reduz nitidez de grão. */
  upscaled?: number
  onProgress?: ProgressFn
  shouldCancel?: () => boolean
}

export type EnhanceResult = {
  data: Uint8ClampedArray
  width: number
  height: number
  scale: number
}

export class MediaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaError'
  }
}

const XN = 0.95047
const YN = 1
const ZN = 1.08883
const DELTA = 6 / 29
const DELTA2 = DELTA * DELTA
const DELTA3 = DELTA2 * DELTA
const INV_3DELTA2 = 1 / (3 * DELTA2)

const SRGB_TO_LINEAR = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const u = i / 255
  SRGB_TO_LINEAR[i] = u <= 0.04045 ? u / 12.92 : ((u + 0.055) / 1.055) ** 2.4
}

function checkCancel(shouldCancel?: () => boolean): void {
  if (shouldCancel?.()) {
    const err = new Error('cancelado')
    err.name = 'CancelledError'
    throw err
  }
}

function report(onProgress: ProgressFn | undefined, percent: number, status: string) {
  onProgress?.(percent, status)
}

function lumaAt(data: Uint8ClampedArray, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
}

function copyRgba(src: Uint8ClampedArray): Uint8ClampedArray {
  return new Uint8ClampedArray(src)
}

function labF(t: number): number {
  return t > DELTA3 ? Math.cbrt(t) : t * INV_3DELTA2 + 4 / 29
}

function labFInv(t: number): number {
  return t > DELTA ? t * t * t : 3 * DELTA2 * (t - 4 / 29)
}

function linearToSrgb8(u: number): number {
  const c = u <= 0.0031308 ? 12.92 * u : 1.055 * u ** (1 / 2.4) - 0.055
  return clamp(Math.round(c * 255), 0, 255)
}

export type LabImage = {
  L: Float32Array
  a: Float32Array
  b: Float32Array
}

export function rgbToLab(src: Uint8ClampedArray, pixels: number): LabImage {
  const L = new Float32Array(pixels)
  const a = new Float32Array(pixels)
  const b = new Float32Array(pixels)
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    const r = SRGB_TO_LINEAR[src[i]]
    const g = SRGB_TO_LINEAR[src[i + 1]]
    const bl = SRGB_TO_LINEAR[src[i + 2]]
    const x = 0.4124564 * r + 0.3575761 * g + 0.1804375 * bl
    const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * bl
    const z = 0.0193339 * r + 0.119192 * g + 0.9503041 * bl
    const fx = labF(x / XN)
    const fy = labF(y / YN)
    const fz = labF(z / ZN)
    L[p] = 116 * fy - 16
    a[p] = 500 * (fx - fy)
    b[p] = 200 * (fy - fz)
  }
  return { L, a, b }
}

export function labToRgba(
  lab: LabImage,
  src: Uint8ClampedArray,
  pixels: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  const { L, a, b } = lab
  for (let p = 0, i = 0; p < pixels; p++, i += 4) {
    const fy = (L[p] + 16) / 116
    const fx = fy + a[p] / 500
    const fz = fy - b[p] / 200
    const x = XN * labFInv(fx)
    const y = YN * labFInv(fy)
    const z = ZN * labFInv(fz)
    const r = 3.2404542 * x - 1.5371385 * y - 0.4985314 * z
    const g = -0.969266 * x + 1.8760108 * y + 0.041556 * z
    const bl = 0.0556434 * x - 0.2040259 * y + 1.0572252 * z
    out[i] = linearToSrgb8(r)
    out[i + 1] = linearToSrgb8(g)
    out[i + 2] = linearToSrgb8(bl)
    out[i + 3] = src[i + 3]
  }
  return out
}

function makeGaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.min(7, Math.round(sigma * 2)))
  const size = radius * 2 + 1
  const kernel = new Float32Array(size)
  const s2 = 2 * sigma * sigma
  let sum = 0
  for (let i = 0; i < size; i++) {
    const x = i - radius
    const v = Math.exp(-(x * x) / s2)
    kernel[i] = v
    sum += v
  }
  for (let i = 0; i < size; i++) kernel[i] /= sum
  return kernel
}

export function blurFloat(
  src: Float32Array,
  width: number,
  height: number,
  sigma: number,
): Float32Array {
  const kernel = makeGaussianKernel(sigma)
  const radius = (kernel.length - 1) >> 1
  const tmp = new Float32Array(width * height)
  const dest = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    const row = y * width
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = 0; k < kernel.length; k++) {
        const xx = clamp(x + k - radius, 0, width - 1)
        acc += src[row + xx] * kernel[k]
      }
      tmp[row + x] = acc
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = 0; k < kernel.length; k++) {
        const yy = clamp(y + k - radius, 0, height - 1)
        acc += tmp[yy * width + x] * kernel[k]
      }
      dest[y * width + x] = acc
    }
  }
  return dest
}

export function whiteBalanceRgba(
  src: Uint8ClampedArray,
  strength: number,
): Uint8ClampedArray {
  if (strength <= 0.01) return copyRgba(src)
  let r = 0
  let g = 0
  let b = 0
  const pixels = src.length / 4
  for (let i = 0; i < src.length; i += 4) {
    r += src[i]
    g += src[i + 1]
    b += src[i + 2]
  }
  r /= pixels
  g /= pixels
  b /= pixels
  const gray = (r + g + b) / 3
  const scaleR = 1 + (gray / Math.max(r, 1) - 1) * strength
  const scaleG = 1 + (gray / Math.max(g, 1) - 1) * strength
  const scaleB = 1 + (gray / Math.max(b, 1) - 1) * strength
  const out = copyRgba(src)
  for (let i = 0; i < src.length; i += 4) {
    out[i] = src[i] * scaleR
    out[i + 1] = src[i + 1] * scaleG
    out[i + 2] = src[i + 2] * scaleB
  }
  return out
}

export function percentileOf(
  values: Float32Array,
  pct: number,
  maxValue: number,
): number {
  const bins = 1024
  const hist = new Uint32Array(bins)
  const scale = bins / Math.max(1e-6, maxValue)
  for (let i = 0; i < values.length; i++) {
    const idx = clamp(Math.floor(values[i] * scale), 0, bins - 1)
    hist[idx]++
  }
  const target = clamp(pct, 0, 100) * 0.01 * values.length
  let acc = 0
  for (let i = 0; i < bins; i++) {
    acc += hist[i]
    if (acc >= target) return (i / (bins - 1)) * maxValue
  }
  return maxValue
}

export function lumaPercentile(L: Float32Array, pct: number): number {
  return percentileOf(L, pct, 100)
}

/**
 * Pretos profundos e brancos limpos no L*, sem esmagar 0/100.
 * Estica o intervalo útil (percentis) com ganho limitado.
 */
export function autoBlackWhiteL(L: Float32Array, strength: number): void {
  if (strength <= 0.01) return
  const lo = lumaPercentile(L, 0.65)
  const hi = lumaPercentile(L, 99.35)
  const span = hi - lo
  if (span < 1.6) return
  const targetLo = 2.2
  const targetHi = 97.4
  const gain = (targetHi - targetLo) / span
  for (let i = 0; i < L.length; i++) {
    const stretched = targetLo + (L[i] - lo) * gain
    L[i] = clamp(L[i] + (stretched - L[i]) * strength, 0, 100)
  }
}

/** Curva S suave no L* — corpo e profundidade, pontas protegidas. */
export function sCurveL(L: Float32Array, amount: number): void {
  if (amount <= 0.01) return
  for (let i = 0; i < L.length; i++) {
    const x = clamp(L[i] / 100, 0, 1)
    const s = x * x * (3 - 2 * x)
    L[i] = clamp((x + amount * (s - x)) * 100, 0, 100)
  }
}

function buildClaheLuts(
  luma: Uint8Array,
  width: number,
  height: number,
  tiles: number,
  clipLimit: number,
): Uint8Array[][] {
  const tileW = Math.max(1, Math.ceil(width / tiles))
  const tileH = Math.max(1, Math.ceil(height / tiles))
  const maps: Uint8Array[][] = []
  for (let ty = 0; ty < tiles; ty++) {
    maps[ty] = []
    for (let tx = 0; tx < tiles; tx++) {
      const hist = new Uint32Array(256)
      const x0 = tx * tileW
      const y0 = ty * tileH
      const x1 = Math.min(width, x0 + tileW)
      const y1 = Math.min(height, y0 + tileH)
      let count = 0
      for (let y = y0; y < y1; y++) {
        const row = y * width
        for (let x = x0; x < x1; x++) {
          hist[luma[row + x]]++
          count++
        }
      }
      if (count === 0) {
        const identity = new Uint8Array(256)
        for (let i = 0; i < 256; i++) identity[i] = i
        maps[ty][tx] = identity
        continue
      }
      const clip = Math.max(1, Math.floor((clipLimit * count) / 256))
      let excess = 0
      for (let i = 0; i < 256; i++) {
        if (hist[i] > clip) {
          excess += hist[i] - clip
          hist[i] = clip
        }
      }
      const redis = Math.floor(excess / 256)
      const leftover = excess - redis * 256
      for (let i = 0; i < 256; i++) hist[i] += redis
      for (let i = 0; i < leftover; i++) hist[i]++

      const lut = new Uint8Array(256)
      let cdf = 0
      let cdfMin = 0
      for (let i = 0; i < 256; i++) {
        if (hist[i] > 0) {
          cdfMin = hist[i]
          break
        }
      }
      const denom = Math.max(1, count - cdfMin)
      for (let i = 0; i < 256; i++) {
        cdf += hist[i]
        lut[i] = clamp(Math.round(((cdf - cdfMin) / denom) * 255), 0, 255)
      }
      maps[ty][tx] = lut
    }
  }
  return maps
}

/** CLAHE no canal L* (0–100), interpolado entre tiles. */
export function claheL(
  L: Float32Array,
  width: number,
  height: number,
  strength: number,
  fast = false,
): void {
  const clipLimit = 1.55 + 0.7 * Math.max(0, strength)
  const minSide = Math.min(width, height)
  const tiles = fast
    ? minSide >= 64
      ? 6
      : 2
    : minSide >= 720
      ? 12
      : minSide >= 64
        ? 8
        : 2
  const luma = new Uint8Array(width * height)
  for (let p = 0; p < L.length; p++) {
    luma[p] = clamp(Math.round(L[p] * 2.55), 0, 255)
  }
  const maps = buildClaheLuts(luma, width, height, tiles, clipLimit)
  const tileW = Math.max(1, Math.ceil(width / tiles))
  const tileH = Math.max(1, Math.ceil(height / tiles))

  for (let y = 0; y < height; y++) {
    const ty = clamp(Math.floor(y / tileH), 0, tiles - 1)
    const ty1 = Math.min(tiles - 1, ty + 1)
    const fy = tileH <= 1 ? 0 : (y - ty * tileH + 0.5) / tileH
    const row = y * width
    for (let x = 0; x < width; x++) {
      const tx = clamp(Math.floor(x / tileW), 0, tiles - 1)
      const tx1 = Math.min(tiles - 1, tx + 1)
      const fx = tileW <= 1 ? 0 : (x - tx * tileW + 0.5) / tileW
      const v = luma[row + x]
      const top = maps[ty][tx][v] * (1 - fx) + maps[ty][tx1][v] * fx
      const bot = maps[ty1][tx][v] * (1 - fx) + maps[ty1][tx1][v] * fx
      const mapped = top * (1 - fy) + bot * fy
      L[row + x] = mapped / 2.55
    }
  }
}

/**
 * 0 em pele/fundo lisos, 1 em cabelo/tecido/bordas.
 * Depois de Lanczos o fundo interpolado fica ainda mais liso — sobe o piso.
 */
export function textureMask(
  L: Float32Array,
  width: number,
  height: number,
  upscaled = 1,
): Float32Array {
  const blurred = blurFloat(L, width, height, 1.15)
  const mask = new Float32Array(L.length)
  const grow = Math.max(0, upscaled - 1)
  const floor = 0.55 + 0.4 * grow
  const span = 2.8 + 0.5 * grow
  for (let i = 0; i < L.length; i++) {
    const high = Math.abs(L[i] - blurred[i])
    mask[i] = clamp((high - floor) / span, 0, 1)
  }
  return mask
}

/** Microtextura tipo celular: só em borda real. Não é curva HDR. */
export function revealDetailL(
  L: Float32Array,
  width: number,
  height: number,
  amount: number,
  upscaled = 1,
  mask?: Float32Array,
  fast = false,
): void {
  if (amount <= 0.02) return
  const grow = Math.max(0, upscaled - 1)
  const fine = (0.78 * amount) / (1 + 0.16 * grow)
  const thresh = 0.4 * (1 + 0.18 * grow)
  applyUnsharpPass(L, width, height, 0.58, fine, thresh, mask)
  if (!fast) {
    const mid = (0.24 * amount) / (1 + 0.1 * grow)
    applyUnsharpPass(L, width, height, 1.65, mid, 0.62, mask)
  }
}

/**
 * Unsharp de alta frequência no L* (fios, dobras, contornos).
 * Opcional: clareza de médio alcance (contraste local).
 * Com `mask`, pele e fundo lisos não ganham grão.
 */
export function unsharpL(
  L: Float32Array,
  width: number,
  height: number,
  strength: number,
  fast = false,
  upscaled = 1,
  mask?: Float32Array,
): void {
  if (strength <= 0.01) return
  const grow = Math.max(0, upscaled - 1)
  const fineAmount = (0.9 + 0.55 * strength) / (1 + 0.12 * grow)
  const thresh = 0.28 * (1 + 0.22 * grow)
  applyUnsharpPass(L, width, height, 0.7, fineAmount, thresh, mask)
  if (!fast) {
    const clarity = (0.2 + 0.28 * strength) / (1 + 0.08 * grow)
    applyUnsharpPass(L, width, height, 2.05, clarity, 0.5, mask)
  }
}

function applyUnsharpPass(
  L: Float32Array,
  width: number,
  height: number,
  sigma: number,
  amount: number,
  threshold: number,
  mask?: Float32Array,
): void {
  const blurred = blurFloat(L, width, height, sigma)
  for (let i = 0; i < L.length; i++) {
    const gate = mask ? mask[i] : 1
    if (gate < 0.04) continue
    const high = L[i] - blurred[i]
    if (Math.abs(high) < threshold) continue
    const t = L[i] / 100
    const protect = clamp(t * 6, 0, 1) * clamp((1 - t) * 8, 0, 1)
    const mix = 0.4 + 0.6 * protect
    L[i] = clamp(L[i] + amount * high * mix * gate, 0, 100)
  }
}

export function meanLuma(data: Uint8ClampedArray): number {
  let sum = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) sum += lumaAt(data, i)
  return sum / n
}

export function lumaStddev(data: Uint8ClampedArray): number {
  const n = data.length / 4
  const mean = meanLuma(data)
  let acc = 0
  for (let i = 0; i < data.length; i += 4) {
    const d = lumaAt(data, i) - mean
    acc += d * d
  }
  return Math.sqrt(acc / n)
}

export function lumaRange(
  data: Uint8ClampedArray,
  loPct = 1,
  hiPct = 99,
): { lo: number; hi: number } {
  const n = data.length / 4
  const stride = n > 120_000 ? Math.max(1, Math.floor(n / 80_000)) : 1
  const count = Math.ceil(n / stride)
  const values = new Float32Array(count)
  for (let p = 0, s = 0; p < n; p += stride, s++) values[s] = lumaAt(data, p * 4)
  return { lo: percentileOf(values, loPct, 255), hi: percentileOf(values, hiPct, 255) }
}

/** LAB+CLAHE+gauss em 12 MP trava o Safari. Acima disto: caminho inteiro rápido. */
export const LAB_PIXEL_BUDGET = 1_800_000

export function usesLabPath(width: number, height: number): boolean {
  return width * height <= LAB_PIXEL_BUDGET
}

export function highFreqEnergy(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let acc = 0
  let count = 0
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      const i = (y * width + x) * 4
      const j = i + 4
      acc += Math.abs(lumaAt(data, i) - lumaAt(data, j))
      count++
    }
  }
  return acc / Math.max(1, count)
}

export function channelMeans(data: Uint8ClampedArray): {
  r: number
  g: number
  b: number
} {
  let r = 0
  let g = 0
  let b = 0
  const n = data.length / 4
  for (let i = 0; i < data.length; i += 4) {
    r += data[i]
    g += data[i + 1]
    b += data[i + 2]
  }
  return { r: r / n, g: g / n, b: b / n }
}

function boxBlurU8(src: Uint8Array, width: number, height: number, radius: number): Uint8Array {
  const r = Math.max(1, radius)
  const span = r * 2 + 1
  const tmp = new Uint8Array(src.length)
  const dest = new Uint8Array(src.length)
  for (let y = 0; y < height; y++) {
    const row = y * width
    let acc = 0
    for (let k = -r; k <= r; k++) acc += src[row + clamp(k, 0, width - 1)]
    for (let x = 0; x < width; x++) {
      tmp[row + x] = acc / span
      acc += src[row + clamp(x + r + 1, 0, width - 1)] - src[row + clamp(x - r, 0, width - 1)]
    }
  }
  for (let x = 0; x < width; x++) {
    let acc = 0
    for (let k = -r; k <= r; k++) acc += tmp[clamp(k, 0, height - 1) * width + x]
    for (let y = 0; y < height; y++) {
      dest[y * width + x] = acc / span
      acc +=
        tmp[clamp(y + r + 1, 0, height - 1) * width + x] -
        tmp[clamp(y - r, 0, height - 1) * width + x]
    }
  }
  return dest
}

function extractLuma8(src: Uint8ClampedArray, width: number, height: number): Uint8Array {
  const luma = new Uint8Array(width * height)
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) luma[p] = lumaAt(src, i)
  return luma
}

function previewMask(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  maxSide = 480,
): Float32Array {
  const longest = Math.max(width, height)
  const scale = longest > maxSide ? maxSide / longest : 1
  const pw = Math.max(2, Math.round(width * scale))
  const ph = Math.max(2, Math.round(height * scale))
  const luma = new Uint8Array(pw * ph)
  for (let y = 0; y < ph; y++) {
    const sy = Math.min(height - 1, Math.floor(((y + 0.5) * height) / ph))
    for (let x = 0; x < pw; x++) {
      const sx = Math.min(width - 1, Math.floor(((x + 0.5) * width) / pw))
      luma[y * pw + x] = lumaAt(src, (sy * width + sx) * 4)
    }
  }
  const blurred = boxBlurU8(luma, pw, ph, 1)
  const small = new Float32Array(pw * ph)
  for (let i = 0; i < small.length; i++) {
    small[i] = clamp((Math.abs(luma[i] - blurred[i]) - 5) / 16, 0, 1)
  }
  if (pw === width && ph === height) return small
  const mask = new Float32Array(width * height)
  for (let y = 0; y < height; y++) {
    const sy = Math.min(ph - 1, Math.floor((y * ph) / height))
    for (let x = 0; x < width; x++) {
      const sx = Math.min(pw - 1, Math.floor((x * pw) / width))
      mask[y * width + x] = small[sy * pw + sx]
    }
  }
  return mask
}

function stretchRgbLevels(src: Uint8ClampedArray, strength: number): Uint8ClampedArray {
  if (strength <= 0.01) return copyRgba(src)
  const { lo, hi } = lumaRange(src, 0.7, 99.3)
  const span = hi - lo
  if (span < 12) return copyRgba(src)
  const gain = (245 - 8) / span
  const out = copyRgba(src)
  const t = clamp(strength, 0, 1)
  for (let i = 0; i < src.length; i += 4) {
    for (let c = 0; c < 3; c++) {
      const stretched = 8 + (src[i + c] - lo) * gain
      out[i + c] = src[i + c] + (stretched - src[i + c]) * t
    }
  }
  return out
}

function fastPunchRgba(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  intensity: number,
  options: EnhanceOptions,
): Uint8ClampedArray {
  const { onProgress, shouldCancel, fast } = options
  const upscaled = options.upscaled ?? 1
  const { lo, hi } = lumaRange(src, 1, 99)
  const washed = clamp((125 - (hi - lo)) / 75, 0, 1)

  checkCancel(shouldCancel)
  report(onProgress, 32, 'balanço de branco')
  let work = whiteBalanceRgba(src, (0.04 + 0.16 * washed) * intensity)
  if (washed > 0.22) {
    checkCancel(shouldCancel)
    report(onProgress, 48, 'pretos e brancos')
    work = stretchRgbLevels(work, washed * intensity)
  }

  checkCancel(shouldCancel)
  report(onProgress, 84, 'nitidez')
  const luma = extractLuma8(work, width, height)
  const blurred = boxBlurU8(luma, width, height, fast ? 1 : 2)
  const mask = previewMask(work, width, height)
  const grow = Math.max(0, upscaled - 1)
  const amount = ((upscaled > 1.12 ? 0.9 : washed > 0.22 ? 0.55 : 0.28) * intensity) / (1 + 0.12 * grow)
  const thresh = 6 * (1 + 0.15 * grow)
  const out = copyRgba(work)
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    const gate = mask[p]
    if (gate < 0.05) continue
    const high = luma[p] - blurred[p]
    if (Math.abs(high) < thresh) continue
    const add = amount * high * gate
    out[i] = work[i] + add
    out[i + 1] = work[i + 1] + add
    out[i + 2] = work[i + 2] + add
  }
  report(onProgress, 100, 'concluído')
  return out
}

function punchRgba(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  intensity: number,
  options: EnhanceOptions,
): Uint8ClampedArray {
  if (!usesLabPath(width, height)) {
    return fastPunchRgba(src, width, height, intensity, options)
  }
  const { onProgress, shouldCancel, fast } = options
  const upscaled = options.upscaled ?? 1
  const pixels = width * height
  const { lo, hi } = lumaRange(src, 1, 99)
  const washed = clamp((125 - (hi - lo)) / 75, 0, 1)
  const fromSmall = upscaled > 1.12

  checkCancel(shouldCancel)
  report(onProgress, 32, 'balanço de branco')
  const balanced = whiteBalanceRgba(src, (0.05 + 0.2 * washed) * intensity)
  const lab = rgbToLab(balanced, pixels)

  if (washed > 0.22) {
    checkCancel(shouldCancel)
    report(onProgress, 48, 'pretos e brancos')
    autoBlackWhiteL(lab.L, washed * intensity)
    sCurveL(lab.L, 0.16 * washed * intensity)
  }

  const baseL = new Float32Array(lab.L)
  const mask = textureMask(baseL, width, height, upscaled)

  if (washed > 0.22) {
    checkCancel(shouldCancel)
    report(onProgress, 62, 'CLAHE')
    claheL(lab.L, width, height, washed * intensity, fast)
    const claheMix = (fast ? 0.48 : 0.58) * washed
    for (let i = 0; i < lab.L.length; i++) {
      const gate = 0.18 + 0.82 * mask[i]
      lab.L[i] = baseL[i] * (1 - claheMix * gate) + lab.L[i] * (claheMix * gate)
      const chroma = 1 + intensity * washed * (0.08 + 0.1 * mask[i])
      lab.a[i] *= chroma
      lab.b[i] *= chroma
    }
  }

  checkCancel(shouldCancel)
  report(onProgress, 84, 'nitidez')
  const reveal = fromSmall
    ? 0.95 * intensity
    : washed > 0.22
      ? (0.55 + 0.3 * washed) * intensity
      : 0.26 * intensity
  revealDetailL(lab.L, width, height, reveal, upscaled, mask, fast)
  for (let i = 0; i < lab.L.length; i++) {
    lab.L[i] = baseL[i] * (1 - mask[i]) + lab.L[i] * mask[i]
  }

  const out = labToRgba(lab, balanced, pixels)
  report(onProgress, 100, 'concluído')
  return out
}

export function enhanceRgba(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  options: EnhanceOptions = {},
): EnhanceResult {
  if (width < 2 || height < 2 || src.length < width * height * 4) {
    throw new MediaError('imagem inválida.')
  }
  const intensity = clamp(options.intensity ?? 1, 0, 1)
  checkCancel(options.shouldCancel)
  report(options.onProgress, 6, 'lendo')
  if (intensity <= 0.01) {
    report(options.onProgress, 100, 'concluído')
    return { data: copyRgba(src), width, height, scale: 1 }
  }

  let work = src
  let outW = width
  let outH = height
  let scale = 1
  const recover = options.recover !== false && !options.fast
  if (recover) {
    checkCancel(options.shouldCancel)
    const small = Math.max(width, height) < 900
    report(options.onProgress, 14, small ? 'Lanczos' : 'desbloqueio')
    const recovered = recoverRgba(work, width, height)
    work = recovered.data
    outW = recovered.width
    outH = recovered.height
    scale = recovered.scale
    if (scale > 1.01) report(options.onProgress, 22, 'Lanczos')
  }

  const punched = punchRgba(work, outW, outH, intensity, {
    ...options,
    upscaled: scale,
  })
  return { data: punched, width: outW, height: outH, scale }
}

export function enhanceFrameRgba(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  intensity: number,
  gains?: { r: number; g: number; b: number },
): Uint8ClampedArray {
  const t = clamp(intensity, 0, 1)
  const original = copyRgba(src)
  if (t <= 0.01) return original
  let work = original
  if (gains) {
    work = copyRgba(original)
    const sr = 1 + (gains.r - 1) * t * 0.55
    const sg = 1 + (gains.g - 1) * t * 0.55
    const sb = 1 + (gains.b - 1) * t * 0.55
    for (let i = 0; i < work.length; i += 4) {
      work[i] = original[i] * sr
      work[i + 1] = original[i + 1] * sg
      work[i + 2] = original[i + 2] * sb
    }
  }
  return punchRgba(work, width, height, t, { fast: true })
}
