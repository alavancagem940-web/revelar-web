import { MediaError } from './photo-engine.ts'
import { isHeic } from './files.ts'
import { clamp, isIosDevice } from './utils.ts'

export function maxPhotoSide(): number {
  return isIosDevice() ? 1920 : 2560
}

export function maxVideoSide(): number {
  return isIosDevice() ? 720 : 960
}

function make2dCanvas(width: number, height: number): {
  canvas: HTMLCanvasElement | OffscreenCanvas
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D
} {
  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(width, height)
    const ctx = canvas.getContext('2d', { willReadFrequently: true })
    if (ctx) return { canvas, ctx }
  }
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new MediaError('canvas 2D indisponível neste navegador.')
  return { canvas, ctx }
}

async function loadHtmlImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () =>
      reject(new MediaError('não foi possível decodificar a imagem.'))
    img.src = url
  })
}

export async function decodeImageFile(file: File): Promise<ImageBitmap> {
  try {
    return await createImageBitmap(file)
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const img = await loadHtmlImage(url)
      return await createImageBitmap(img)
    } catch (err) {
      if (isHeic(file) && !isIosDevice()) {
        throw new MediaError(
          'HEIC não abre neste navegador. No iPhone, use o Safari; no computador, envie JPG ou PNG.',
        )
      }
      throw err instanceof MediaError
        ? err
        : new MediaError(`falha ao ler ${file.name}`)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export function bitmapToImageData(
  bitmap: ImageBitmap,
  maxSide = maxPhotoSide(),
): { imageData: ImageData; scaled: boolean } {
  const longest = Math.max(bitmap.width, bitmap.height)
  const scale = longest > maxSide ? maxSide / longest : 1
  const width = Math.max(2, Math.round(bitmap.width * scale))
  const height = Math.max(2, Math.round(bitmap.height * scale))
  const { ctx } = make2dCanvas(width, height)
  ctx.drawImage(bitmap, 0, 0, width, height)
  return {
    imageData: ctx.getImageData(0, 0, width, height),
    scaled: scale < 0.999,
  }
}

export function imageDataFromCanvas(
  source: CanvasImageSource,
  width: number,
  height: number,
): ImageData {
  const { ctx } = make2dCanvas(width, height)
  ctx.drawImage(source, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

export function putImageDataToCanvas(
  imageData: ImageData,
  canvas: HTMLCanvasElement,
): void {
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new MediaError('canvas 2D indisponível.')
  ctx.putImageData(imageData, 0, 0)
}

export async function videoFirstFrame(file: File): Promise<string> {
  const url = URL.createObjectURL(file)
  try {
    const video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.preload = 'auto'
    video.src = url
    await waitForVideo(video)
    const width = video.videoWidth || 16
    const height = video.videoHeight || 16
    const { canvas, ctx } = make2dCanvas(
      Math.max(2, width),
      Math.max(2, height),
    )
    ctx.drawImage(video, 0, 0, width, height)
    if (canvas instanceof OffscreenCanvas) {
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 })
      return URL.createObjectURL(blob)
    }
    return canvas.toDataURL('image/jpeg', 0.8)
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function waitForVideo(video: HTMLVideoElement): Promise<void> {
  return new Promise((resolve, reject) => {
    const onReady = () => {
      cleanup()
      resolve()
    }
    const onError = () => {
      cleanup()
      reject(new MediaError('vídeo corrompido ou codec ausente neste Safari.'))
    }
    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady)
      video.removeEventListener('error', onError)
    }
    video.addEventListener('loadeddata', onReady)
    video.addEventListener('error', onError)
    video.load()
  })
}

export async function probeVideo(file: File): Promise<{
  duration: number
  width: number
  height: number
  fpsHint: number
}> {
  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'metadata'
  video.src = url
  try {
    await waitForVideo(video)
    const duration = Number.isFinite(video.duration) ? video.duration : 0
    if (duration <= 0) {
      throw new MediaError(`duração inválida em ${file.name}`)
    }
    return {
      duration,
      width: video.videoWidth,
      height: video.videoHeight,
      fpsHint: 24,
    }
  } finally {
    video.src = ''
    URL.revokeObjectURL(url)
  }
}

export function fitSize(
  width: number,
  height: number,
  maxSide: number,
): { width: number; height: number } {
  const longest = Math.max(width, height)
  const scale = longest > maxSide ? maxSide / longest : 1
  let w = Math.max(2, Math.round(width * scale))
  let h = Math.max(2, Math.round(height * scale))
  if (w % 2) w -= 1
  if (h % 2) h -= 1
  return { width: Math.max(2, w), height: Math.max(2, h) }
}

export function seekVideo(video: HTMLVideoElement, time: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      resolve()
    }
    const onError = () => {
      video.removeEventListener('seeked', onSeeked)
      video.removeEventListener('error', onError)
      reject(new MediaError('falha ao ler o quadro do vídeo.'))
    }
    video.addEventListener('seeked', onSeeked)
    video.addEventListener('error', onError)
    const target = clamp(time, 0, Math.max(0, video.duration - 0.04))
    if (Math.abs(video.currentTime - target) < 0.01) {
      onSeeked()
      return
    }
    video.currentTime = target
  })
}
