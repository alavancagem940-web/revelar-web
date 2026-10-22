import { clamp } from './utils.ts'

export type ProgressFn = (percent: number, status: string) => void

export type EnhanceOptions = {
  intensity?: number
  onProgress?: ProgressFn
  shouldCancel?: () => boolean
}

export class MediaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'MediaError'
  }
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

function makeGaussianKernel(sigma: number): Float32Array {
  const radius = Math.max(1, Math.min(6, Math.round(sigma * 2)))
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

function blurChannel(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  kernel: Float32Array,
  channel: number,
  dest: Uint8ClampedArray,
): void {
  const radius = (kernel.length - 1) >> 1
  const tmp = new Float32Array(width * height)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = 0; k < kernel.length; k++) {
        const xx = clamp(x + k - radius, 0, width - 1)
        acc += src[(y * width + xx) * 4 + channel] * kernel[k]
      }
      tmp[y * width + x] = acc
    }
  }

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0
      for (let k = 0; k < kernel.length; k++) {
        const yy = clamp(y + k - radius, 0, height - 1)
        acc += tmp[yy * width + x] * kernel[k]
      }
      dest[(y * width + x) * 4 + channel] = acc
    }
  }
}

function blurRgb(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  sigma: number,
): Uint8ClampedArray {
  const kernel = makeGaussianKernel(sigma)
  const dest = copyRgba(src)
  blurChannel(src, width, height, kernel, 0, dest)
  blurChannel(src, width, height, kernel, 1, dest)
  blurChannel(src, width, height, kernel, 2, dest)
  return dest
}

