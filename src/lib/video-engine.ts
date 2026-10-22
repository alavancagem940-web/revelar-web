import { enhanceFrameRgba, channelMeans, MediaError } from './photo-engine.ts'
import {
  fitSize,
  maxVideoSide,
  probeVideo,
  seekVideo,
  waitForVideo,
} from './decode.ts'
import {
  describeExportMime,
  jpegSequenceHint,
  pickRecorderMime,
  zipJpegs,
} from './export.ts'
import { CancelledError, clamp, isIosDevice, sleep, throwIfAborted, yieldToUi } from './utils.ts'

export const MAX_VIDEO_SECONDS = isIosRuntime() ? 10 : 16

function isIosRuntime(): boolean {
  try {
    return isIosDevice()
  } catch {
    return false
  }
}

export type VideoExportResult = {
  blob: Blob
  filename: string
  mime: string
  note: string
  clipped: boolean
  usedStab: boolean
  frames: number
}

export type VideoProgress = (percent: number, status: string) => void

function downsampleGray(
  data: Uint8ClampedArray,
  width: number,
  height: number,
  tw: number,
  th: number,
): Float32Array {
  const out = new Float32Array(tw * th)
  const sx = width / tw
  const sy = height / th
  for (let y = 0; y < th; y++) {
    for (let x = 0; x < tw; x++) {
      const ix = Math.min(width - 1, Math.floor(x * sx))
      const iy = Math.min(height - 1, Math.floor(y * sy))
      const i = (iy * width + ix) * 4
      out[y * tw + x] = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2]
    }
  }
  return out
}

function estimateShift(
  prev: Float32Array,
  curr: Float32Array,
  tw: number,
  th: number,
  search: number,
): { dx: number; dy: number } {
  let best = Infinity
  let bx = 0
  let by = 0
  for (let dy = -search; dy <= search; dy++) {
    for (let dx = -search; dx <= search; dx++) {
      let sad = 0
      let n = 0
      for (let y = search; y < th - search; y += 2) {
        for (let x = search; x < tw - search; x += 2) {
          sad += Math.abs(curr[y * tw + x] - prev[(y + dy) * tw + (x + dx)])
          n++
        }
      }
      const mean = sad / n
      if (mean < best) {
        best = mean
        bx = dx
        by = dy
      }
    }
  }
  return { dx: bx, dy: by }
}

function readFrame(
  video: HTMLVideoElement,
  scratch: HTMLCanvasElement,
  width: number,
  height: number,
): ImageData {
  scratch.width = width
  scratch.height = height
  const ctx = scratch.getContext('2d', { willReadFrequently: true })
  if (!ctx) throw new MediaError('canvas 2D indisponível.')
  ctx.drawImage(video, 0, 0, width, height)
  return ctx.getImageData(0, 0, width, height)
}

function drawProcessed(
  dest: HTMLCanvasElement,
  imageData: ImageData,
  dx: number,
  dy: number,
  crop: number,
): void {
  const ctx = dest.getContext('2d')
  if (!ctx) throw new MediaError('canvas 2D indisponível.')
  const w = dest.width
  const h = dest.height
  const frame = document.createElement('canvas')
  frame.width = imageData.width
  frame.height = imageData.height
  const frameCtx = frame.getContext('2d')
  if (!frameCtx) throw new MediaError('canvas 2D indisponível.')
  frameCtx.putImageData(imageData, 0, 0)

  const composed = document.createElement('canvas')
  composed.width = w
  composed.height = h
  const composedCtx = composed.getContext('2d')
  if (!composedCtx) throw new MediaError('canvas 2D indisponível.')
  composedCtx.fillStyle = '#000'
  composedCtx.fillRect(0, 0, w, h)
  composedCtx.drawImage(frame, dx, dy, w, h)

  const c = clamp(crop, 0, 0.12)
  if (c > 0.001) {
    const sx = w * c
    const sy = h * c
    ctx.drawImage(composed, sx, sy, w - sx * 2, h - sy * 2, 0, 0, w, h)
  } else {
    ctx.drawImage(composed, 0, 0)
  }
}

