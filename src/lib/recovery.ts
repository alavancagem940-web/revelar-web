import { clamp } from './utils.ts'

const LANCZOS_A = 3

function lumaAt(data: Uint8ClampedArray, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
}

function sinc(x: number): number {
  if (x === 0) return 1
  const pix = Math.PI * x
  return Math.sin(pix) / pix
}

export function lanczosKernel(x: number, a = LANCZOS_A): number {
  const ax = Math.abs(x)
  if (ax < 1e-8) return 1
  if (ax >= a) return 0
  return sinc(x) * sinc(x / a)
}

/** 0 = sem blocos; >1 indica costura 8×8 de JPEG. */
export function blockinessScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  if (width < 16 || height < 16) return 0
  let bound = 0
  let inner = 0
  let n = 0
  for (let x = 8; x < width - 1; x += 8) {
    for (let y = 0; y < height; y += 2) {
      const i = (y * width + x) * 4
      const left = lumaAt(data, i - 4)
      const right = lumaAt(data, i)
      bound += Math.abs(left - right)
      const mid = (y * width + (x - 4)) * 4
      inner += Math.abs(lumaAt(data, mid - 4) - lumaAt(data, mid))
      n++
    }
  }
  for (let y = 8; y < height - 1; y += 8) {
    for (let x = 0; x < width; x += 2) {
      const i = (y * width + x) * 4
      const up = lumaAt(data, i - width * 4)
      const down = lumaAt(data, i)
      bound += Math.abs(up - down)
      const mid = ((y - 4) * width + x) * 4
      inner += Math.abs(lumaAt(data, mid - width * 4) - lumaAt(data, mid))
      n++
    }
  }
  if (n === 0) return 0
  const meanInner = inner / n
  const meanBound = bound / n
  return meanBound / Math.max(0.8, meanInner)
}

export function deblockStrength(blockiness: number): number {
  return clamp((blockiness - 1.0) / 0.55, 0, 1)
}

/** 0 = nítida, 1 = mole/apagada. */
export function softnessScore(
  data: Uint8ClampedArray,
  width: number,
  height: number,
): number {
  let acc = 0
  let n = 0
  const step = Math.max(1, Math.floor(Math.min(width, height) / 96))
  for (let y = 1; y < height - 1; y += step) {
    for (let x = 1; x < width - 1; x += step) {
      const i = (y * width + x) * 4
      const c = lumaAt(data, i)
      const lap =
        Math.abs(lumaAt(data, i - 4) - c) +
        Math.abs(lumaAt(data, i + 4) - c) +
        Math.abs(lumaAt(data, i - width * 4) - c) +
        Math.abs(lumaAt(data, i + width * 4) - c)
      acc += lap
      n++
    }
  }
  const mean = acc / Math.max(1, n)
  return 1 - clamp(mean / 28, 0, 1)
}

function blendSeam(
  data: Uint8ClampedArray,
  i0: number,
  i1: number,
  amount: number,
): void {
  for (let c = 0; c < 3; c++) {
    const a = data[i0 + c]
    const b = data[i1 + c]
    const jump = Math.abs(a - b)
    if (jump < 3) continue
    const mix = amount * clamp((jump - 2) / 18, 0, 1)
    const mid = (a + b) * 0.5
    data[i0 + c] = a + (mid - a) * mix
    data[i1 + c] = b + (mid - b) * mix
  }
}

/**
 * Suaviza costuras 8×8 e mosquito de JPEG, preservando bordas reais.
 * `strength` 0 não altera; em foto boa fica perto de 0.
 */
