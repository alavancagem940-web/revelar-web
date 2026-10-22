import { ENGINE_BUILD } from './build.ts'

export type WorkerProgress = { percent: number; status: string }

type DoneMessage = {
  type: 'done'
  jobId: string
  width: number
  height: number
  buffer: ArrayBuffer
}

type ErrorMessage = {
  type: 'error'
  jobId: string
  message: string
}

type ProgressMessage = {
  type: 'progress'
  jobId: string
  percent: number
  status: string
}

let worker: Worker | null = null
let generation = 0

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('../workers/enhance.worker.ts', import.meta.url), {
      type: 'module',
      name: `revelar-enhance-${ENGINE_BUILD}`,
    })
  }
  return worker
}

export function enhancePhotoInWorker(
  imageData: ImageData,
  intensity: number,
  signal: AbortSignal,
  onProgress: (progress: WorkerProgress) => void,
): Promise<ImageData> {
  const jobId = `job-${++generation}`
  const w = getWorker()
  const buffer = imageData.data.buffer.slice(0)

  return new Promise((resolve, reject) => {
    const onAbort = () => {
      w.postMessage({ type: 'cancel', jobId })
      cleanup()
      reject(Object.assign(new Error('cancelado'), { name: 'CancelledError' }))
    }

    const onMessage = (event: MessageEvent<DoneMessage | ErrorMessage | ProgressMessage>) => {
      const msg = event.data
      if (msg.jobId !== jobId) return
      if (msg.type === 'progress') {
        onProgress({ percent: msg.percent, status: msg.status })
        return
      }
      cleanup()
      if (msg.type === 'error') {
        reject(Object.assign(new Error(msg.message), { name: msg.message === 'cancelado' ? 'CancelledError' : 'MediaError' }))
        return
      }
      const image = new ImageData(msg.width, msg.height)
      image.data.set(new Uint8ClampedArray(msg.buffer))
      resolve(image)
    }

    const cleanup = () => {
      w.removeEventListener('message', onMessage)
      signal.removeEventListener('abort', onAbort)
    }

    if (signal.aborted) {
      onAbort()
      return
    }
    signal.addEventListener('abort', onAbort)
    w.addEventListener('message', onMessage)
    w.postMessage(
      {
        type: 'enhance',
        jobId,
        width: imageData.width,
        height: imageData.height,
        intensity,
        buffer,
      },
      [buffer],
    )
  })
}
