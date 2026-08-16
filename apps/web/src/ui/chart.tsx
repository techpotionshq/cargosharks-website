/**
 * Charts — SVG, server-rendered, no library.
 *
 * The forms here are the four the operational screens actually need. Each is a
 * server component: the ops board already streams its data as HTML, and
 * shipping a charting library to draw six bars would cost more than the page.
 *
 * The rules these follow, and why they are not negotiable per-chart:
 *
 *   - **Nominal bars take one hue.** Jobs by status is a single series —
 *     colouring each bar differently spends the identity channel re-encoding
 *     what bar length already says, and invites the reader to look for a
 *     meaning that is not there.
 *   - **Series colours come from the validated slots**, in order, never cycled.
 *     A fifth category folds into "other".
 *   - **Text wears ink tokens, never the series colour.** A coloured swatch
 *     beside a label carries identity; coloured text just reduces contrast.
 *   - **Status colours never appear as series colours.** They mean state.
 *   - **Every multi-series chart carries a legend and direct values**, so
 *     identity and magnitude are both readable without relying on colour.
 *
 * Tooltips are native SVG `<title>` elements: they work with no JavaScript, in
 * a PDF export, and with a screen reader — which the usual div-following-the-
 * cursor does not.
 */

import type { Route } from 'next'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { CHART_SERIES_VARS } from '@qabandi/brand'

/** Slot N, in fixed assignment order. Beyond the last slot, callers fold. */
export function seriesColor(index: number): string {
  return CHART_SERIES_VARS[index] ?? 'var(--qb-muted)'
}

export interface BarDatum {
  readonly label: ReactNode
  /** Sorting and bar length both read this. */
  readonly value: number
  /** Rendered at the end of the row; defaults to the value. */
  readonly display?: string
  /** A status tone overrides the series hue — used only where the row *is* a state. */
  readonly color?: string
  readonly href?: string
  readonly hint?: string
}

/**
 * Ranked horizontal bars.
 *
 * The default form for "how much, by what" at fewer than a dozen categories:
 * the labels sit horizontally where they are readable at any length, which a
 * vertical column chart cannot promise once a lane is called
 * "Shuwaikh → Jebel Ali".
 */
export function BarList({
  data,
  max,
  className,
  emptyLabel = '—',
}: {
  readonly data: readonly BarDatum[]
  /** Fixes the scale across cards; defaults to the largest value present. */
  readonly max?: number
  readonly className?: string
  readonly emptyLabel?: string
}) {
  if (data.length === 0) {
    return <p className="py-6 text-center text-sm text-ink-subtle">{emptyLabel}</p>
  }

  const ceiling = Math.max(max ?? 0, ...data.map((d) => d.value), 1)

  return (
    <ul className={['flex flex-col gap-2.5', className].filter(Boolean).join(' ')}>
      {data.map((datum, index) => {
        const pct = Math.max((datum.value / ceiling) * 100, datum.value > 0 ? 2 : 0)
        const row = (
          <>
            <span className="flex items-baseline justify-between gap-3">
              <span className="truncate text-[0.8125rem] text-ink">{datum.label}</span>
              <span className="numeric shrink-0 text-[0.8125rem] font-semibold text-ink tabular-nums">
                {datum.display ?? datum.value.toLocaleString()}
              </span>
            </span>
            {/* The track is a sunken well, so a zero-value row still reads as a row. */}
            <span className="mt-1.5 block h-2 w-full overflow-hidden rounded-full bg-surface-sunken">
              <span
                className="block h-full rounded-full transition-[width] duration-500"
                style={{ width: `${pct}%`, backgroundColor: datum.color ?? seriesColor(0) }}
              />
            </span>
          </>
        )

        return (
          <li key={index}>
            {datum.href ? (
              <Link
                href={datum.href as Route}
                title={datum.hint}
                className="block rounded-sm outline-offset-4 hover:opacity-80"
              >
                {row}
              </Link>
            ) : (
              <span title={datum.hint} className="block">
                {row}
              </span>
            )}
          </li>
        )
      })}
    </ul>
  )
}

export interface CompositionSegment {
  readonly label: string
  readonly value: number
  /** Overrides the slot colour where the segment is a state rather than an identity. */
  readonly color?: string
}

/**
 * One bar, split into parts of a whole.
 *
 * Chosen over a donut deliberately: a donut asks the reader to compare angles,
 * which people are measurably bad at, and it wastes the middle of the card. A
 * single bar with a legend answers "what is the mix" in one glance and stacks
 * neatly under a card header.
 *
 * The 2px gaps between segments are structural — abutting fills of similar
 * lightness merge into one shape without them.
 */
