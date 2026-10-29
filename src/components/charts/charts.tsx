'use client'

import {
  Area,
  AreaChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  XAxis,
  YAxis,
} from 'recharts'
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from '@/components/ui/chart'
import type { Lang } from '@/content/copy'

/**
 * The site's data charts, on shadcn/ui's chart (Recharts).
 *
 * Every chart here follows the same rules (DESIGN.md, "Charts and tables"):
 * a fixed height so nothing shifts while it measures, axes labelled with
 * units, gridlines in the line colour, blue for the primary series, navy for
 * a comparison, amber only for money running. In Arabic the time axis runs
 * right to left and the value axis moves to the right edge, so the chart
 * reads the same way as the page around it.
 */

const AXIS_TICK = { fontSize: 13 }
const kwd = (value: number) => value.toLocaleString('en-US', { minimumFractionDigits: 3 })

/* ── Demurrage accruing ─────────────────────────────────────────────────── */

/**
 * The demo's own clock: five free days, then KWD 28.000 a day, to day 21.
 * `stepAfter`, because a per diem arrives in whole days rather than by the hour.
 */
export function AccrualChart({
  lang,
  freeDays,
  perDiem,
  days,
}: {
  lang: Lang
  freeDays: number
  perDiem: number
  days: number
}) {
  const ar = lang === 'ar'
  const data = Array.from({ length: days + 1 }, (_, day) => ({
    day,
    accrued: Math.max(0, day - freeDays) * perDiem,
  }))
  const final = (days - freeDays) * perDiem
  const config = {
    accrued: { label: ar ? 'المتراكم (د.ك)' : 'Accrued (KWD)', color: 'var(--color-chart-3)' },
  } satisfies ChartConfig

  return (
    <div className="flex flex-col gap-3">
      <ChartContainer config={config} className="aspect-auto h-[300px] w-full sm:h-[340px]">
        <AreaChart data={data} margin={{ top: 28, right: 16, bottom: 28, left: 8 }}>
          <CartesianGrid vertical={false} />
          {/* Unlabelled in the plot: on a phone the band is narrower than its
            own name. The key under the chart names it at every width. */}
          <ReferenceArea x1={0} x2={freeDays} fill="var(--color-paper-sunk)" fillOpacity={1} />
          <XAxis
            dataKey="day"
            type="number"
            domain={[0, days]}
            ticks={[0, 3, 6, 9, 12, 15, 18, 21].filter((t) => t <= days)}
            reversed={ar}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line-strong)' }}
            tick={AXIS_TICK}
            label={{
              value: ar ? 'الأيام منذ التفريغ' : 'Days since discharge',
              position: 'insideBottom',
              offset: -18,
              fill: 'var(--color-ink-dim)',
              fontSize: 13,
            }}
          />
          <YAxis
            orientation={ar ? 'right' : 'left'}
            tickLine={false}
            axisLine={false}
            tick={AXIS_TICK}
            width={56}
            domain={[0, Math.ceil(final / 120) * 120]}
            ticks={Array.from({ length: Math.ceil(final / 120) + 1 }, (_, i) => i * 120)}
            label={{
              value: ar ? 'د.ك' : 'KWD',
              position: 'top',
              offset: 14,
              fill: 'var(--color-ink-dim)',
              fontSize: 13,
            }}
          />
          <ChartTooltip
            cursor={false}
            content={
              <ChartTooltipContent
                labelFormatter={(label) => (ar ? `اليوم ${label}` : `Day ${label}`)}
                formatter={(value) => kwd(Number(value))}
              />
            }
          />
          <Area
            dataKey="accrued"
            type="stepAfter"
            stroke="var(--color-accrued)"
            strokeWidth={2.5}
            fill="var(--color-accrued)"
            fillOpacity={0.14}
            isAnimationActive={false}
          />
          <ReferenceDot
            x={freeDays + 1}
            y={perDiem}
            r={5}
            fill="var(--color-accrued)"
            stroke="var(--color-paper-lift)"
            strokeWidth={2}
            label={{
              // The amount only, set in the empty free-time ground beside the
              // dot: a longer label ran across the stair. The title and caption
              // say what the dot is.
              value: ar ? `${kwd(perDiem)} د.ك` : `KWD ${kwd(perDiem)}`,
              position: ar ? 'right' : 'left',
              offset: 10,
              fill: 'var(--color-heading)',
              fontSize: 13,
              fontWeight: 600,
            }}
          />
          <ReferenceDot
            x={days}
            y={final}
            r={5}
            fill="var(--color-accrued)"
            stroke="var(--color-paper-lift)"
            strokeWidth={2}
            label={{
              value: ar ? `${kwd(final)} د.ك` : `KWD ${kwd(final)}`,
              position: ar ? 'right' : 'left',
              offset: 12,
              fill: 'var(--color-heading)',
              fontSize: 13,
              fontWeight: 600,
            }}
          />
        </AreaChart>
      </ChartContainer>
      <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
        <li className="flex items-center gap-2 text-label text-ink-dim">
          <span
            aria-hidden="true"
            className="size-3 rounded-[2px] bg-paper-sunk ring-1 ring-line"
          />
          {ar ? `وقت السماح (${freeDays} أيام)` : `Free time (${freeDays} days)`}
        </li>
        <li className="flex items-center gap-2 text-label text-ink-dim">
          <span aria-hidden="true" className="size-3 rounded-[2px] bg-amber" />
          {config.accrued.label}
        </li>
      </ul>
    </div>
  )
}

