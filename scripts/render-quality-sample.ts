import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { enhanceRgba, highFreqEnergy, lumaRange, lumaStddev } from '../src/lib/photo-engine.ts'
import { decodePng, encodePng } from '../src/lib/png.ts'
import { recoverRgba, softnessScore } from '../src/lib/recovery.ts'

function lumaAt(data: Uint8ClampedArray, i: number): number {
  return 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
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
      values.push(lumaAt(data, (y * width + x) * 4))
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

const srcPath = '/cursor/stores/self/media/revelar/17-teste-original.png'
const dest = process.argv[2] || '/cursor/stores/self/media/revelar-web'
mkdirSync(dest, { recursive: true })
copyFileSync(srcPath, `${dest}/16-quality-before.png`)

const bytes = new Uint8Array(readFileSync(srcPath))
const png = decodePng(bytes)
const recovered = recoverRgba(png.data, png.width, png.height)
const after = enhanceRgba(png.data, png.width, png.height, { intensity: 1 })
writeFileSync(`${dest}/17-quality-after.png`, encodePng(after.width, after.height, after.data))

const beforeRange = lumaRange(png.data, 1, 99)
const afterRange = lumaRange(after.data, 1, 99)
const bgBefore = patchStd(png.data, 8, 8, 36, 28, png.width)
const bgAfter = patchStd(after.data, 8, 8, 36, 28, after.width)
const mad = meanAbsDiff(png.data, after.data)
const soft = softnessScore(png.data, png.width, png.height)

console.log(
  JSON.stringify(
    {
      before: `${png.width}x${png.height}`,
      after: `${after.width}x${after.height}`,
      scale: after.scale,
      recoveredScale: recovered.scale,
      deblocked: recovered.deblocked,
      softness: Number(soft.toFixed(3)),
      mad: Number(mad.toFixed(3)),
      lumaBefore: beforeRange,
      lumaAfter: afterRange,
      bgStdBefore: Number(bgBefore.toFixed(3)),
      bgStdAfter: Number(bgAfter.toFixed(3)),
      hfBefore: Number(highFreqEnergy(png.data, png.width, png.height).toFixed(3)),
      hfAfter: Number(highFreqEnergy(after.data, after.width, after.height).toFixed(3)),
      stdBefore: Number(lumaStddev(png.data).toFixed(3)),
      stdAfter: Number(lumaStddev(after.data).toFixed(3)),
    },
    null,
    2,
  ),
)

if (after.width === 590 || after.height === 885) {
  throw new Error('after bateu o tamanho da foto 3 (upscale sujo).')
}
if (after.scale !== 1) {
  throw new Error(`estúdio nítido não deveria upscalar (scale=${after.scale}).`)
}
if (mad < 1.0) {
  throw new Error(`after no-op (mad=${mad.toFixed(3)}). punch precisa alterar pretos/textura.`)
}
if (bgAfter > bgBefore + 3.5) {
  throw new Error(`fundo granulou (${bgBefore.toFixed(2)} → ${bgAfter.toFixed(2)}).`)
}