async function sampleGains(
  video: HTMLVideoElement,
  scratch: HTMLCanvasElement,
  width: number,
  height: number,
  duration: number,
  signal: AbortSignal,
): Promise<{ r: number; g: number; b: number } | undefined> {
  const samples = 6
  const means = { r: 0, g: 0, b: 0 }
  let count = 0
  for (let i = 0; i < samples; i++) {
    throwIfAborted(signal)
    const t = (duration * i) / Math.max(1, samples - 1)
    await seekVideo(video, t)
    await yieldToUi()
    const frame = readFrame(video, scratch, width, height)
    const m = channelMeans(frame.data)
    means.r += m.r
    means.g += m.g
    means.b += m.b
    count++
  }
  if (!count) return undefined
  means.r /= count
  means.g /= count
  means.b /= count
  const gray = (means.r + means.g + means.b) / 3
  return {
    r: gray / Math.max(means.r, 1),
    g: gray / Math.max(means.g, 1),
    b: gray / Math.max(means.b, 1),
  }
}

function addSilentAudio(stream: MediaStream): { stop: () => void } {
  try {
    const ctx = new AudioContext()
    const osc = ctx.createOscillator()
    osc.frequency.value = 0
    const gain = ctx.createGain()
    gain.gain.value = 0
    const dest = ctx.createMediaStreamDestination()
    osc.connect(gain)
    gain.connect(dest)
    osc.start()
    const track = dest.stream.getAudioTracks()[0]
    if (track) stream.addTrack(track)
    return {
      stop: () => {
        try {
          osc.stop()
          void ctx.close()
        } catch {
          /* ignore */
        }
      },
    }
  } catch {
    return { stop: () => undefined }
  }
}

async function canvasFrameJpeg(canvas: HTMLCanvasElement, quality = 0.92): Promise<Uint8Array> {
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('falha ao gerar JPEG.'))),
      'image/jpeg',
      quality,
    )
  })
  return new Uint8Array(await blob.arrayBuffer())
}

function requestFrame(track: MediaStreamTrack): void {
  const extended = track as MediaStreamTrack & { requestFrame?: () => void }
  extended.requestFrame?.()
}

