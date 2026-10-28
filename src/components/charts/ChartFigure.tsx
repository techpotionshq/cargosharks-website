import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * The one frame every chart and drawn figure on the site sits in.
 *
 * Title on top, the chart, then a short caption centred under it, all inside
 * the same white card. The figures used to end with a long left-aligned
 * paragraph set outside the card at a narrow measure, which read as a stray
 * note under a wide panel; the caption now belongs to the figure, says one
 * thing in one or two sentences, and lines up with the chart above it.
 *
 * `meta` sits at the end of the title row for the unit or the source date
 * ("KWD", "Seed data, Oct 2026"). Keep `caption` under about 160 characters;
 * anything longer belongs in the section's own copy, not under the chart.
 */
export function ChartFigure({
  title,
  meta,
  caption,
  children,
  className,
}: {
  title: ReactNode
  meta?: ReactNode
  caption?: ReactNode
  children: ReactNode
  className?: string
}) {
  return (
    <figure
      className={cn(
        'my-0 flex min-w-0 flex-col gap-6 rounded-xl border border-line bg-paper-lift p-5 shadow-sm sm:p-7',
        className,
      )}
    >
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h3 className="text-balance font-display text-h3 font-bold text-heading">{title}</h3>
        {meta ? <p className="text-label text-ink-faint">{meta}</p> : null}
      </div>
      <div className="min-w-0">{children}</div>
      {caption ? (
        <figcaption className="mx-auto max-w-[60ch] border-t border-line pt-4 text-center text-small text-ink-dim">
          {caption}
        </figcaption>
      ) : null}
    </figure>
  )
}
