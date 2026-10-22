export type MediaKind = 'foto' | 'video'

const PHOTO_EXT = /\.(jpe?g|png|heic|heif|webp)$/i
const VIDEO_EXT = /\.(mp4|mov|m4v|qt)$/i

export function classifyFile(file: File): MediaKind | 'unknown' {
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  if (type.startsWith('image/') || PHOTO_EXT.test(name)) return 'foto'
  if (type.startsWith('video/') || VIDEO_EXT.test(name)) return 'video'
  return 'unknown'
}

export function isHeic(file: File): boolean {
  const name = file.name.toLowerCase()
  const type = (file.type || '').toLowerCase()
  return type.includes('heic') || type.includes('heif') || /\.(heic|heif)$/.test(name)
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function nextExportName(
  kind: MediaKind,
  index: number,
  ext: string,
): string {
  const prefix = kind === 'foto' ? 'revelar-foto' : 'revelar-video'
  return `${prefix}-${String(index).padStart(3, '0')}.${ext}`
}

export const PHOTO_ACCEPT =
  'image/jpeg,image/png,image/heic,image/heif,.jpg,.jpeg,.png,.heic,.heif'
export const VIDEO_ACCEPT = 'video/mp4,video/quicktime,.mp4,.mov,.m4v'
export const ALL_ACCEPT = `${PHOTO_ACCEPT},${VIDEO_ACCEPT}`