export async function enhanceAndExportVideo(options: {
  file: File
  intensity: number
  canvas: HTMLCanvasElement
  signal: AbortSignal
  onProgress: VideoProgress
}): Promise<VideoExportResult> {
  const { file, canvas, signal, onProgress } = options
  const intensity = clamp(options.intensity, 0, 1)
  onProgress(2, 'lendo')
  const info = await probeVideo(file)
  throwIfAborted(signal)

  const clipped = info.duration > MAX_VIDEO_SECONDS + 0.05
  const duration = Math.min(info.duration, MAX_VIDEO_SECONDS)
  const fitted = fitSize(info.width, info.height, maxVideoSide())
  const width = fitted.width
  const height = fitted.height
  const fps = duration <= 6 ? 24 : 16
  const frameCount = Math.max(1, Math.round(duration * fps))

  canvas.width = width
  canvas.height = height

  const url = URL.createObjectURL(file)
  const video = document.createElement('video')
  video.muted = true
  video.playsInline = true
  video.preload = 'auto'
  video.src = url

  const scratch = document.createElement('canvas')

  try {
    await waitForVideo(video)
    throwIfAborted(signal)
    onProgress(6, 'equalização de cor')
    const gains =
      intensity > 0.02
        ? await sampleGains(video, scratch, width, height, duration, signal)
        : undefined

    const shifts: { dx: number; dy: number }[] = []
    let usedStab = false
    const tw = 80
    const th = Math.max(24, Math.round((80 * height) / width))
    if (intensity > 0.08 && frameCount <= 280) {
      onProgress(10, 'estabilização')
      usedStab = true
      let prev: Float32Array | null = null
      let accX = 0
      let accY = 0
      for (let i = 0; i < frameCount; i++) {
        throwIfAborted(signal)
        await seekVideo(video, (i / fps))
        const frame = readFrame(video, scratch, width, height)
        const gray = downsampleGray(frame.data, width, height, tw, th)
        if (prev) {
          const delta = estimateShift(prev, gray, tw, th, 6)
          accX += delta.dx * (width / tw)
          accY += delta.dy * (height / th)
        }
        shifts.push({
          dx: clamp(-accX, -0.08 * width, 0.08 * width),
          dy: clamp(-accY, -0.08 * height, 0.08 * height),
        })
        prev = gray
        if (i % 3 === 0) {
          onProgress(10 + (20 * i) / frameCount, 'estabilização')
          await yieldToUi()
        }
      }
    }

    const mime = pickRecorderMime()
    onProgress(32, mime ? `exportando ${describeExportMime(mime)}` : 'exportando sequência JPEG')

    const jpegs: Uint8Array[] = []
    let recorder: MediaRecorder | null = null
    let recorded: Blob[] = []
    let audioStop: () => void = () => undefined
    let recTrack: MediaStreamTrack | undefined

    if (mime && typeof canvas.captureStream === 'function') {
      const stream = canvas.captureStream(fps)
      recTrack = stream.getVideoTracks()[0]
      audioStop = addSilentAudio(stream).stop
      try {
        recorder = new MediaRecorder(stream, {
          mimeType: mime,
          videoBitsPerSecond: Math.round(width * height * fps * 0.07),
        })
      } catch {
        recorder = new MediaRecorder(stream)
      }
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) recorded.push(event.data)
      }
      recorder.start(200)
      await sleep(40)
    }

    const crop = usedStab ? 0.012 + 0.028 * intensity : 0

    for (let i = 0; i < frameCount; i++) {
      throwIfAborted(signal)
      await seekVideo(video, i / fps)
      const raw = readFrame(video, scratch, width, height)
      const enhanced = enhanceFrameRgba(raw.data, width, height, intensity, gains)
      const processed = new ImageData(width, height)
      processed.data.set(enhanced)
      const shift = shifts[i] ?? { dx: 0, dy: 0 }
      drawProcessed(canvas, processed, shift.dx, shift.dy, crop)
      if (recTrack) requestFrame(recTrack)
      if (!recorder) {
        if (i % Math.max(1, Math.round(fps / 8)) === 0) {
          jpegs.push(await canvasFrameJpeg(canvas))
        }
      }
      const frac = (i + 1) / frameCount
      onProgress(32 + 58 * frac, recorder ? 'exportando H.264' : 'exportando JPEG')
      await yieldToUi()
      if (recorder) await sleep(Math.max(12, Math.round(1000 / fps) - 8))
    }

    if (recorder && recorder.state !== 'inactive') {
      const stopped = new Promise<void>((resolve) => {
        recorder.onstop = () => resolve()
      })
      recorder.stop()
      await stopped
    }
    audioStop()

    if (recorder && recorded.length > 0) {
      const type = recorder.mimeType || mime || 'video/mp4'
      const blob = new Blob(recorded, { type })
      const ext = type.includes('mp4') ? 'mp4' : 'mp4'
      const note = clipped
        ? `Clipe limitado a ${MAX_VIDEO_SECONDS} s neste aparelho. ${describeExportMime(type)}.`
        : `Exportado ${describeExportMime(type)}.`
      return {
        blob,
        filename: `revelar-video-001.${ext}`,
        mime: type,
        note,
        clipped,
        usedStab,
        frames: frameCount,
      }
    }

    if (jpegs.length === 0) {
      jpegs.push(await canvasFrameJpeg(canvas))
    }
    const zip = zipJpegs(jpegs)
    const note = [
      jpegSequenceHint(),
      clipped ? `Clipe limitado a ${MAX_VIDEO_SECONDS} s.` : '',
    ]
      .filter(Boolean)
      .join(' ')
    return {
      blob: zip,
      filename: 'revelar-video-001-quadros.zip',
      mime: zip.type,
      note,
      clipped,
      usedStab,
      frames: jpegs.length,
    }
  } catch (err) {
    if ((err as Error).name === 'CancelledError') throw err
    if (err instanceof CancelledError) throw err
    throw err instanceof MediaError
      ? err
      : new MediaError(
          err instanceof Error ? err.message : `falha ao processar ${file.name}`,
        )
  } finally {
    video.src = ''
    URL.revokeObjectURL(url)
  }
}
