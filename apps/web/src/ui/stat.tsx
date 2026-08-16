/**
 * The stat tile.
 *
 * A number the reader is meant to *act* on, not study. The hierarchy is fixed
 * so a row of them scans as one instrument panel: label at the top in the
 * eyebrow treatment, the figure at 30px in tabular numerals, and one line of
 * context underneath.
 *
 * The rule that keeps the row honest: **a tile shows a state, not a
 * decoration.** Tone is passed only where the number itself is a condition —
 * breached SLAs, accruing demurrage — and left neutral everywhere else. Six
 * coloured tiles in a row communicate nothing, because nothing stands out.
 */

import type { ReactNode } from 'react'
import { Icon, type IconName } from './icon'
import { Sparkline } from './chart'
import type { Tone } from './status'

const VALUE_TONE: Record<Tone, string> = {
  positive: 'text-positive',
  caution: 'text-caution',
  critical: 'text-critical',
  info: 'text-info',
  muted: 'text-ink',
  brand: 'text-brand',
}

const ICON_TONE: Record<Tone, string> = {
  positive: 'bg-positive-soft text-positive',
  caution: 'bg-caution-soft text-caution',
  critical: 'bg-critical-soft text-critical',
  info: 'bg-info-soft text-info',
  muted: 'bg-surface-sunken text-ink-muted',
  brand: 'bg-brand-soft text-brand-soft-ink',
}

const SPARK_TONE: Record<Tone, string> = {
  positive: 'var(--qb-positive)',
  caution: 'var(--qb-caution)',
  critical: 'var(--qb-critical)',
  info: 'var(--qb-info)',
  muted: 'var(--qb-chart-1)',
  brand: 'var(--qb-chart-1)',
}

export interface StatTileProps {
  readonly label: string
  readonly value: ReactNode
  /** A currency, a unit, or "of 24" — set beside the figure, never inside it. */
  readonly unit?: string
  readonly hint?: ReactNode
  readonly icon?: IconName
  readonly tone?: Tone
  readonly trend?: readonly number[]
  /** The whole tile becomes the link to the list it summarises. */
  readonly href?: string
  /** Pulses slowly — reserved for a number that is genuinely still moving. */
  readonly live?: boolean
  readonly className?: string
}

export function StatTile({
  label,
  value,
  unit,
  hint,
  icon,
  tone = 'muted',
  trend,
  href,
  live = false,
  className,
}: StatTileProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="eyebrow">{label}</p>
        {icon ? (
          <span
            className={`flex size-7 shrink-0 items-center justify-center rounded-sm ${ICON_TONE[tone]}`}
          >
            <Icon name={icon} size={15} strokeWidth={2} />
          </span>
        ) : null}
      </div>

      <p className="mt-3 flex items-baseline gap-1.5">
        <span
          className={`numeric font-display text-[1.875rem] leading-none font-semibold tracking-tight ${VALUE_TONE[tone]} ${
            live ? 'accruing' : ''
          }`}
        >
          {value}
        </span>
        {unit ? <span className="text-[0.8125rem] font-medium text-ink-subtle">{unit}</span> : null}
      </p>

      <div className="mt-2.5 flex items-end justify-between gap-3">
        {hint ? (
          <p className="min-w-0 truncate text-[0.75rem] text-ink-muted">{hint}</p>
        ) : (
          <span />
        )}
        {trend && trend.length > 1 ? (
          <Sparkline values={trend} width={72} height={26} tone={SPARK_TONE[tone]} />
        ) : null}
      </div>
    </>
  )

  const shell =
    'rounded-card border border-line bg-surface p-4 shadow-card transition-shadow' +
    (href ? ' hover:border-line-strong hover:shadow-raised' : '')

  return href ? (
    <a href={href} className={[shell, 'block', className].filter(Boolean).join(' ')}>
      {body}
    </a>
  ) : (
    <div className={[shell, className].filter(Boolean).join(' ')}>{body}</div>
  )
}
