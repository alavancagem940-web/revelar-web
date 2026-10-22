import { describe, expect, it } from 'vitest'
import {
  autoExposureRgba,
  enhanceRgba,
  lumaStddev,
  meanLuma,
  whiteBalanceRgba,
} from './photo-engine.ts'

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

function gradient(width: number, height: number): Uint8ClampedArray {
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      const v = Math.round((x / (width - 1)) * 80 + 20)
      data[i] = v
      data[i + 1] = Math.round(v * 0.7)
      data[i + 2] = Math.round(v * 0.45)
      data[i + 3] = 255
    }
  }
  return data
}

describe('photo engine', () => {
  it('intensity 0 devolve o original', () => {
    const src = gradient(32, 24)
    const out = enhanceRgba(src, 32, 24, { intensity: 0 })
    expect(Array.from(out)).toEqual(Array.from(src))
  })

  it('clareia uma foto subexposta', () => {
    const src = solid(48, 32, 28, 22, 18)
    const out = enhanceRgba(src, 48, 32, { intensity: 1 })
    expect(meanLuma(out)).toBeGreaterThan(meanLuma(src) + 15)
  })

  it('balanço de branco reduz dominância vermelha', () => {
    const src = solid(40, 40, 200, 40, 40)
    const out = whiteBalanceRgba(src, 1)
    expect(out[0]).toBeLessThan(src[0])
    expect(out[1]).toBeGreaterThan(src[1])
  })

  it('exposição automática usa o alvo ~118', () => {
    const src = solid(16, 16, 40, 40, 40)
    const out = autoExposureRgba(src, 1)
    const v = Math.max(out[0], out[1], out[2])
    expect(v).toBeGreaterThan(90)
    expect(v).toBeLessThan(150)
  })

  it('CLAHE aumenta o contraste de um degradê', () => {
    const src = gradient(96, 64)
    const out = enhanceRgba(src, 96, 64, { intensity: 0.8 })
    expect(lumaStddev(out)).toBeGreaterThan(lumaStddev(src) * 0.9)
    expect(meanLuma(out)).toBeGreaterThan(meanLuma(src))
  })

  it('reporta as etapas na ordem', () => {
    const src = gradient(32, 32)
    const steps: string[] = []
    enhanceRgba(src, 32, 32, {
      intensity: 0.65,
      onProgress: (_p, status) => steps.push(status),
    })
    expect(steps[0]).toBe('lendo')
    expect(steps).toContain('redução de ruído')
    expect(steps).toContain('balanço de branco')
    expect(steps).toContain('exposição')
    expect(steps).toContain('CLAHE')
    expect(steps).toContain('nitidez')
    expect(steps.at(-1)).toBe('concluído')
  })
})