/* ── A flat bill against a per-shipment bill ────────────────────────────── */

/**
 * Illustrative, with no values on the axes: the shape is the content. A flat
 * bill is horizontal; a per-shipment bill starts at zero; they cross at 40%
 * of the range, which is solved from the two series rather than drawn by eye.
 */
export function CostShapeChart({ lang }: { lang: Lang }) {
  const ar = lang === 'ar'
  const FLAT = 40
  const PER = 1 // per unit of volume
  const data = Array.from({ length: 11 }, (_, i) => ({
    volume: i * 10,
    flat: FLAT,
    per: i * 10 * PER,
  }))
  const cross = FLAT / PER
  const config = {
    per: { label: ar ? 'لكل شحنة' : 'Per shipment', color: 'var(--color-chart-1)' },
    flat: { label: ar ? 'ثابتة' : 'Flat', color: 'var(--color-chart-2)' },
  } satisfies ChartConfig

  return (
    <div className="flex flex-col gap-4">
      <ChartContainer config={config} className="aspect-auto h-[260px] w-full sm:h-[300px]">
        <LineChart data={data} margin={{ top: 16, right: 16, bottom: 28, left: 8 }}>
          <CartesianGrid vertical={false} strokeDasharray="0" />
          <XAxis
            dataKey="volume"
            type="number"
            domain={[0, 100]}
            reversed={ar}
            tick={false}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line-strong)' }}
            label={{
              value: ar ? 'الشحنات في الشهر ←' : 'Shipments a month →',
              position: 'insideBottom',
              offset: -14,
              fill: 'var(--color-ink-dim)',
              fontSize: 13,
            }}
          />
          <YAxis
            orientation={ar ? 'right' : 'left'}
            domain={[0, 100]}
            tick={false}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line-strong)' }}
            width={32}
            label={{
              value: ar ? 'الفاتورة الشهرية' : 'Monthly bill',
              angle: ar ? 90 : -90,
              position: ar ? 'insideRight' : 'insideLeft',
              fill: 'var(--color-ink-dim)',
              fontSize: 13,
              style: { textAnchor: 'middle' },
            }}
          />
          <ReferenceLine x={cross} stroke="var(--color-line-strong)" strokeDasharray="4 4" />
          <Line
            dataKey="flat"
            type="linear"
            stroke="var(--color-flat)"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          <Line
            dataKey="per"
            type="linear"
            stroke="var(--color-per)"
            strokeWidth={2.5}
            dot={false}
            isAnimationActive={false}
          />
          <ReferenceDot
            x={cross}
            y={FLAT}
            r={6}
            fill="var(--color-per)"
            stroke="var(--color-paper-lift)"
            strokeWidth={2}
            label={{
              value: ar ? 'نقطة التعادل' : 'The crossing',
              position: 'top',
              offset: 12,
              fill: 'var(--color-heading)',
              fontSize: 13,
              fontWeight: 600,
            }}
          />
        </LineChart>
      </ChartContainer>
      {/* The key as a legend under the chart, rather than labels laid on the
          lines where they used to collide with each other. */}
      <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
        {(['flat', 'per'] as const).map((key) => (
          <li key={key} className="flex items-center gap-2 text-label text-ink-dim">
            <span
              aria-hidden="true"
              className="h-0.5 w-5 rounded-full"
              style={{ background: config[key].color }}
            />
            {config[key].label}
          </li>
        ))}
      </ul>
    </div>
  )
}
