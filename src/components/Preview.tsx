import type { QueueItem } from '@/lib/types.ts'

export function Preview({
  item,
  resultCanvasRef,
  liveVideo,
}: {
  item: QueueItem | null
  resultCanvasRef: React.RefObject<HTMLCanvasElement | null>
  liveVideo: boolean
}) {
  const resultUrl = item?.resultUrl
  const originalLabel = item?.kind === 'video' ? 'Quadro original' : 'Original'
  const videoResult = Boolean(
    resultUrl && item?.kind === 'video' && item.resultBlob?.type.startsWith('video/'),
  )
  const working = Boolean(
    item && (item.status === 'na fila' || item.status === 'lendo' || item.status === 'processando'),
  )

  return (
    <div className="relative space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <figure className="space-y-2">
          <figcaption className="text-xs font-medium uppercase tracking-wide text-muted">
            {item ? originalLabel : 'Original'}
          </figcaption>
          <div className="overflow-hidden rounded-2xl bg-black aspect-[4/3]">
            {!item ? (
              <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted">
                Escolha uma foto ou um vídeo. O tratamento começa sozinho.
              </p>
            ) : item.kind === 'video' ? (
              <video
                src={item.originalUrl}
                className="h-full w-full object-contain"
                muted
                playsInline
                controls
                preload="metadata"
              />
            ) : (
              <img
                src={item.thumbUrl || item.originalUrl}
                alt={item.name}
                className="h-full w-full object-contain"
              />
            )}
          </div>
        </figure>
        <figure className="space-y-2">
          <figcaption className="text-xs font-medium uppercase tracking-wide text-muted">
            Resultado
          </figcaption>
          <div className="relative overflow-hidden rounded-2xl bg-black aspect-[4/3]">
            {videoResult ? (
              <video
                src={resultUrl}
                className="h-full w-full object-contain"
                controls
                playsInline
              />
            ) : resultUrl ? (
              <img src={resultUrl} alt="Resultado" className="h-full w-full object-contain" />
            ) : (
              <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted">
                {item?.status === 'erro'
                  ? item.error
                  : liveVideo || working
                    ? 'Revelando… a barra de status mostra o passo.'
                    : 'O resultado aparece aqui, sem nenhum ajuste.'}
              </p>
            )}
          </div>
        </figure>
      </div>
      <canvas
        ref={resultCanvasRef}
        className="pointer-events-none fixed left-0 top-0 h-px w-px opacity-0"
        aria-hidden
      />
    </div>
  )
}
