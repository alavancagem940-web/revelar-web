import { zipSync } from 'fflate'
import { nextExportName } from './files.ts'
import { isIosDevice } from './utils.ts'

const MP4_CANDIDATES = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/mp4;codecs=avc1.4D001E,mp4a.40.2',
  'video/mp4;codecs=avc1.42E01E',
  'video/mp4',
]

export function pickRecorderMime(
  isSupported: (type: string) => boolean = (type) =>
    typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(type),
): string {
  return MP4_CANDIDATES.find((type) => isSupported(type)) ?? ''
}

export function describeExportMime(mime: string): string {
  if (mime.includes('mp4') && (mime.includes('avc1') || mime.includes('mp4a'))) {
    return 'MP4 H.264 + AAC'
  }
  if (mime.includes('mp4')) return 'MP4 (Safari / Fotos)'
  if (!mime) return 'sequência JPEG'
  return mime
}

/** JPEG alta qualidade (q≈0.95). PNG ignora o fator. */
export const PHOTO_JPEG_QUALITY = 0.95

export async function blobFromCanvas(
  canvas: HTMLCanvasElement | OffscreenCanvas,
  type: 'image/jpeg' | 'image/png',
  quality = PHOTO_JPEG_QUALITY,
): Promise<Blob> {
  if (canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type, quality })
  }
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob)
        else reject(new Error('falha ao gerar o arquivo de imagem.'))
      },
      type,
      quality,
    )
  })
}

export async function imageDataToBlob(
  imageData: ImageData,
  type: 'image/jpeg' | 'image/png',
  quality = PHOTO_JPEG_QUALITY,
): Promise<Blob> {
  const canvas = document.createElement('canvas')
  canvas.width = imageData.width
  canvas.height = imageData.height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('canvas 2D indisponível.')
  ctx.putImageData(imageData, 0, 0)
  return blobFromCanvas(canvas, type, quality)
}

export async function saveOrShare(
  blob: Blob,
  filename: string,
): Promise<'share' | 'download'> {
  const file = new File([blob], filename, {
    type: blob.type || 'application/octet-stream',
  })
  const nav = navigator as Navigator & {
    canShare?: (data: ShareData) => boolean
  }
  if (nav.share && nav.canShare?.({ files: [file] })) {
    try {
      await nav.share({ files: [file], title: filename })
      return 'share'
    } catch (err) {
      if ((err as DOMException).name === 'AbortError') return 'share'
    }
  }
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.rel = 'noopener'
  document.body.appendChild(link)
  link.click()
  link.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
  return 'download'
}

export function zipJpegs(frames: Uint8Array[]): Blob {
  const files: Record<string, Uint8Array> = {}
  frames.forEach((bytes, index) => {
    files[nextExportName('foto', index + 1, 'jpg').replace('revelar-foto', 'revelar-quadro')] =
      bytes
  })
  const zipped = zipSync(files, { level: 0 })
  return new Blob([zipped], { type: 'application/zip' })
}

export function jpegSequenceHint(): string {
  if (isIosDevice()) {
    return 'O Safari deste iPhone não encodou H.264. Exportei uma sequência JPEG (ZIP) para o app Arquivos.'
  }
  return 'Este navegador não encodou MP4 H.264. Exportei uma sequência JPEG em ZIP.'
}

export function photoExt(format: 'JPEG' | 'PNG'): 'jpg' | 'png' {
  return format === 'PNG' ? 'png' : 'jpg'
}

export function photoMime(format: 'JPEG' | 'PNG'): 'image/jpeg' | 'image/png' {
  return format === 'PNG' ? 'image/png' : 'image/jpeg'
}

export function photoExportSpec(file: File): {
  format: 'JPEG' | 'PNG'
  mime: 'image/jpeg' | 'image/png'
  ext: 'jpg' | 'png'
  quality: number
} {
  const png = file.type === 'image/png' || /\.png$/i.test(file.name)
  if (png) {
    return { format: 'PNG', mime: 'image/png', ext: 'png', quality: 1 }
  }
  return {
    format: 'JPEG',
    mime: 'image/jpeg',
    ext: 'jpg',
    quality: PHOTO_JPEG_QUALITY,
  }
}
