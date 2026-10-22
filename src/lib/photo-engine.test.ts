import { describe, expect, it } from 'vitest'
import { artifactBarPixels, washedBarPixels } from './sample.ts'
import {
  enhanceRgba,
  highFreqEnergy,
  lumaRange,
  lumaStddev,
  labToRgba,
  rgbToLab,
  usesLabPath,
  whiteBalanceRgba,
} from './photo-engine.ts'
import {
  blockinessScore,
  deblockRgba,
  lanczosResize,
  planUpscale,
  recoverRgba,
} from './recovery.ts'

function solid(
  width: number,
  height: number,
  r: number,
  g: number,
  b: number,
): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = 255
  }
  return data
}

function washedGradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const stripe = x % 6 < 2 ? 8 : 0
      const v = 118 + Math.round((x / (width - 1)) * 36) + stripe
      data[i] = v
      data[i + 1] = v - 6
      data[i + 2] = v - 14
      data[i + 3] = 255
    }
  }
  return data
}

function blocky(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const bx = Math.floor(x / 8)
      const by = Math.floor(y / 8)
      const v = 90 + ((bx + by) % 2) * 50
      data[i] = v
      data[i + 1] = v
      data[i + 2] = v
      data[i + 3] = 255
    }
  }
  return data
}

/** Retrato nítido: listras (cabelo/tecido) + fundo liso. */
function sharpStudio(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      let r = 186
      let g = 186
      let b = 190
      if (x < width * 0.42) {
        const stripe = x % 4 < 2 ? 16 : 238
        r = stripe
        g = stripe
        b = stripe
      } else if (x > width * 0.58 && x < width * 0.78 && y > height * 0.22 && y < height * 0.88) {
        r = 196
        g = 32
        b = 48
        if ((y + x) % 5 === 0) {
          r = 160
          g = 22
          b = 36
        }
      }
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
  return data
}

function patchStd(
  data: Uint8ClampedArray,
  x0: number,
  y0: number,
  pw: number,
  ph: number,
  width: number,
): number {
  const values: number[] = []
  for (let y = y0; y < y0 + ph; y++) {
    for (let x = x0; x < x0 + pw; x++) {
      const i = (y * width + x) * 4
      values.push(0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2])
    }
  }
  const mean = values.reduce((a, b) => a + b, 0) / values.length
  let acc = 0
  for (const v of values) acc += (v - mean) * (v - mean)
  return Math.sqrt(acc / values.length)
}

