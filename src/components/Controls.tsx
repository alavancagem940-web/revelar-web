import { Button } from '@/components/ui/button.tsx'
import type { PhotoFormat, QueueItem } from '@/lib/types.ts'

export function Controls({
  item,
  intensity,
  compare,
  format,
  busy,
  onIntensity,
  onCompare,
  onFormat,
  onApply,
  onUndo,
  onExport,
  onCancel,
}: {
  item: QueueItem | null
  intensity: number
  compare: boolean
  format: PhotoFormat
  busy: boolean
  onIntensity: (value: number) => void
  onCompare: (value: boolean) => void
  onFormat: (value: PhotoFormat) => void
  onApply: () => void
  onUndo: () => void
  onExport: () => void
  onCancel: () => void
}) {
  const canApply = Boolean(item) && !busy
  const canUndo = Boolean(item?.resultUrl || item?.previousUrl) && !busy
  const canExport = Boolean(item?.resultBlob) && !busy

  return (
    <section className="space-y-4 rounded-2xl bg-panel p-4">
      <header>
        <h2 className="text-sm font-semibold">Revelação</h2>
        <p className="text-xs text-muted">
          Exposição, contraste adaptativo, branco, nitidez e ruído — no aparelho.
        </p>
      </header>

      <label className="block space-y-2">
        <span className="flex justify-between text-sm">
          Intensidade
          <span className="text-gold">{intensity}%</span>
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={intensity}
          onChange={(event) => onIntensity(Number(event.target.value))}
          className="w-full"
          disabled={busy}
        />
      </label>

      <div className="flex flex-wrap gap-2">
        <Button type="button" onClick={onApply} disabled={!canApply}>
          Aplicar automático
        </Button>
        <Button
          type="button"
          variant={compare ? 'default' : 'secondary'}
          onClick={() => onCompare(!compare)}
          disabled={!item}
        >
          Comparar
        </Button>
        <Button type="button" variant="secondary" onClick={onUndo} disabled={!canUndo}>
          Desfazer
        </Button>
        <Button type="button" variant="outline" onClick={onExport} disabled={!canExport}>
          Exportar
        </Button>
        {busy ? (
          <Button type="button" variant="destructive" onClick={onCancel}>
            Cancelar
          </Button>
        ) : null}
      </div>

      {item?.kind === 'foto' ? (
        <fieldset className="flex gap-3 text-sm text-muted">
          <legend className="sr-only">Formato da foto</legend>
          {(['JPEG', 'PNG'] as const).map((value) => (
            <label key={value} className="flex items-center gap-2">
              <input
                type="radio"
                name="photo-format"
                checked={format === value}
                onChange={() => onFormat(value)}
                disabled={busy}
              />
              {value}
            </label>
          ))}
        </fieldset>
      ) : (
        <p className="text-xs leading-relaxed text-muted">
          Vídeo: equalização de cor e estabilização leve. No iPhone o Safari tenta
          MP4 H.264 + AAC; se não der, sai uma sequência JPEG para o app Arquivos.
        </p>
      )}
    </section>
  )
}
