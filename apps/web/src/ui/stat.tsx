/**
 * The stat tile — now an adapter over `Metric`.
 *
 * This used to be a second, near-identical tile: same job, slightly different
 * label treatment (a tracked uppercase eyebrow rather than sentence case), a
 * square icon chip rather than a round one, and a coloured *value*. The result
 * was that the dashboard and the four registers looked like two products, and
 * the difference was invisible to anyone reading either file on its own.
 *
 * So the second implementation is gone and the name stays. Four call sites
 * keep working, every tile in the application is one component, and there is
 * no longer a choice to get wrong.
 *
 * One behaviour deliberately changed rather than preserved: the value is no
 * longer tinted by `tone`. `Metric` puts the tone on the icon chip and leaves
 * the figure in ink, because a row where four numbers are four colours has no
 * hierarchy left to spend when one of them actually goes wrong. The condition
 * is still visible — it is just carried by the chip.
 */

import type { ReactNode } from 'react'
import { Metric, Spark, type MetricTone } from './metric'
import type { IconName } from './icon'
import type { Tone } from './status'

/**
 * `Tone` is the status vocabulary; `MetricTone` adds `neutral` and drops
 * `muted`. They mean the same thing, so the mapping is total and lossless.
 */
const TONE: Record<Tone, MetricTone> = {
  positive: 'positive',
  caution: 'caution',
  critical: 'critical',
  info: 'info',
  brand: 'brand',
  muted: 'neutral',
}

const SPARK_TONE: Record<Tone, 'brand' | 'positive' | 'critical' | 'caution' | 'info'> = {
  positive: 'positive',
  caution: 'caution',
  critical: 'critical',
  info: 'info',
  brand: 'brand',
  muted: 'info',
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
  return (
    <Metric
      label={label}
      value={value}
      unit={unit}
      hint={hint}
      icon={icon}
      tone={TONE[tone]}
      href={href}
      live={live}
      className={className}
    >
      {trend && trend.length > 1 ? (
        <Spark points={trend} tone={SPARK_TONE[tone]} height={30} />
      ) : null}
    </Metric>
  )
}
