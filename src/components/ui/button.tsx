import { cva, type VariantProps } from 'class-variance-authority'
import type { ButtonHTMLAttributes } from 'react'
import { cn } from '@/lib/utils.ts'

const buttonVariants = cva(
  'inline-flex items-center justify-center gap-2 rounded-full text-sm font-semibold transition-opacity disabled:pointer-events-none disabled:opacity-40 active:opacity-80',
  {
    variants: {
      variant: {
        default: 'bg-gold text-gold-ink',
        secondary: 'bg-panel-2 text-ink border border-white/10',
        outline: 'border border-gold/70 text-gold bg-transparent',
        ghost: 'text-muted hover:text-ink',
        destructive: 'bg-err/20 text-err border border-err/40',
      },
      size: {
        default: 'h-11 px-4',
        sm: 'h-9 px-3 text-xs',
        lg: 'h-12 px-5',
        icon: 'h-11 w-11',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
)

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants>

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return (
    <button className={cn(buttonVariants({ variant, size }), className)} {...props} />
  )
}