function meanAbsDiff(a: Uint8ClampedArray, b: Uint8ClampedArray): number {
  let acc = 0
  const n = a.length / 4
  for (let i = 0; i < a.length; i += 4) {
    acc +=
      (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3
  }
  return acc / n
}

describe('photo engine', () => {
  it('intensity 0 devolve o original', () => {
    const src = washedGradient(32, 24)
    const out = enhanceRgba(src, 32, 24, { intensity: 0 })
    expect(Array.from(out.data)).toEqual(Array.from(src))
    expect(out.width).toBe(32)
    expect(out.height).toBe(24)
  })

  it('LAB ida e volta preserva branco e preto', () => {
    const src = new Uint8ClampedArray([255, 255, 255, 255, 0, 0, 0, 255])
    const lab = rgbToLab(src, 2)
    expect(lab.L[0]).toBeGreaterThan(98)
    expect(lab.L[1]).toBeLessThan(2)
    const back = labToRgba(lab, src, 2)
    expect(back[0]).toBeGreaterThan(250)
    expect(back[4]).toBeLessThan(5)
  })

  it('foto lavada ganha pretos profundos e brancos limpos', () => {
    const src = washedGradient(96, 64)
    const out = enhanceRgba(src, 96, 64, { intensity: 1, recover: false })
    const before = lumaRange(src, 1, 99)
    const after = lumaRange(out.data, 1, 99)
    expect(after.lo).toBeLessThan(before.lo - 25)
    expect(after.hi).toBeGreaterThan(before.hi + 20)
    expect(lumaStddev(out.data)).toBeGreaterThan(lumaStddev(src) * 1.6)
  })

  it('CLAHE + unsharp de alta frequência revelam microtextura', () => {
    const src = washedGradient(96, 64)
    const out = enhanceRgba(src, 96, 64, { intensity: 1, recover: false })
    expect(highFreqEnergy(out.data, 96, 64)).toBeGreaterThan(highFreqEnergy(src, 96, 64) * 1.8)
  })

  it('amostra plana de bar ganha punch', () => {
    const width = 160
    const height = 120
    const src = washedBarPixels(width, height)
    const out = enhanceRgba(src, width, height, { intensity: 1, recover: false })
    const before = lumaRange(src, 1, 99)
    const after = lumaRange(out.data, 1, 99)
    expect(after.hi - after.lo).toBeGreaterThan((before.hi - before.lo) * 1.5)
    expect(after.lo).toBeLessThan(28)
    expect(after.hi).toBeGreaterThan(70)
    expect(highFreqEnergy(out.data, width, height)).toBeGreaterThan(
      highFreqEnergy(src, width, height) * 1.4,
    )
  })

  it('balanço de branco reduz dominância vermelha', () => {
    const src = solid(40, 40, 200, 40, 40)
    const out = whiteBalanceRgba(src, 1)
    expect(out[0]).toBeLessThan(src[0])
    expect(out[1]).toBeGreaterThan(src[1])
  })

  it('foto de celular cheia não entra no LAB lento', () => {
    expect(usesLabPath(900, 1600)).toBe(true)
    expect(usesLabPath(897, 1345)).toBe(true)
    expect(usesLabPath(4032, 3024)).toBe(false)
    expect(usesLabPath(1920, 1080)).toBe(false)
  })

  it('foto 2 MP no caminho rápido mantém tamanho e não trava', () => {
    const width = 1600
    const height = 1200
    const src = solid(width, height, 140, 132, 118)
    const t0 = Date.now()
    const out = enhanceRgba(src, width, height, { intensity: 1, recover: false })
    expect(Date.now() - t0).toBeLessThan(5000)
    expect(out.width).toBe(width)
    expect(out.height).toBe(height)
  })

  it('sem recover preserva o tamanho', () => {
    const src = washedGradient(80, 50)
    const out = enhanceRgba(src, 80, 50, { intensity: 1, recover: false })
    expect(out.data.length).toBe(src.length)
    expect(out.scale).toBe(1)
  })

  it('reporta as etapas na ordem', () => {
    const src = washedGradient(32, 32)
    const steps: string[] = []
    enhanceRgba(src, 32, 32, {
      intensity: 1,
      recover: false,
      onProgress: (_p, status) => steps.push(status),
    })
    expect(steps[0]).toBe('lendo')
    expect(steps).toContain('balanço de branco')
    expect(steps).toContain('pretos e brancos')
    expect(steps).toContain('CLAHE')
    expect(steps).toContain('nitidez')
    expect(steps.at(-1)).toBe('concluído')
    expect(steps).not.toContain('exposição')
  })
})

describe('recovery', () => {
  it('não reduz foto já grande', () => {
    expect(planUpscale(4000, 3000, 0.2)).toEqual({ width: 4000, height: 3000, scale: 1 })
    expect(planUpscale(1920, 1080, 0.1)).toEqual({ width: 1920, height: 1080, scale: 1 })
  })

  it('fonte pequena sobe rumo ao lado longo de celular, sem o 590×885 sujo', () => {
    const plan = planUpscale(236, 354, 0.34)
    expect(plan.scale).toBeGreaterThan(2.8)
    expect(plan.width).not.toBe(590)
    expect(plan.height).not.toBe(885)
    expect(Math.max(plan.width, plan.height)).toBeGreaterThanOrEqual(1200)
  })

  it('foto já em tamanho de celular não upscala', () => {
    expect(planUpscale(900, 1600, 0.2).scale).toBe(1)
    expect(planUpscale(1200, 1600, 0.3).scale).toBe(1)
  })

  it('sobe foto pequena e mole rumo a 1600', () => {
    const plan = planUpscale(400, 280, 0.7)
    expect(plan.scale).toBeGreaterThan(1.5)
    expect(plan.width).toBeGreaterThan(400)
    expect(Math.max(plan.width, plan.height)).toBeGreaterThanOrEqual(900)
  })

  it('original nítido não sofre deblock; thumbnail sobe limpa', () => {
    const src = sharpStudio(96, 72)
    const rec = recoverRgba(src, 96, 72)
    expect(rec.deblocked).toBe(false)
    expect(rec.scale).toBeGreaterThan(1)
    expect(rec.width).toBeGreaterThan(96)
  })

  it('retrato nítido ganha resolução sem granir o fundo', () => {
    const width = 120
    const height = 90
    const src = sharpStudio(width, height)
    const rec = recoverRgba(src, width, height)
    const out = enhanceRgba(src, width, height, { intensity: 1 })
    expect(out.width).toBe(rec.width)
    expect(out.height).toBe(rec.height)
    expect(out.scale).toBeGreaterThan(1)
    expect(out.width).not.toBe(590)
    const bgX = Math.floor(rec.width * 0.84)
    const bgH = Math.max(8, Math.floor(rec.height * 0.12))
    const bgBefore = patchStd(rec.data, bgX, 2, rec.width - bgX - 2, bgH, rec.width)
    const bgAfter = patchStd(out.data, bgX, 2, rec.width - bgX - 2, bgH, rec.width)
    expect(bgAfter).toBeLessThan(bgBefore + 2.8)
    expect(meanAbsDiff(rec.data, out.data)).toBeGreaterThan(0.15)
  })

  it('Lanczos 2× preserva cor sólida', () => {
    const src = solid(4, 4, 200, 40, 40)
    const out = lanczosResize(src, 4, 4, 8, 8)
    expect(out.length).toBe(8 * 8 * 4)
    expect(out[0]).toBeGreaterThan(180)
    expect(out[1]).toBeLessThan(60)
  })

  it('deblock reduz costura 8×8', () => {
    const src = blocky(64, 48)
    const before = blockinessScore(src, 64, 48)
    const out = deblockRgba(src, 64, 48, 1)
    expect(blockinessScore(out, 64, 48)).toBeLessThan(before)
  })

  it('foto compactada pequena sai maior e com mais contraste', () => {
    const width = 80
    const height = 56
    const src = artifactBarPixels(width, height)
    const out = enhanceRgba(src, width, height, { intensity: 1 })
    expect(out.width).toBeGreaterThan(width)
    expect(out.height).toBeGreaterThan(height)
    expect(out.scale).toBeGreaterThan(1)
    const before = lumaRange(src, 1, 99)
    const after = lumaRange(out.data, 1, 99)
    expect(after.hi - after.lo).toBeGreaterThan(before.hi - before.lo)
  })
})
