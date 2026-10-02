/**
 * The metric vocabulary — the row of numbers every board opens with.
 *
 * Four pieces, deliberately separable, because the reference dashboards all
 * make the same move and then differ only in which *evidence* they attach to
 * the number:
 *
 *   `Metric`      the frame — label, value, and one slot underneath
 *   `Delta`       "+5%" against the previous period
 *   `Spark`       the shape of the last N periods
 *   `TickMeter`   a ratio, drawn as discrete ticks rather than a smooth bar
 *
 * The number is the loudest thing in the tile and everything else recedes,
 * which is the whole reason the pattern works: an operations manager reads
 * eight of these in about two seconds and only stops on the one that is wrong.
 *
 * Every one of them is a server component. There is no chart library here —
 * a sparkline is nine SVG points and a meter is a flex row of divs, and
 * shipping 40KB of JavaScript to draw either is how dashboards get slow.
 */

import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { Icon, type IconName } from './icon'

export type MetricTone = 'neutral' | 'positive' | 'caution' | 'critical' | 'brand' | 'info'

/**
 * Tone colours the *evidence*, never the number.
 *
 * The value itself stays in ink in every tile. A row where four numbers are
 * four colours has no hierarchy left to spend when one of them actually goes
 * wrong — so the tone lands on the icon chip and the delta, and the tile that
 * matters is the one with a red chip rather than the one that shouted first.
 */
const CHIP_TONE: Record<MetricTone, string> = {
  neutral: 'bg-surface-sunken text-ink-muted',
  positive: 'bg-positive-soft text-positive',
  caution: 'bg-caution-soft text-caution',
  critical: 'bg-critical-soft text-critical',
  // The accent, for the reason `Card`'s `brand` tone gives.
  brand: 'bg-accent-soft text-accent',
  info: 'bg-info-soft text-info',
}

export interface MetricProps {
  readonly label: ReactNode
  readonly value: ReactNode
  /** A denominator — the "32" in "22 of 32". Rendered small, muted, inline. */
  readonly of?: ReactNode
  /** The currency or unit, set beside the value rather than inside it. */
  readonly unit?: ReactNode
  readonly icon?: IconName
  readonly tone?: MetricTone
  /** One line under the value: what the number means, or what to do about it. */
  readonly hint?: ReactNode
  /** The evidence slot — a `Delta`, a `Spark`, a `TickMeter`. */
  readonly children?: ReactNode
  /** Makes the whole tile the hit target. */
  readonly href?: string
  /** Pulses the value. Reserved for a figure that is genuinely still moving. */
  readonly live?: boolean
  readonly className?: string
}

export function Metric({
  label,
  value,
  of,
  unit,
  icon,
  tone = 'neutral',
  hint,
  children,
  href,
  live = false,
  className,
}: MetricProps) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-body-sm leading-tight font-medium text-ink-muted">{label}</p>
        {icon ? (
          <span
            className={`flex size-8 shrink-0 items-center justify-center rounded-full ${CHIP_TONE[tone]}`}
          >
            <Icon name={icon} size={16} />
          </span>
        ) : null}
      </div>

      {/*
        Sized by the tile, not the window (the tile is a size container).

        Two tiles share a 390px phone, and "KWD 5,000.000" at the desktop size
        was wider than its tile and pushed the page sideways. Window
        breakpoints then chased the tile around: smaller below sm, larger from
        sm, smaller again from lg where four share a row beside the sidebar,
        larger at 2xl — and still the quotation's figures ran out of their
        tiles at 390 and at 768, where the sidebar leaves a half-width tile
        narrower than a phone's. The tile knows its own width; the figure
        steps up only when the tile has room for it. The unit may drop under
        the figure rather than overflow.
      */}
      <p className="mt-3 flex min-w-0 flex-wrap items-baseline gap-1.5">
        <span
          className={`numeric min-w-0 font-display text-headline leading-none font-semibold tracking-tight text-ink @[13rem]:text-display @[17rem]:text-display-lg ${
            live ? 'accruing' : ''
          }`}
        >
          {value}
        </span>
        {of ? <span className="numeric text-title text-ink-subtle">/{of}</span> : null}
        {unit ? (
          // `dir="auto"` for the reason `Money` gives: "US$" in an Arabic tile read "$US".
          <span
            dir="auto"
            className="text-caption font-medium tracking-wide text-ink-muted uppercase"
          >
            {unit}
          </span>
        ) : null}
      </p>

      {children ? <div className="mt-3">{children}</div> : null}
      {/* Muted, not subtle: 12px subtle ink on a tinted tile measured 4.3–4.5:1. */}
      {hint ? <p className="mt-2 text-caption leading-snug text-ink-muted">{hint}</p> : null}
    </>
  )

  /**
   * A tinted card for a tile that carries a condition.
   *
   * The wash is very low-contrast on purpose — enough that a row of tiles has
   * texture and the one in alarm is findable in peripheral vision, not enough
   * to compete with the figures. `neutral` stays pure white, which is what
   * makes the tinted ones read as *saying something*: if every tile were
   * tinted, none would be.
   */
  const SURFACE: Record<MetricTone, string> = {
    neutral: 'border-line bg-surface',
    positive: 'border-positive/25 bg-positive-soft/25',
    caution: 'border-caution/30 bg-caution-soft/30',
    critical: 'border-critical/30 bg-critical-soft/30',
    brand: 'border-accent/20 bg-accent-soft/50',
    info: 'border-info/25 bg-info-soft/25',
  }

  const classes = [
    '@container min-w-0 rounded-card border p-4 transition-colors',
    SURFACE[tone],
    href ? 'hover:border-line-strong hover:brightness-[0.985]' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ')

  return href ? (
    <Link href={href as Route} className={`block ${classes}`}>
      {body}
    </Link>
  ) : (
    <div className={classes}>{body}</div>
  )
}

