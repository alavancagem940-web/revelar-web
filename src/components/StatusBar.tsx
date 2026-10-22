import { Progress } from '@/components/ui/progress.tsx'
import { cn } from '@/lib/utils.ts'

export function StatusBar({
  text,
  percent,
  error,
}: {
  text: string
  percent: number
  error: boolean
}) {
  return (
    <footer className="sticky bottom-0 space-y-2 border-t border-white/10 bg-bg/95 px-4 py-3 backdrop-blur">
      <Progress value={percent} />
      <p className={cn('text-sm', error ? 'text-err' : 'text-muted')}>{text}</p>
    </footer>
  )
}