export function CompositionBar({
  segments,
  className,
  height = 12,
}: {
  readonly segments: readonly CompositionSegment[]
  readonly className?: string
  readonly height?: number
}) {
  const total = segments.reduce((sum, s) => sum + s.value, 0)
  if (total === 0) {
    return <div className="h-3 w-full rounded-full bg-surface-sunken" />
  }

  return (
    <div className={className}>
      <div className="flex w-full gap-0.5" style={{ height }}>
        {segments.map((segment, index) => {
          if (segment.value === 0) return null
          const pct = (segment.value / total) * 100
          return (
            <span
              key={segment.label}
              title={`${segment.label}: ${segment.value}`}
              className="h-full rounded-full"
              style={{
                width: `${pct}%`,
                backgroundColor: segment.color ?? seriesColor(index),
              }}
            />
          )
        })}
      </div>

      {/* The legend is always present: identity must never be colour alone. */}
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {segments.map((segment, index) => (
          <li key={segment.label} className="flex items-center gap-1.5 text-[0.75rem]">
            <span
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: segment.color ?? seriesColor(index) }}
            />
            <span className="text-ink-muted">{segment.label}</span>
            <span className="numeric font-semibold text-ink">{segment.value}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export interface TrendPoint {
  readonly label: string
  readonly value: number
  /** Marked with a heavier axis tick — used for "today". */
  readonly emphasis?: boolean
}

/**
 * Volume over time, as columns.
 *
 * Columns rather than a line because the quantity is a count of discrete
 * events per day: a line implies you could read a value between Tuesday and
 * Wednesday, and there is nothing there. Only the extremes carry a label —
 * a number on every column is noise, not information.
 */
export function TrendColumns({
  points,
  className,
  height = 96,
  label,
}: {
  readonly points: readonly TrendPoint[]
  readonly className?: string
  readonly height?: number
  /** Describes the single series, in place of a legend box. */
  readonly label: string
}) {
  if (points.length === 0) return null
  const max = Math.max(...points.map((p) => p.value), 1)
  const peak = points.reduce((best, p) => (p.value > best.value ? p : best), points[0]!)

  return (
    <figure className={className}>
      <div className="flex items-end gap-1" style={{ height }} role="img" aria-label={label}>
        {points.map((point, index) => {
          const pct = point.value === 0 ? 2 : Math.max((point.value / max) * 100, 6)
          const isPeak = point === peak && point.value > 0
          return (
            <span
              key={index}
              className="group relative flex h-full flex-1 items-end justify-center"
              title={`${point.label}: ${point.value}`}
            >
              {isPeak ? (
                <span className="numeric absolute -top-0.5 text-[0.625rem] font-semibold text-ink-muted">
                  {point.value}
                </span>
              ) : null}
              <span
                className="w-full rounded-t-[4px] transition-opacity group-hover:opacity-70"
                style={{
                  height: `${pct}%`,
                  backgroundColor: seriesColor(0),
                  opacity: point.emphasis ? 1 : 0.82,
                }}
              />
            </span>
          )
        })}
      </div>
      {/* A baseline, and only the first and last labels: fourteen ticks is a smear. */}
      <div className="mt-2 flex items-center justify-between border-t border-line pt-1.5 text-[0.6875rem] text-ink-subtle">
        <span>{points[0]?.label}</span>
        <span>{points[points.length - 1]?.label}</span>
      </div>
    </figure>
  )
}

/**
 * A sparkline for a stat tile.
 *
 * Deliberately axis-less and label-less. Its job is direction and shape, not
 * value — the number above it carries the value, and adding a scale here would
 * compete with that number for the same glance.
 */
export function Sparkline({
  values,
  className,
  width = 120,
  height = 32,
  tone,
}: {
  readonly values: readonly number[]
  readonly className?: string
  readonly width?: number
  readonly height?: number
  /** Defaults to slot 1; a status tone is passed where the trend *is* a state. */
  readonly tone?: string
}) {
  if (values.length < 2) return null

  const max = Math.max(...values)
  const min = Math.min(...values)
  const span = max - min || 1
  const stepX = width / (values.length - 1)
  /** 2px inset top and bottom so the stroke is never clipped by the viewBox. */
  const y = (v: number) => height - 2 - ((v - min) / span) * (height - 4)

  const line = values
    .map((v, i) => `${i === 0 ? 'M' : 'L'}${(i * stepX).toFixed(1)} ${y(v).toFixed(1)}`)
    .join(' ')
  const area = `${line} L${width} ${height} L0 ${height} Z`
  const color = tone ?? seriesColor(0)
  const last = values[values.length - 1]!

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      className={className}
      preserveAspectRatio="none"
      aria-hidden="true"
      focusable="false"
    >
      <path d={area} fill={color} opacity="0.12" />
      <path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
      <circle cx={width} cy={y(last)} r="2.5" fill={color} />
    </svg>
  )
}

/**
 * A single proportion — free time consumed, SLA elapsed, capacity used.
 *
 * The tone is the caller's, because the same 80% is reassuring on a booking
 * target and alarming on a demurrage clock. Nothing here decides that.
 */
export function Meter({
  value,
  max,
  tone = 'var(--qb-chart-1)',
  className,
  label,
}: {
  readonly value: number
  readonly max: number
  readonly tone?: string
  readonly className?: string
  readonly label?: string
}) {
  const pct = max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100))
  return (
    <div
      className={['h-2 w-full overflow-hidden rounded-full bg-surface-sunken', className]
        .filter(Boolean)
        .join(' ')}
      role="meter"
      aria-valuenow={value}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-label={label}
    >
      <div
        className="h-full rounded-full transition-[width] duration-500"
        style={{ width: `${pct}%`, backgroundColor: tone }}
      />
    </div>
  )
}
