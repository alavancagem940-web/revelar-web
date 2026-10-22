import { ImageIcon, Trash2, Video } from 'lucide-react'
import type { QueueItem } from '@/lib/types.ts'
import { formatBytes } from '@/lib/files.ts'
import { cn } from '@/lib/utils.ts'

export function QueueList({
  items,
  selectedId,
  onSelect,
  onRemove,
}: {
  items: QueueItem[]
  selectedId: string | null
  onSelect: (id: string) => void
  onRemove: (id: string) => void
}) {
  if (items.length === 0) {
    return (
      <p className="px-1 text-sm leading-relaxed text-muted">
        Escolha fotos (JPG, PNG, HEIC) ou vídeos (MP4, MOV). O tratamento começa
        sozinho. Remova um item da fila se entrou por engano.
      </p>
    )
  }

  return (
    <ul className="flex gap-2 overflow-x-auto pb-1 [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
      {items.map((item) => {
        const active = item.id === selectedId
        return (
          <li key={item.id} className="shrink-0">
            <div
              className={cn(
                'relative flex w-44 items-stretch rounded-2xl border',
                active ? 'border-gold bg-panel-2' : 'border-white/10 bg-panel',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(item.id)}
                className="flex min-w-0 flex-1 items-center gap-2 p-2 pr-8 text-left"
              >
                <span className="relative h-12 w-12 overflow-hidden rounded-xl bg-black/40">
                  {item.thumbUrl ? (
                    <img
                      src={item.thumbUrl}
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : item.kind === 'video' ? (
                    <Video className="m-3 h-6 w-6 text-muted" />
                  ) : (
                    <ImageIcon className="m-3 h-6 w-6 text-muted" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-semibold text-ink">
                    {item.name}
                  </span>
                  <span className="block truncate text-[11px] text-muted">
                    {item.kind} · {item.status}
                  </span>
                  <span className="block text-[11px] text-muted">
                    {formatBytes(item.file.size)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                className="absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-full text-muted hover:bg-err/20 hover:text-err"
                aria-label="Remover imagem"
                title="Remover imagem"
                onClick={() => onRemove(item.id)}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        )
      })}
    </ul>
  )
}
