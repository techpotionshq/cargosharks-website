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

const TONE_CLASS = {
  default: 'border-line bg-surface',
  critical: 'border-critical/35 bg-surface',
  brand: 'border-brand/25 bg-brand-soft',
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
  return (
    <header
      className={['flex items-start justify-between gap-4', className].filter(Boolean).join(' ')}
    >
      <div className="flex min-w-0 items-start gap-3">
        {icon ? (
          <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-sm bg-brand-soft text-brand-soft-ink">
            <Icon name={icon} size={17} />
          </span>
        ) : null}
        <div className="min-w-0">
          {eyebrow ? <p className="eyebrow mb-1">{eyebrow}</p> : null}
          <h2 className="truncate text-[0.9375rem] font-semibold text-ink">{title}</h2>
          {description ? (
            <p className="mt-0.5 text-[0.8125rem] text-ink-muted">{description}</p>
          ) : null}
        </div>
      </div>
      {actions ? (
        <div className="flex max-w-full shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </header>
  )
}
