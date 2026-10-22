import { useState } from 'react'
import type { QueueItem } from '@/lib/types.ts'
import { cn } from '@/lib/utils.ts'

export function Preview({
  item,
  compare,
  resultCanvasRef,
  liveVideo,
}: {
  item: QueueItem | null
  compare: boolean
  resultCanvasRef: React.RefObject<HTMLCanvasElement | null>
  liveVideo: boolean
}) {
  const [split, setSplit] = useState(50)
  const resultUrl = item?.resultUrl
  const showCompare = Boolean(compare && resultUrl)
  const originalLabel = item?.kind === 'video' ? 'Quadro original' : 'Original'
  const videoResult = Boolean(
    resultUrl && item?.kind === 'video' && item.resultBlob?.type.startsWith('video/'),
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
                Nenhum arquivo selecionado.
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
            ) : liveVideo ? null : (
              <p className="flex h-full items-center justify-center px-4 text-center text-sm text-muted">
                {item?.status === 'erro'
                  ? item.error
                  : item
                    ? 'Toque em Aplicar automático para revelar.'
                    : 'Aplique o automático para ver o antes e o depois.'}
              </p>
            )}
            <canvas
              ref={resultCanvasRef}
              className={cn(
                liveVideo && !resultUrl
                  ? 'absolute inset-0 h-full w-full object-contain'
                  : 'pointer-events-none absolute left-0 top-0 h-px w-px opacity-0',
              )}
            />
          </div>
        </figure>
      </div>

      {showCompare && item && resultUrl ? (
        <div className="space-y-2">
          <p className="text-xs font-medium uppercase tracking-wide text-muted">
            Comparar antes / depois
          </p>
          <div className="relative overflow-hidden rounded-2xl bg-black aspect-[4/3]">
            <img
              src={item.thumbUrl || item.originalUrl}
              alt="Original"
              className="absolute inset-0 h-full w-full object-contain"
            />
            <img
              src={resultUrl}
              alt="Resultado"
              className="absolute inset-0 h-full w-full object-contain"
              style={{ clipPath: `inset(0 ${100 - split}% 0 0)` }}
            />
            <div
              className="absolute inset-y-0 w-px bg-gold"
              style={{ left: `${split}%` }}
            />
          </div>
          <label className="flex items-center gap-3 text-xs text-muted">
            Original
            <input
              type="range"
              min={4}
              max={96}
              value={split}
              onChange={(event) => setSplit(Number(event.target.value))}
              className="flex-1"
            />
            Resultado
          </label>
        </div>
      ) : null}
    </div>
  )
}
