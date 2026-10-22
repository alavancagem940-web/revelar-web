/// <reference lib="webworker" />
import { ENGINE_BUILD } from '../lib/build.ts'
import { enhanceRgba } from '../lib/photo-engine.ts'

type InMessage = {
  type: 'enhance'
  jobId: string
  width: number
  height: number
  intensity: number
  buffer: ArrayBuffer
}

let cancelledJob = ''

self.addEventListener('message', (event: MessageEvent<InMessage | { type: 'cancel'; jobId: string }>) => {
  const data = event.data
  if (data.type === 'cancel') {
    cancelledJob = data.jobId
    return
  }
  if (data.type !== 'enhance') return
  const { jobId, width, height, intensity, buffer } = data
  try {
    const src = new Uint8ClampedArray(buffer)
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
})
