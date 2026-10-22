/// <reference lib="webworker" />
import { ENGINE_BUILD } from '../lib/build.ts'
import { enhanceRgba } from '../lib/photo-engine.ts'

type InMessage = {
  type: 'enhance'
  jobId: string
  intensity: number
  bitmap?: ImageBitmap
  width?: number
  height?: number
  buffer?: ArrayBuffer
}

let cancelledJob = ''

function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

self.addEventListener('message', (event: MessageEvent<InMessage | { type: 'cancel'; jobId: string }>) => {
  const data = event.data
  if (data.type === 'cancel') {
    cancelledJob = data.jobId
    return
  }
  if (data.type !== 'enhance') return
  void runEnhance(data)
})

async function runEnhance(data: InMessage): Promise<void> {
  const { jobId, intensity } = data
  try {
    self.postMessage({ type: 'progress', jobId, percent: 5, status: 'lendo' })
    await tick()
    if (cancelledJob === jobId) throw Object.assign(new Error('cancelado'), { name: 'CancelledError' })

    let width: number
    let height: number
    let src: Uint8ClampedArray
    if (data.bitmap) {
      const bmp = data.bitmap
      width = bmp.width
      height = bmp.height
      const canvas = new OffscreenCanvas(width, height)
      const ctx = canvas.getContext('2d', { willReadFrequently: true })
      if (!ctx) throw new Error('canvas 2D indisponível neste navegador.')
      ctx.drawImage(bmp, 0, 0)
      bmp.close()
      src = ctx.getImageData(0, 0, width, height).data
    } else {
      if (data.width == null || data.height == null || !data.buffer) {
        throw new Error('imagem inválida.')
      }
      width = data.width
      height = data.height
      src = new Uint8ClampedArray(data.buffer)
    }

    self.postMessage({
      type: 'progress',
      jobId,
      percent: 12,
      status: Math.max(width, height) < 900 ? 'Lanczos' : 'desbloqueio',
    })
    await tick()

    const out = enhanceRgba(src, width, height, {
      intensity,
      shouldCancel: () => cancelledJob === jobId,
      onProgress: (percent, status) => {
        self.postMessage({ type: 'progress', jobId, percent, status })
      },
    })
    const outBuffer = out.data.buffer.slice(
      out.data.byteOffset,
      out.data.byteOffset + out.data.byteLength,
    )
    self.postMessage(
      {
        type: 'done',
        jobId,
        width: out.width,
        height: out.height,
        engine: ENGINE_BUILD,
        buffer: outBuffer,
      },
      [outBuffer],
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : 'falha no aprimoramento'
    self.postMessage({
      type: 'error',
      jobId,
      message: message === 'cancelado' ? 'cancelado' : message,
    })
  }
}
