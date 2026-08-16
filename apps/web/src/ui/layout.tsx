/**
 * Page furniture — headers, empty states, buttons, grids.
 *
 * Small pieces, but they are what make eight screens look like one product.
 * Every one of them is a server component and none carries a colour literal.
 */

import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon, type IconName } from './icon'

export function PageHeader({
  title,
  eyebrow,
  description,
  actions,
  className,
}: {
  readonly title: ReactNode
  readonly eyebrow?: ReactNode
  readonly description?: ReactNode
  readonly actions?: ReactNode
  readonly className?: string
}) {
  return (
    <header
      className={['mb-6 flex flex-wrap items-end justify-between gap-4', className]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-1.5">{eyebrow}</p> : null}
        <h1 className="font-display text-2xl leading-tight font-semibold tracking-tight text-ink">
          {title}
        </h1>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[0.875rem] text-ink-muted">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
    </header>
  )
}

const BUTTON_VARIANT = {
  primary: 'bg-brand text-on-brand hover:bg-brand-hover shadow-card',
  secondary: 'border border-line bg-surface text-ink hover:bg-surface-sunken',
  ghost: 'text-ink-muted hover:bg-surface-sunken hover:text-ink',
  danger: 'bg-critical text-on-brand hover:opacity-90',
} as const

const BUTTON_SIZE = {
  sm: 'h-8 px-2.5 text-[0.8125rem] gap-1.5',
  md: 'h-9 px-3.5 text-[0.875rem] gap-2',
  lg: 'h-11 px-5 text-[0.9375rem] gap-2',
} as const

export interface ButtonProps {
  readonly children?: ReactNode
  readonly variant?: keyof typeof BUTTON_VARIANT
  readonly size?: keyof typeof BUTTON_SIZE
  readonly icon?: IconName
  /** Places the glyph after the label — for "next", "open". */
  readonly iconEnd?: IconName
  readonly href?: string
  readonly type?: 'button' | 'submit'
  readonly className?: string
  readonly title?: string
  readonly 'aria-label'?: string
}

/**
 * Renders a `<Link>` when given an `href` and a `<button>` otherwise.
 *
 * One component rather than two because the *only* difference that should
 * survive to the reader is whether it navigates — a link styled as a button
 * and a button styled as a link is how keyboard users end up unable to
 * activate half an interface.
 */
export function Button({
  children,
  variant = 'secondary',
  size = 'md',
  icon,
  iconEnd,
  href,
  type = 'button',
  className,
  ...rest
}: ButtonProps) {
  const classes = [
    'inline-flex items-center justify-center rounded-sm font-medium whitespace-nowrap transition-colors',
    BUTTON_VARIANT[variant],
    BUTTON_SIZE[size],
    className,
  ]
    .filter(Boolean)
    .join(' ')

  const inner = (
    <>
      {icon ? <Icon name={icon} size={16} strokeWidth={2} /> : null}
      {children}
      {iconEnd ? <Icon name={iconEnd} size={16} strokeWidth={2} /> : null}
    </>
  )

  return href ? (
    <Link href={href as Route} className={classes} {...rest}>
      {inner}
    </Link>
  ) : (
    <button type={type} className={classes} {...rest}>
      {inner}
    </button>
  )
}

export function EmptyState({
  icon = 'enquiries',
  title,
  description,
  action,
  className,
}: {
  readonly icon?: IconName
  readonly title: string
  readonly description?: string
  readonly action?: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className={['flex flex-col items-center px-6 py-12 text-center', className]
        .filter(Boolean)
        .join(' ')}
    >
      <span className="mb-3 flex size-11 items-center justify-center rounded-full bg-surface-sunken text-ink-subtle">
        <Icon name={icon} size={20} />
      </span>
      <p className="text-[0.9375rem] font-medium text-ink">{title}</p>
      {description ? (
        <p className="mt-1 max-w-sm text-[0.8125rem] text-ink-muted">{description}</p>
      ) : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}

/**
 * A labelled value.
 *
 * The job file and the tracking page are mostly this: forty pairs of "what it
 * is called" and "what it says". Defining it once is what stops the same pair
 * being spelled three different ways across three screens.
 */
export function Field({
  label,
  children,
  mono = false,
  className,
}: {
  readonly label: ReactNode
  readonly children: ReactNode
  /** For references, container numbers and bill numbers. */
  readonly mono?: boolean
  readonly className?: string
}) {
  return (
    <div className={['min-w-0', className].filter(Boolean).join(' ')}>
      <dt className="eyebrow mb-1">{label}</dt>
      <dd
        className={`truncate text-[0.875rem] text-ink ${mono ? 'ref numeric' : ''}`}
        title={typeof children === 'string' ? children : undefined}
      >
        {children}
      </dd>
    </div>
  )
}

/**
 * A lane: origin → destination.
 *
 * A component rather than a formatted string, and the reason is bidi. `U+2192
 * RIGHTWARDS ARROW` is not a mirrored character, so in Arabic the text
 * reorders correctly — origin to the right, destination to the left — while
 * the arrow keeps pointing right, back at the origin. A drawn arrow with
 * `rtl:-scale-x-100` points at the destination in both directions.
 *
 * `formatLane` still exists for `title` and `aria-label`, where a plain string
 * is the only thing accepted and no glyph is drawn.
 */
export function Lane({
  origin,
  destination,
  className,
}: {
  readonly origin: string
  readonly destination: string
  readonly className?: string
}) {
  return (
    <span className={['inline-flex items-center gap-1.5', className].filter(Boolean).join(' ')}>
      <span className="truncate">{origin}</span>
      <Icon name="arrow-end" size={13} className="shrink-0 opacity-60" />
      <span className="truncate">{destination}</span>
    </span>
  )
}

/** The dashboard's column grid. Twelve columns, collapsing to one on a phone. */
export function Grid({
  children,
  className,
}: {
  readonly children: ReactNode
  readonly className?: string
}) {
  return (
    <div
      className={['grid grid-cols-1 gap-4 lg:grid-cols-12', className].filter(Boolean).join(' ')}
    >
      {children}
    </div>
  )
}