export function deblockRgba(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  strength: number,
): Uint8ClampedArray {
  const t = clamp(strength, 0, 1)
  if (t <= 0.03) return new Uint8ClampedArray(src)
  const out = new Uint8ClampedArray(src)
  const seam = 0.35 + 0.55 * t

  for (let x = 8; x < width; x += 8) {
    for (let y = 0; y < height; y++) {
      const i1 = (y * width + x) * 4
      const i0 = i1 - 4
      const leftInner = x >= 2 ? Math.abs(out[i0] - out[i0 - 4]) : 0
      const rightInner = x + 1 < width ? Math.abs(out[i1] - out[i1 + 4]) : 0
      const jump = Math.abs(out[i0] - out[i1])
      if (jump > leftInner + rightInner + 3) blendSeam(out, i0, i1, seam)
    }
  }
  for (let y = 8; y < height; y += 8) {
    for (let x = 0; x < width; x++) {
      const i1 = (y * width + x) * 4
      const i0 = i1 - width * 4
      const upInner = y >= 2 ? Math.abs(out[i0] - out[i0 - width * 4]) : 0
      const downInner = y + 1 < height ? Math.abs(out[i1] - out[i1 + width * 4]) : 0
      const jump = Math.abs(out[i0] - out[i1])
      if (jump > upInner + downInner + 3) blendSeam(out, i0, i1, seam)
    }
  }

  let next: Uint8ClampedArray = out
  if (t >= 0.18) next = mosquitoSmooth(next, width, height, 0.25 + 0.4 * t)
  if (t >= 0.28) {
    const blurred = blurRgb(next, width, height, 0.85 + 0.55 * t)
    const mix = 0.22 + 0.28 * t
    for (let i = 0; i < next.length; i += 4) {
      next[i] = next[i] * (1 - mix) + blurred[i] * mix
      next[i + 1] = next[i + 1] * (1 - mix) + blurred[i + 1] * mix
      next[i + 2] = next[i + 2] * (1 - mix) + blurred[i + 2] * mix
    }
  }
  return next
}

function blurRgb(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  sigma: number,
): Uint8ClampedArray {
  const radius = Math.max(1, Math.min(5, Math.round(sigma * 2)))
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
  const tmp = new Float32Array(width * height * 3)
  const dest = new Uint8ClampedArray(src.length)
  dest.set(src)

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = 0; k < size; k++) {
        const xx = clamp(x + k - radius, 0, width - 1)
        const i = (y * width + xx) * 4
        const w = kernel[k]
        r += src[i] * w
        g += src[i + 1] * w
        b += src[i + 2] * w
      }
      const o = (y * width + x) * 3
      tmp[o] = r
      tmp[o + 1] = g
      tmp[o + 2] = b
    }
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0
      let g = 0
      let b = 0
      for (let k = 0; k < size; k++) {
        const yy = clamp(y + k - radius, 0, height - 1)
        const o = (yy * width + x) * 3
        const w = kernel[k]
        r += tmp[o] * w
        g += tmp[o + 1] * w
        b += tmp[o + 2] * w
      }
      const i = (y * width + x) * 4
      dest[i] = r
      dest[i + 1] = g
      dest[i + 2] = b
    }
  }
  return dest
}

function mosquitoSmooth(
  src: Uint8ClampedArray,
  width: number,
  height: number,
  amount: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src.length)
  out.set(src)
  const sigma = 10 + 8 * amount
  const twoS2 = 2 * sigma * sigma
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const i = (y * width + x) * 4
      const cr = src[i]
      const cg = src[i + 1]
      const cb = src[i + 2]
      let wr = 0
      let wg = 0
      let wb = 0
      let wsum = 0
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const j = ((y + dy) * width + (x + dx)) * 4
          const dr = src[j] - cr
          const dg = src[j + 1] - cg
          const db = src[j + 2] - cb
          const d2 = dr * dr + dg * dg + db * db
          const w = Math.exp(-d2 / twoS2)
          wr += src[j] * w
          wg += src[j + 1] * w
          wb += src[j + 2] * w
          wsum += w
        }
      }
      const inv = 1 / wsum
      out[i] = cr + (wr * inv - cr) * amount
      out[i + 1] = cg + (wg * inv - cg) * amount
      out[i + 2] = cb + (wb * inv - cb) * amount
    }
  }
  return out
}

export const UPSCALE_TARGET = 1920

export function planUpscale(
  width: number,
  height: number,
  softness: number,
): { width: number; height: number; scale: number } {
  const longest = Math.max(width, height)
  if (longest < 2) return { width, height, scale: 1 }
  let scale = 1
  const pixelCap = 8_000_000 / Math.max(1, width * height)
  if (longest < 1024) {
    scale = Math.min(2.5, pixelCap, 1600 / longest)
  } else if (longest < 1600) {
    scale = Math.min(2, pixelCap, 1600 / longest)
  } else if (softness > 0.62 && longest < 2200) {
    scale = Math.min(1.5, pixelCap, UPSCALE_TARGET / longest)
  }
  if (scale < 1.08) return { width, height, scale: 1 }
  return {
    width: Math.max(width, Math.round(width * scale)),
    height: Math.max(height, Math.round(height * scale)),
    scale,
  }
}

