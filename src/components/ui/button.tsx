import type { ComponentProps } from 'react'
import { Slot } from 'radix-ui'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * shadcn/ui's Button, in this site's palette.
 *
 * The buttons this replaces were set in 10.5px uppercase mono with wide
 * tracking, which reads as a label rather than as something to press, and at
 * that size the Arabic had nowhere to go. A button is the sentence a visitor
 * acts on, so it is set in the reading face at a size they can read.
 * `onDark` is the outline button on a dark band, where `outline` would draw a
 * paper-coloured fill.
 */
const buttonVariants = cva(
  'inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-lg font-medium transition-[color,background-color,border-color,opacity] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:pointer-events-none disabled:opacity-60 [&_svg]:pointer-events-none [&_svg]:shrink-0',
  {
    variants: {
      variant: {
        default: 'bg-primary text-primary-foreground hover:bg-blue-ink',
        outline: 'border border-input bg-card text-foreground hover:bg-muted',
        onDark: 'border border-void-line text-on-void hover:bg-void-lift',
        ghost: 'text-foreground hover:bg-muted',
        link: 'text-blue-ink underline-offset-4 hover:underline',
      },
      size: {
        default: 'h-11 px-5 text-[0.9375rem]',
        sm: 'h-9 px-3.5 text-small',
        lg: 'h-12 px-6 text-body',
      },
    },
    defaultVariants: { variant: 'default', size: 'default' },
  },
)

export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<'button'> & VariantProps<typeof buttonVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot.Root : 'button'
  return (
    <Comp
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { buttonVariants }
