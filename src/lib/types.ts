import type { MediaKind } from './files.ts'

export type ItemStatus =
  | 'na fila'
  | 'lendo'
  | 'processando'
  | 'pronto'
  | 'exportado'
  | 'erro'

export type QueueItem = {
  id: string
  file: File
  kind: MediaKind
  name: string
  status: ItemStatus
  detail: string
  originalUrl: string
  thumbUrl: string
  resultUrl?: string
  resultBlob?: Blob
  previousUrl?: string
  previousBlob?: Blob
  error?: string
  exportNote?: string
}