function lanczosWeights(srcLen: number, dstLen: number, a = LANCZOS_A): {
  index: Int16Array
  weight: Float32Array
  taps: number
} {
  const taps = a * 2
  const index = new Int16Array(dstLen * taps)
  const weight = new Float32Array(dstLen * taps)
  for (let i = 0; i < dstLen; i++) {
    const center = ((i + 0.5) * srcLen) / dstLen - 0.5
    const left = Math.ceil(center - a)
    let sum = 0
    const base = i * taps
    for (let t = 0; t < taps; t++) {
      const src = left + t
      const w = lanczosKernel(center - src, a)
      index[base + t] = src
      weight[base + t] = w
      sum += w
    }
    const inv = sum === 0 ? 1 : 1 / sum
    for (let t = 0; t < taps; t++) weight[base + t] *= inv
  }
  return { index, weight, taps }
}

function sampleClamped(src: number, len: number): number {
  if (src < 0) return 0
  if (src >= len) return len - 1
  return src
}

/** Upscale Lanczos-3. Nunca reduz. */
export function lanczosResize(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstW: number,
  dstH: number,
): Uint8ClampedArray {
  if (dstW <= srcW && dstH <= srcH) return new Uint8ClampedArray(src)
  const horiz = lanczosWeights(srcW, dstW)
  const tmp = new Float32Array(dstW * srcH * 4)

  for (let y = 0; y < srcH; y++) {
    const srcRow = y * srcW * 4
    const tmpRow = y * dstW * 4
    for (let x = 0; x < dstW; x++) {
      const base = x * horiz.taps
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let t = 0; t < horiz.taps; t++) {
        const sx = sampleClamped(horiz.index[base + t], srcW)
        const w = horiz.weight[base + t]
        const i = srcRow + sx * 4
        r += src[i] * w
        g += src[i + 1] * w
        b += src[i + 2] * w
        a += src[i + 3] * w
      }
      const o = tmpRow + x * 4
      tmp[o] = r
      tmp[o + 1] = g
      tmp[o + 2] = b
      tmp[o + 3] = a
    }
  }

  const vert = lanczosWeights(srcH, dstH)
  const out = new Uint8ClampedArray(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    const base = y * vert.taps
    const dstRow = y * dstW * 4
    for (let x = 0; x < dstW; x++) {
      let r = 0
      let g = 0
      let b = 0
      let a = 0
      for (let t = 0; t < vert.taps; t++) {
        const sy = sampleClamped(vert.index[base + t], srcH)
        const w = vert.weight[base + t]
        const i = (sy * dstW + x) * 4
        r += tmp[i] * w
        g += tmp[i + 1] * w
        b += tmp[i + 2] * w
        a += tmp[i + 3] * w
      }
      const o = dstRow + x * 4
      out[o] = r
      out[o + 1] = g
      out[o + 2] = b
      out[o + 3] = a
    }
  }
  return out
}

export function recoverRgba(
  src: Uint8ClampedArray,
  width: number,
  height: number,
): {
  data: Uint8ClampedArray
  width: number
  height: number
  blockiness: number
  softness: number
  deblocked: boolean
  scale: number
} {
  const blockiness = blockinessScore(src, width, height)
  const softness = softnessScore(src, width, height)
  const plan = planUpscale(width, height, softness)
  const boost = plan.scale > 1.4 ? 0.16 * softness : 0
  const strength = clamp(deblockStrength(blockiness) + boost, 0, 1)
  let data = strength > 0.04 ? deblockRgba(src, width, height, strength) : new Uint8ClampedArray(src)
  if (plan.scale > 1) {
    data = lanczosResize(data, width, height, plan.width, plan.height)
    return {
      data,
      width: plan.width,
      height: plan.height,
      blockiness,
      softness,
      deblocked: strength > 0.04,
      scale: plan.scale,
    }
  }
  return {
    data,
    width,
    height,
    blockiness,
    softness,
    deblocked: strength > 0.04,
    scale: 1,
  }
}
