/**
 * Panels.
 *
 * One card treatment, used everywhere, because a dashboard whose panels differ
 * slightly from each other reads as an assembly of screens rather than one
 * product. The elevation is deliberately shallow — the ops board carries a
 * dozen panels at once, and heavy shadows at that density turn into noise.
 */

import type { ReactNode } from 'react'
import { Icon, type IconName } from './icon'

export interface CardProps {
  readonly children: ReactNode
  readonly className?: string
  /** `flush` removes padding, for a card whose body is a full-bleed table. */
  readonly padding?: 'none' | 'sm' | 'md'
  /** Draws attention without colour — used for the exception panel. */
  readonly tone?: 'default' | 'critical' | 'brand'
}

/*
  `brand` is a highlight, and it is drawn in the accent.

  It was a wash of the brand colour, which for a red brand is pink — and a
  pink card at the top of the rate comparison, directly above a table of
  margins, read as "something is wrong with this enquiry". The highlight says
  "this is the headline", which is the accent's job; red stays for the mark,
  the primary action and `critical`, where it means what it says.
*/
const TONE_CLASS = {
  default: 'border-line bg-surface',
  critical: 'border-critical/35 bg-surface',
  // Eyebrows a step darker on the tint: the default subtle ink read 4.0:1 on
  // the dark theme's accent wash, under AA at the eyebrow's 11px.
  brand: 'border-accent/20 bg-accent-soft [&_.eyebrow]:text-ink-muted',
} as const

const PADDING_CLASS = { none: '', sm: 'p-4', md: 'p-5' } as const

export function Card({ children, className, padding = 'md', tone = 'default' }: CardProps) {
  return (
    <section
      className={[
        'rounded-card border shadow-card',
        TONE_CLASS[tone],
        PADDING_CLASS[padding],
        className,
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {children}
    </section>
  )
}

export interface CardHeaderProps {
  readonly title: ReactNode
  readonly eyebrow?: ReactNode
  readonly description?: ReactNode
  readonly icon?: IconName
  /** Filters, a link to the full list, a period switch. */
  readonly actions?: ReactNode
  readonly className?: string
}

export function CardHeader({
  title,
  eyebrow,
  description,
  icon,
  actions,
  className,
}: CardHeaderProps) {
  /*
    An eyebrow that only repeats the title is dropped.

    Several cards take both from the same catalogue word — the job file's
    containers card read "CONTAINERS / Containers" — and the eyebrow's job is
    to place a card in a section, which an echo of its own title cannot do.
    Only plain strings are compared; a node is assumed to mean something.
  */
  const echoesTitle =
    typeof eyebrow === 'string' &&
    typeof title === 'string' &&
    eyebrow.trim().toLocaleLowerCase() === title.trim().toLocaleLowerCase()

  return (
    /*
      Wraps, and the title claims its width first.

      On a phone a header with two actions used to squeeze the title column to
      whatever the buttons left — 90px — and the heading truncated to "Rates
      fr…" beside a row of perfectly legible buttons. The title block now asks
      for at least 14rem (or the whole row, if that is less), and the actions
      drop beneath it when both cannot fit.
    */
    <header
      className={['flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="flex min-w-[min(100%,14rem)] flex-1 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-accent-soft text-accent">
            <Icon name={icon} size={17} />
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow && !echoesTitle ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
          <h2 className="text-title font-semibold text-balance text-ink">{title}</h2>
          {description ? (
            // `break-words`: a description naming a template key or an address
            // with no spaces in it pushed the notifications screen 37px past
            // a phone's edge.
            <p className="mt-0.5 text-body-sm break-words text-ink-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex max-w-full flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}
