import type { ComponentProps } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * shadcn/ui's Badge. Used for status, never as decoration: "Live", "In build".
 * A badge that says nothing a reader acts on is the pill this site removed
 * from its hero, so every variant here names a state.
 */
const badgeVariants = cva(
  'inline-flex w-fit shrink-0 items-center gap-1.5 whitespace-nowrap rounded-md border px-2 py-0.5 text-label font-medium',
  {
    variants: {
      variant: {
        live: 'border-positive/30 bg-positive/10 text-positive',
        build: 'border-blue/25 bg-blue/8 text-blue-ink',
        outline: 'border-border text-muted-foreground',
        onDark: 'border-void-line text-on-void-dim',
      },
    },
    defaultVariants: { variant: 'outline' },
  },
)

export function Badge({
  className,
  variant,
  ...props
}: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}