export function denoiseRgba(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number,
): Uint8ClampedArray {
  if (strength <= 0.05) return copyRgba(src)
  const sigma = 0.8 + 1.1 * strength
  const blurred = blurRgb(src, width, height, sigma)
  const mix = 0.28 + 0.42 * strength
  const out = copyRgba(src)
  for (let i = 0; i < src.length; i += 4) {
    out[i] = src[i] * (1 - mix) + blurred[i] * mix
    out[i + 1] = src[i + 1] * (1 - mix) + blurred[i + 1] * mix
    out[i + 2] = src[i + 2] * (1 - mix) + blurred[i + 2] * mix
  }
  return out
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

export function autoExposureRgba(
  src: Uint8ClampedArray,
  strength: number,
): Uint8ClampedArray {
  if (strength <= 0.01) return copyRgba(src)
  let sum = 0
  const pixels = src.length / 4
  for (let i = 0; i < src.length; i += 4) {
    const v = Math.max(src[i], src[i + 1], src[i + 2])
    sum += v
  }
  const mean = sum / pixels
  if (mean < 1) return copyRgba(src)
  const target = 118
  let ratio = clamp(target / mean, 0.55, 2.15)
  ratio = 1 + (ratio - 1) * strength
  const gamma = 1 / Math.max(ratio, 0.15)
  const lut = new Uint8Array(256)
  for (let i = 0; i < 256; i++) {
    lut[i] = clamp(Math.round((i / 255) ** gamma * 255), 0, 255)
  }
  const out = copyRgba(src)
  for (let i = 0; i < src.length; i += 4) {
    const v = Math.max(src[i], src[i + 1], src[i + 2])
    const v2 = lut[v]
    if (v <= 0) continue
    const scale = v2 / v
    out[i] = src[i] * scale
    out[i + 1] = src[i + 1] * scale
    out[i + 2] = src[i + 2] * scale
  }
  return out
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
        maps[ty][tx] = new Uint8Array(256).map((_, i) => i)
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

export function claheRgba(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number,
): Uint8ClampedArray {
  const clipLimit = 1.0 + 3.2 * Math.max(0, strength)
  const tiles = Math.min(width, height) >= 64 ? 8 : 2
  const luma = new Uint8Array(width * height)
  for (let p = 0, i = 0; p < luma.length; p++, i += 4) {
    luma[p] = clamp(Math.round(lumaAt(src, i)), 0, 255)
  }
  const maps = buildClaheLuts(luma, width, height, tiles, clipLimit)
  const tileW = Math.max(1, Math.ceil(width / tiles))
  const tileH = Math.max(1, Math.ceil(height / tiles))
  const out = copyRgba(src)

  for (let y = 0; y < height; y++) {
    const ty = clamp(Math.floor(y / tileH), 0, tiles - 1)
    const ty1 = Math.min(tiles - 1, ty + 1)
    const fy = tileH <= 1 ? 0 : (y - ty * tileH + 0.5) / tileH
    for (let x = 0; x < width; x++) {
      const tx = clamp(Math.floor(x / tileW), 0, tiles - 1)
      const tx1 = Math.min(tiles - 1, tx + 1)
      const fx = tileW <= 1 ? 0 : (x - tx * tileW + 0.5) / tileW
      const i = (y * width + x) * 4
      const v = luma[y * width + x]
      const a = maps[ty][tx][v]
      const b = maps[ty][tx1][v]
      const c = maps[ty1][tx][v]
      const d = maps[ty1][tx1][v]
      const top = a * (1 - fx) + b * fx
      const bot = c * (1 - fx) + d * fx
      const mapped = top * (1 - fy) + bot * fy
      const scale = v > 1 ? mapped / v : 1
      out[i] = src[i] * scale
      out[i + 1] = src[i + 1] * scale
      out[i + 2] = src[i + 2] * scale
    }
  }
  return out
}

export function unsharpRgba(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number,
): Uint8ClampedArray {
  if (strength <= 0.01) return copyRgba(src)
  const amount = 0.35 + 0.85 * strength
  const radius = 1.2 + 0.6 * strength
  const blurred = blurRgb(src, width, height, radius)
  const out = copyRgba(src)
  for (let i = 0; i < src.length; i += 4) {
    out[i] = src[i] + amount * (src[i] - blurred[i])
    out[i + 1] = src[i + 1] + amount * (src[i + 1] - blurred[i + 1])
    out[i + 2] = src[i + 2] + amount * (src[i + 2] - blurred[i + 2])
  }
  return out
}

export function blendRgba(
  original: Uint8ClampedArray,
  processed: Uint8ClampedArray,
  alpha: number,
): Uint8ClampedArray {
  const t = clamp(alpha, 0, 1)
  if (t >= 0.999) return copyRgba(processed)
  if (t <= 0.001) return copyRgba(original)
  const out = new Uint8ClampedArray(original.length)
  for (let i = 0; i < original.length; i++) {
    out[i] = original[i] * (1 - t) + processed[i] * t
  }
  return out
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

export function enhanceRgba(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  options: EnhanceOptions = {},
): Uint8ClampedArray {
  if (width < 2 || height < 2 || src.length < width * height * 4) {
    throw new MediaError('imagem inválida.')
  }
  const intensity = clamp(options.intensity ?? 0.65, 0, 1)
  const { onProgress, shouldCancel } = options
  checkCancel(shouldCancel)
  report(onProgress, 8, 'lendo')
  const original = copyRgba(src)
  if (intensity <= 0.01) {
    report(onProgress, 100, 'concluído')
    return original
  }

  checkCancel(shouldCancel)
  report(onProgress, 22, 'redução de ruído')
  let work = denoiseRgba(original, width, height, intensity)

  checkCancel(shouldCancel)
  report(onProgress, 40, 'balanço de branco')
  work = whiteBalanceRgba(work, intensity)

  checkCancel(shouldCancel)
  report(onProgress, 58, 'exposição')
  work = autoExposureRgba(work, intensity)

  checkCancel(shouldCancel)
  report(onProgress, 74, 'CLAHE')
  work = claheRgba(work, width, height, intensity)

  checkCancel(shouldCancel)
  report(onProgress, 88, 'nitidez')
  work = unsharpRgba(work, width, height, intensity)

  const processed = blendRgba(original, work, intensity)
  report(onProgress, 100, 'concluído')
  return processed
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
    const sr = 1 + (gains.r - 1) * t
    const sg = 1 + (gains.g - 1) * t
    const sb = 1 + (gains.b - 1) * t
    for (let i = 0; i < work.length; i += 4) {
      work[i] = original[i] * sr
      work[i + 1] = original[i + 1] * sg
      work[i + 2] = original[i + 2] * sb
    }
  }
  work = whiteBalanceRgba(work, t)
  work = autoExposureRgba(work, t * 0.85)
  work = claheRgba(work, width, height, t * 0.75)
  work = unsharpRgba(work, width, height, t * 0.55)
  return blendRgba(original, work, t)
}
