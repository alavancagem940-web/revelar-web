/// <reference lib="webworker" />
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
    const outBuffer = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength)
    self.postMessage({ type: 'done', jobId, width, height, buffer: outBuffer }, [
      outBuffer,
    ])
  } catch (err) {
    const message = err instanceof Error ? err.message : 'falha no aprimoramento'
    self.postMessage({
      type: 'error',
      jobId,
      message: message === 'cancelado' ? 'cancelado' : message,
    })
  }
})
