import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { enhanceRgba, highFreqEnergy, lumaRange } from '../src/lib/photo-engine.ts'
import { decodePng, encodePng } from '../src/lib/png.ts'
import { recoverRgba } from '../src/lib/recovery.ts'

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
  const n = Math.min(a.length, b.length) / 4
  for (let i = 0; i < n * 4; i += 4) {
    acc +=
      (Math.abs(a[i] - b[i]) + Math.abs(a[i + 1] - b[i + 1]) + Math.abs(a[i + 2] - b[i + 2])) / 3
  }
  return acc / n
}

function scaleToHeight(
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dstH: number,
): { data: Uint8ClampedArray; width: number; height: number } {
  const dstW = Math.max(2, Math.round((srcW * dstH) / srcH))
  const out = new Uint8ClampedArray(dstW * dstH * 4)
  for (let y = 0; y < dstH; y++) {
    const sy = ((y + 0.5) * srcH) / dstH - 0.5
    const y0 = Math.max(0, Math.min(srcH - 1, Math.floor(sy)))
    const y1 = Math.min(srcH - 1, y0 + 1)
    const fy = sy - y0
    for (let x = 0; x < dstW; x++) {
      const sx = ((x + 0.5) * srcW) / dstW - 0.5
      const x0 = Math.max(0, Math.min(srcW - 1, Math.floor(sx)))
      const x1 = Math.min(srcW - 1, x0 + 1)
      const fx = sx - x0
      const i00 = (y0 * srcW + x0) * 4
      const i10 = (y0 * srcW + x1) * 4
      const i01 = (y1 * srcW + x0) * 4
      const i11 = (y1 * srcW + x1) * 4
      const o = (y * dstW + x) * 4
      for (let c = 0; c < 4; c++) {
        const top = src[i00 + c] * (1 - fx) + src[i10 + c] * fx
        const bot = src[i01 + c] * (1 - fx) + src[i11 + c] * fx
        out[o + c] = top * (1 - fy) + bot * fy
      }
    }
  }
  return { data: out, width: dstW, height: dstH }
}

function fillRect(
  data: Uint8ClampedArray,
  width: number,
  x0: number,
  y0: number,
  w: number,
  h: number,
  r: number,
  g: number,
  b: number,
): void {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const i = (y * width + x) * 4
      data[i] = r
      data[i + 1] = g
      data[i + 2] = b
      data[i + 3] = 255
    }
  }
}

function blit(
  dest: Uint8ClampedArray,
  destW: number,
  src: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  dx: number,
  dy: number,
): void {
  for (let y = 0; y < srcH; y++) {
    dest.set(
      src.subarray(y * srcW * 4, (y + 1) * srcW * 4),
      ((dy + y) * destW + dx) * 4,
    )
  }
}

const alvoPath = '/cursor/stores/self/media/revelar/16-qualidade-alvo.png'
const srcPath = '/cursor/stores/self/media/revelar/17-teste-original.png'
const dest = process.argv[2] || '/cursor/stores/self/media/revelar-web'
mkdirSync(dest, { recursive: true })
copyFileSync(srcPath, `${dest}/18-before.png`)

const foto2 = decodePng(new Uint8Array(readFileSync(srcPath)))
const foto1 = decodePng(new Uint8Array(readFileSync(alvoPath)))

const rec2 = recoverRgba(foto2.data, foto2.width, foto2.height)
const after2 = enhanceRgba(foto2.data, foto2.width, foto2.height, { intensity: 1 })
writeFileSync(`${dest}/19-after.png`, encodePng(after2.width, after2.height, after2.data))

const after1 = enhanceRgba(foto1.data, foto1.width, foto1.height, { intensity: 1 })

const colH = 720
const a = scaleToHeight(foto2.data, foto2.width, foto2.height, colH)
const b = scaleToHeight(after2.data, after2.width, after2.height, colH)
const cropY = Math.floor(foto1.height * 0.38)
const cropH = Math.floor(foto1.height * 0.55)
const crop = new Uint8ClampedArray(foto1.width * cropH * 4)
for (let y = 0; y < cropH; y++) {
  crop.set(
    foto1.data.subarray((cropY + y) * foto1.width * 4, (cropY + y + 1) * foto1.width * 4),
    y * foto1.width * 4,
  )
}
const c = scaleToHeight(crop, foto1.width, cropH, colH)
const gap = 14
const header = 8
const boardW = a.width + b.width + c.width + gap * 4
const boardH = colH + gap * 2 + header
const board = new Uint8ClampedArray(boardW * boardH * 4)
fillRect(board, boardW, 0, 0, boardW, boardH, 18, 18, 18)
let x = gap
fillRect(board, boardW, x, gap, a.width, header, 80, 80, 80)
blit(board, boardW, a.data, a.width, a.height, x, gap + header)
x += a.width + gap
fillRect(board, boardW, x, gap, b.width, header, 201, 162, 39)
blit(board, boardW, b.data, b.width, b.height, x, gap + header)
x += b.width + gap
fillRect(board, boardW, x, gap, c.width, header, 90, 140, 110)
blit(board, boardW, c.data, c.width, c.height, x, gap + header)
writeFileSync(`${dest}/20-vs-alvo.png`, encodePng(boardW, boardH, board))

const bg2 = patchStd(foto2.data, 8, 8, 36, 28, foto2.width)
const bgAfter = patchStd(after2.data, 16, 16, 80, 60, after2.width)
const bg1 = patchStd(foto1.data, 20, 20, 80, 60, foto1.width)
const bg1After = patchStd(after1.data, 20, 20, 80, 60, after1.width)

const summary = {
  foto2: {
    before: `${foto2.width}x${foto2.height}`,
    after: `${after2.width}x${after2.height}`,
    scale: after2.scale,
    recoveredScale: rec2.scale,
    deblocked: rec2.deblocked,
    lumaBefore: lumaRange(foto2.data, 1, 99),
    lumaAfter: lumaRange(after2.data, 1, 99),
    hfBefore: Number(highFreqEnergy(foto2.data, foto2.width, foto2.height).toFixed(3)),
    hfAfter: Number(highFreqEnergy(after2.data, after2.width, after2.height).toFixed(3)),
    bgStdBefore: Number(bg2.toFixed(3)),
    bgStdAfter: Number(bgAfter.toFixed(3)),
  },
  foto1: {
    before: `${foto1.width}x${foto1.height}`,
    after: `${after1.width}x${after1.height}`,
    scale: after1.scale,
    mad: Number(meanAbsDiff(foto1.data, after1.data).toFixed(3)),
    hfBefore: Number(highFreqEnergy(foto1.data, foto1.width, foto1.height).toFixed(3)),
    hfAfter: Number(highFreqEnergy(after1.data, after1.width, after1.height).toFixed(3)),
    bgStdBefore: Number(bg1.toFixed(3)),
    bgStdAfter: Number(bg1After.toFixed(3)),
  },
}
console.log(JSON.stringify(summary, null, 2))

if (after2.width === 590 || after2.height === 885) {
  throw new Error('after bateu o tamanho da foto 3 (upscale sujo).')
}
if (after2.scale <= 1.01 || after2.width === foto2.width) {
  throw new Error('fonte pequena tinha que subir (236px é compressão do chat).')
}
if (after1.scale !== 1 || after1.width !== foto1.width) {
  throw new Error('foto 1 (já 1600) não pode upscalar.')
}
if (bgAfter > 8) {
  throw new Error(`fundo da foto 2 granulou (std=${bgAfter.toFixed(2)}).`)
}
if (bg1After > bg1 + 2.5) {
  throw new Error('foto 1 piorou o fundo.')
}
