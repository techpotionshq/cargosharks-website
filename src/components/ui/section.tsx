import type { ComponentProps, ReactNode } from 'react'
import { cva, type VariantProps } from 'class-variance-authority'
import { cn } from '@/lib/utils'

/**
 * The one section primitive.
 *
 * Every band on the old home page was `py-band` (112px top and bottom), so two
 * sections sat 224px apart whatever they held, and each opened with the same
 * centred eyebrow, headline and two-line lede. That repetition, more than any
 * colour or font, is what made the page read as generated.
 *
 * The rhythm now comes from the reference the rebuild was measured against
 * (supabase.com, `apps/www/components/Layouts/SectionContainerWithCn.tsx`):
 * 64 to 96px of padding, sections separated by a hairline rather than by air,
 * and a size chosen per section by how much it holds.
 */
const sectionVariants = cva('relative scroll-mt-24', {
  variants: {
    space: {
      default: 'py-16 md:py-20 lg:py-24',
      tight: 'py-12 md:py-14',
      none: '',
    },
    tone: {
      paper: 'bg-paper text-ink',
      lift: 'bg-paper-lift text-ink',
      sunk: 'bg-paper-sunk text-ink',
      void: 'bg-void text-on-void',
    },
    rule: { true: 'border-t border-line', false: '' },
  },
  defaultVariants: { space: 'default', tone: 'paper', rule: false },
})

export function Section({
  className,
  space,
  tone,
  rule,
  ...props
}: ComponentProps<'section'> & VariantProps<typeof sectionVariants>) {
  return <section className={cn(sectionVariants({ space, tone, rule }), className)} {...props} />
}

/**
 * Heading on the start side, lede on the end side, both from the top. The
 * reference bottom-aligns them, which works for a one-line lede and leaves the
 * heading sinking beside a five-line one; tops aligned hold for both.
 *
 * Left-aligned (start-aligned in Arabic) because a centred two-line lede under
 * a centred headline, repeated eight times, was the template. Split rather
 * than stacked so a section's opening costs one row of height, not three.
 * `stack` is for sections whose lede is long or whose content sits beside it.
 */
export function SectionHeader({
  title,
  lede,
  action,
  layout = 'split',
  dark = false,
  as: Heading = 'h2',
  className,
}: {
  title: ReactNode
  lede?: ReactNode
  action?: ReactNode
  layout?: 'split' | 'stack'
  dark?: boolean
  as?: 'h1' | 'h2'
  className?: string
}) {
  const split = layout === 'split' && lede
  return (
    <div
      className={cn(
        split ? 'grid gap-5 lg:grid-cols-12 lg:items-start lg:gap-12' : 'flex flex-col gap-5',
        className,
      )}
    >
      <Heading
        className={cn(
          'max-w-[22ch] text-balance font-display font-extrabold',
          Heading === 'h1' ? 'text-display' : 'text-h2',
          dark ? 'text-on-void' : 'text-heading',
          split && 'lg:col-span-7',
        )}
      >
        {title}
      </Heading>
      {lede || action ? (
        <div className={cn('flex flex-col gap-5', split && 'lg:col-span-5 lg:pt-1.5')}>
          {lede ? (
            <p
              className={cn(
                'max-w-[60ch] text-pretty text-lede',
                dark ? 'text-on-void-dim' : 'text-ink-dim',
              )}
            >
              {lede}
            </p>
          ) : null}
          {action}
        </div>
      ) : null}
    </div>
  )
}