/**
 * A period-over-period change.
 *
 * Direction is carried by an arrow as well as by colour, because "down 5%" and
 * "up 5%" must not be distinguishable *only* by hue — that is the one piece of
 * a dashboard a red-green colour-blind reader gets wrong every time.
 *
 * `goodWhen` exists because down is not universally bad. Fewer open exceptions
 * is the improvement; fewer shipments is not.
 */
export function Delta({
  value,
  goodWhen = 'up',
  suffix = '%',
  caption,
}: {
  readonly value: number
  readonly goodWhen?: 'up' | 'down' | 'never'
  readonly suffix?: string
  readonly caption?: ReactNode
}) {
  const rounded = Math.round(value * 10) / 10
  const flat = rounded === 0
  const up = rounded > 0
  const good = goodWhen === 'never' ? false : goodWhen === 'up' ? up : !up

  const tone = flat
    ? 'bg-surface-sunken text-ink-subtle'
    : good
      ? 'bg-positive-soft text-positive'
      : 'bg-critical-soft text-critical'

  return (
    <p className="flex items-center gap-2">
      <span
        className={`inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-caption font-semibold ${tone}`}
      >
        {flat ? null : (
          <Icon name={up ? 'arrow-up-end' : 'arrow-down-end'} size={12} weight="bold" />
        )}
        <span className="numeric">
          {up && !flat ? '+' : ''}
          {rounded}
          {suffix}
        </span>
      </span>
      {caption ? <span className="truncate text-caption text-ink-subtle">{caption}</span> : null}
    </p>
  )
}

/**
 * A sparkline.
 *
 * Deliberately axis-less and label-less: it is not a chart, it is the *shape*
 * of a number's recent history, and the moment it gets a scale someone will
 * try to read a value off it. The area under the line is filled at low opacity
 * so the direction reads at 40px wide.
 *
 * A flat or single-point series renders a rule rather than collapsing — a
 * dashboard with one week of data should look like a new install, not a bug.
 */
export function Spark({
  points,
  tone = 'brand',
  height = 34,
  className,
}: {
  readonly points: readonly number[]
  readonly tone?: 'brand' | 'positive' | 'critical' | 'caution' | 'info'
  readonly height?: number
  readonly className?: string
}) {
  const width = 120
  const stroke = {
    // Accent: a trend line in the brand red reads as a falling one.
    brand: 'var(--qb-accent)',
    positive: 'var(--qb-positive)',
    critical: 'var(--qb-critical)',
    caution: 'var(--qb-caution)',
    info: 'var(--qb-info)',
  }[tone]

  if (points.length < 2) {
    return (
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className={`w-full ${className ?? ''}`}
        style={{ height }}
        preserveAspectRatio="none"
        aria-hidden
      >
        <line
          x1="0"
          y1={height / 2}
          x2={width}
          y2={height / 2}
          stroke="var(--qb-line)"
          strokeWidth="2"
          strokeDasharray="3 4"
        />
      </svg>
    )
  }

  const min = Math.min(...points)
  const max = Math.max(...points)
  // A flat series would divide by zero; give it a band so it draws mid-height.
  const span = max - min || 1
  const pad = 3

  const coords = points.map((value, index) => {
    const x = (index / (points.length - 1)) * width
    const y = height - pad - ((value - min) / span) * (height - pad * 2)
    return [x, y] as const
  })

  const line = coords.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
  const area = `${line.join(' ')} L${width} ${height} L0 ${height} Z`
  const last = coords[coords.length - 1]!
  const gradientId = `spark-${tone}`

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className={`w-full ${className ?? ''}`}
      style={{ height }}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.22" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gradientId})`} />
      <path
        d={line.join(' ')}
        fill="none"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={stroke} vectorEffect="non-scaling-stroke" />
    </svg>
  )
}

/**
 * A ratio, drawn as discrete ticks.
 *
 * A continuous progress bar invites reading a precise percentage off it, which
 * it cannot support. Ticks say "about this many out of that many" and stop
 * there, which is exactly the precision a capacity figure deserves. The unfilled
 * remainder stays visible so the *denominator* is legible too — a bar that only
 * draws the filled portion hides the thing you are measuring against.
 */
export function TickMeter({
  value,
  max,
  tone = 'brand',
  ticks = 28,
  label,
}: {
  readonly value: number
  readonly max: number
  readonly tone?: MetricTone
  readonly ticks?: number
  readonly label?: ReactNode
}) {
  const ratio = max > 0 ? Math.min(1, Math.max(0, value / max)) : 0
  const filled = Math.round(ratio * ticks)

  const fill: Record<MetricTone, string> = {
    neutral: 'bg-ink-subtle',
    positive: 'bg-positive',
    caution: 'bg-caution',
    critical: 'bg-critical',
    brand: 'bg-accent',
    info: 'bg-info',
  }

  return (
    <div>
      <div
        className="flex h-7 items-end gap-[2px]"
        role="meter"
        aria-valuenow={value}
        aria-valuemin={0}
        aria-valuemax={max}
      >
        {Array.from({ length: ticks }, (_, index) => {
          const on = index < filled
          return (
            <span
              key={index}
              className={`w-full rounded-full ${on ? fill[tone] : 'bg-line'}`}
              style={{
                // Filled ticks fade out toward the head so the meter reads as
                // a direction rather than as a wall.
                height: on ? '100%' : '58%',
                opacity: on ? 1 - (index / ticks) * 0.45 : 1,
              }}
            />
          )
        })}
      </div>
      {label ? <p className="mt-1.5 text-caption text-ink-subtle">{label}</p> : null}
    </div>
  )
}
