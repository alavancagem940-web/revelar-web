import { useMemo, useRef, useState } from 'react'
import { Aperture, Camera, FolderOpen, Share, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button.tsx'
import { Preview } from '@/components/Preview.tsx'
import { QueueList } from '@/components/QueueList.tsx'
import { StatusBar } from '@/components/StatusBar.tsx'
import { AUTO_INTENSITY } from '@/lib/auto.ts'
import { bitmapToImageData, decodeImageFile, videoFirstFrame } from '@/lib/decode.ts'
import { ALL_ACCEPT, classifyFile, nextExportName, PHOTO_ACCEPT } from '@/lib/files.ts'
import {
  describeExportMime,
  imageDataToBlob,
  photoExportSpec,
  pickRecorderMime,
  saveOrShare,
} from '@/lib/export.ts'
import { enhancePhotoInWorker } from '@/lib/jobs.ts'
import { makeSamplePhoto } from '@/lib/sample.ts'
import type { QueueItem } from '@/lib/types.ts'
import { enhanceAndExportVideo } from '@/lib/video-engine.ts'
import { isStandalone } from '@/lib/utils.ts'

function idleMessage(): string {
  const mime = pickRecorderMime()
  if (mime) {
    return `Pronto. Escolha um arquivo — o tratamento começa sozinho. Vídeo: ${describeExportMime(mime)}.`
  }
  return 'Pronto. Escolha um arquivo — o tratamento começa sozinho. Vídeo: se o Safari não encodar H.264, exporto JPEG em ZIP.'
}

function installHref(): string {
  return `${import.meta.env.BASE_URL}instalar.html`
}

export default function App() {
  const [items, setItems] = useState<QueueItem[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [status, setStatus] = useState(idleMessage)
  const [percent, setPercent] = useState(0)
  const [error, setError] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const galleryRef = useRef<HTMLInputElement>(null)
  const cameraRef = useRef<HTMLInputElement>(null)
  const photoSerial = useRef(0)
  const videoSerial = useRef(0)
  const chain = useRef(Promise.resolve())
  const standalone = useMemo(() => isStandalone(), [])

  const selected = items.find((item) => item.id === selectedId) ?? null
  const busy = Boolean(busyId)

  function patch(id: string, partial: Partial<QueueItem>) {
    setItems((current) =>
      current.map((item) => (item.id === id ? { ...item, ...partial } : item)),
    )
  }

  function enqueueEnhance(item: QueueItem) {
    chain.current = chain.current
      .then(() => enhanceItem(item))
      .catch(() => undefined)
  }

  async function enhanceItem(item: QueueItem) {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller
    setBusyId(item.id)
    setError(false)
    setPercent(4)
    setStatus(`${item.name} · lendo`)
    patch(item.id, { status: 'lendo', error: undefined })

    try {
      if (item.kind === 'foto') {
        const bitmap = await decodeImageFile(item.file)
        const { imageData, scaled } = bitmapToImageData(bitmap)
        bitmap.close()
        if (scaled) setStatus(`${item.name} · redimensionado para caber na memória`)
        patch(item.id, { status: 'processando' })
        const enhanced = await enhancePhotoInWorker(
          imageData,
          AUTO_INTENSITY,
          controller.signal,
          ({ percent: p, status: s }) => {
            setPercent(p)
            setStatus(`${item.name} · ${s}`)
          },
        )
        const spec = photoExportSpec(item.file)
        const blob = await imageDataToBlob(enhanced, spec.mime, spec.quality)
        if (item.previousUrl) URL.revokeObjectURL(item.previousUrl)
        const resultUrl = URL.createObjectURL(blob)
        patch(item.id, {
          status: 'pronto',
          resultBlob: blob,
          resultUrl,
          detail: scaled ? 'redimensionado' : `${enhanced.width}×${enhanced.height}`,
        })
        setPercent(100)
        setStatus(`${item.name} · concluído`)
      } else {
        const canvas = canvasRef.current
        if (!canvas) throw new Error('pré-visualização de vídeo indisponível.')
        patch(item.id, { status: 'processando' })
        const result = await enhanceAndExportVideo({
          file: item.file,
          intensity: AUTO_INTENSITY,
          canvas,
          signal: controller.signal,
          onProgress: (p, s) => {
            setPercent(p)
            setStatus(`${item.name} · ${s}`)
          },
        })
        const serial = ++videoSerial.current
        const filename = result.filename.includes('quadros')
          ? `revelar-video-${String(serial).padStart(3, '0')}-quadros.zip`
          : nextExportName('video', serial, 'mp4')
        const named = new File([result.blob], filename, { type: result.blob.type })
        if (item.previousUrl) URL.revokeObjectURL(item.previousUrl)
        const resultUrl = URL.createObjectURL(named)
        patch(item.id, {
          status: 'pronto',
          resultBlob: named,
          resultUrl,
          exportNote: result.note,
        })
        setPercent(100)
        setStatus(result.note)
      }
    } catch (err) {
      const cancelled =
        (err as Error).name === 'CancelledError' || (err as Error).message === 'cancelado'
      if (cancelled) {
        patch(item.id, { status: 'erro', error: 'cancelado' })
        setStatus(`${item.name} · cancelado`)
        setPercent(0)
      } else {
        const message = err instanceof Error ? err.message : 'falha no processamento'
        patch(item.id, { status: 'erro', error: message })
        setError(true)
        setStatus(`${item.name} · ${message}`)
      }
    } finally {
      setBusyId(null)
    }
  }

  async function addSampleVideo() {
    try {
      const url = `${import.meta.env.BASE_URL}amostras/video-teste.mp4`
      const response = await fetch(url)
      if (!response.ok) throw new Error('não achei o vídeo de exemplo.')
      const blob = await response.blob()
      const file = new File([blob], 'video-teste.mp4', { type: 'video/mp4' })
      await addFiles([file])
    } catch (err) {
      setError(true)
      setStatus(err instanceof Error ? err.message : 'falha ao carregar o exemplo')
    }
  }

  async function addFiles(list: FileList | File[]) {
    const next: QueueItem[] = []
    for (const file of Array.from(list)) {
      const kind = classifyFile(file)
      if (kind === 'unknown') {
        setError(true)
        setStatus(`Ignorado: ${file.name} não é JPG, PNG, HEIC, MP4 ou MOV.`)
        continue
      }
      const originalUrl = URL.createObjectURL(file)
      let thumbUrl = originalUrl
      if (kind === 'video') {
        try {
          thumbUrl = await videoFirstFrame(file)
        } catch {
          thumbUrl = originalUrl
        }
      }
      next.push({
        id: crypto.randomUUID(),
        file,
        kind,
        name: file.name,
        status: 'na fila',
        detail: '',
        originalUrl,
        thumbUrl,
      })
    }
    if (next.length === 0) return
    setItems((current) => [...current, ...next])
    setSelectedId((current) => current ?? next[0].id)
    setError(false)
    setStatus(
      next.length === 1
        ? `${next[0].name} · revelando automaticamente…`
        : `${next.length} arquivos · revelando automaticamente…`,
    )
    for (const item of next) enqueueEnhance(item)
  }

  async function exportSelected() {
    if (!selected?.resultBlob) return
    try {
      let blob = selected.resultBlob
      let filename = blob instanceof File ? blob.name : selected.name
      if (selected.kind === 'foto') {
        const serial = ++photoSerial.current
        const spec = photoExportSpec(selected.file)
        filename = nextExportName('foto', serial, spec.ext)
        blob = new File([blob], filename, { type: spec.mime })
      }
      const mode = await saveOrShare(blob, filename)
      patch(selected.id, {
        status: 'exportado',
        exportNote: mode === 'share' ? 'enviado pela folha de compartilhar' : `salvo: ${filename}`,
      })
      setStatus(
        mode === 'share'
          ? `Compartilhado: ${filename}. No iPhone, escolha Salvar em Arquivos ou Fotos.`
          : `Baixado: ${filename}. Abra no app Arquivos.`,
      )
      setPercent(100)
    } catch (err) {
      setError(true)
      setStatus(err instanceof Error ? err.message : 'falha ao exportar')
    }
  }

  function cancel() {
    abortRef.current?.abort()
  }

  return (
    <div className="mx-auto flex min-h-svh max-w-5xl flex-col bg-bg text-ink">
      <header className="flex items-start justify-between gap-3 px-4 pb-3 pt-[max(1rem,env(safe-area-inset-top))]">
        <div>
          <p className="flex items-center gap-2 text-lg font-semibold">
            <Aperture className="h-5 w-5 text-gold" />
            Revelar
          </p>
          <p className="max-w-md text-sm text-muted">
            Escolha a foto ou o vídeo. O tratamento profissional roda sozinho, no
            aparelho.
          </p>
        </div>
        {!standalone ? (
          <a
            href={installHref()}
            className="shrink-0 rounded-full bg-gold px-3 py-2 text-xs font-bold text-gold-ink"
          >
            Instalar
          </a>
        ) : null}
      </header>

      <main className="flex flex-1 flex-col gap-4 px-4 pb-4">
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => galleryRef.current?.click()}>
            <FolderOpen className="h-4 w-4" />
            Galeria
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => cameraRef.current?.click()}
          >
            <Camera className="h-4 w-4" />
            Câmera
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void addFiles([makeSamplePhoto()])}
          >
            <Sparkles className="h-4 w-4" />
            Foto de exemplo
          </Button>
          <Button
            type="button"
            variant="secondary"
            onClick={() => void addSampleVideo()}
          >
            Vídeo de exemplo
          </Button>
          <input
            ref={galleryRef}
            type="file"
            accept={ALL_ACCEPT}
            multiple
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files)
              event.target.value = ''
            }}
          />
          <input
            ref={cameraRef}
            type="file"
            accept={PHOTO_ACCEPT}
            capture="environment"
            className="hidden"
            onChange={(event) => {
              if (event.target.files) void addFiles(event.target.files)
              event.target.value = ''
            }}
          />
        </div>

        <section className="space-y-2">
          <h2 className="text-xs font-medium uppercase tracking-wide text-muted">Fila</h2>
          <QueueList items={items} selectedId={selectedId} onSelect={setSelectedId} />
        </section>

        <Preview
          item={selected}
          resultCanvasRef={canvasRef}
          liveVideo={busyId === selected?.id && selected?.kind === 'video'}
        />

        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void exportSelected()}
            disabled={!selected?.resultBlob || busy}
          >
            <Share className="h-4 w-4" />
            Exportar
          </Button>
          {busy ? (
            <Button type="button" variant="destructive" onClick={cancel}>
              Cancelar
            </Button>
          ) : null}
        </div>
      </main>

      <StatusBar text={status} percent={percent} error={error} />
    </div>
  )
}
