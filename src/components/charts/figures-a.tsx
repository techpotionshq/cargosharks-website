'use client'

import { Bar, BarChart, CartesianGrid, LabelList, ReferenceLine, XAxis, YAxis } from 'recharts'
import { ChartContainer, type ChartConfig } from '@/components/ui/chart'
import type { Lang } from '@/content/copy'

/**
 * Bar charts for the mechanism figures in `content/pages/figures.tsx`.
 *
 * The data and its arithmetic stay in `figures.tsx`, next to the comments that
 * say which seed file each number is transcribed from; these components only
 * draw what they are handed. Same rules as `charts.tsx`: fixed heights, no
 * animation, blue for the primary series and navy for the second, and in
 * Arabic the value axis reversed with the category axis on the right.
 */

const AXIS_TICK = { fontSize: 13 }
const n = (value: number) => value.toLocaleString('en-US')

type TickProps = {
  x?: number
  y?: number
  textAnchor?: string
  payload?: { value: string }
}

/**
 * A two-line category label: the name, and a short qualifier under it (a
 * divisor, a direction). Two short lines fit beside a bar on a phone where one
 * long one would push the plot to nothing.
 */
function twoLineTick(lines: Record<string, [string, string]>, ar: boolean) {
  return function Tick({ x = 0, y = 0, payload }: TickProps) {
    const [first, second] = lines[payload?.value ?? ''] ?? [payload?.value ?? '', '']
    // The axis sits on the start side of the plot, so its labels end against it.
    const anchor = ar ? 'start' : 'end'
    const dx = ar ? 8 : -8
    return (
      <text x={x + dx} y={y} textAnchor={anchor} fontSize={13}>
        <tspan x={x + dx} dy={second ? -2 : 4} fill="var(--color-heading)" fontWeight={600}>
          {first}
        </tspan>
        {second ? (
          <tspan x={x + dx} dy={16} fill="var(--color-ink-dim)">
            {second}
          </tspan>
        ) : null}
      </text>
    )
  }
}

type LabelProps = {
  x?: number | string
  y?: number | string
  width?: number | string
  height?: number | string
  value?: number | string
}

/**
 * The value at the end of a bar, as one plain `<text>`. Recharts' own label
 * wraps to the space it thinks is left, which in the reversed Arabic axis
 * broke "1,200 كجم" over two lines; a bar-end amount never needs wrapping.
 *
 * A bar longer than `insideFrom` of the axis carries its value inside its own
 * end, in white: on a phone there is no room past it. Arabic text is set
 * `direction="rtl"` so the unit reads after the number, and under it an SVG
 * `start` is the right-hand end.
 */
function barEndLabel(
  format: (value: number) => string,
  ar: boolean,
  top: number,
  insideFrom = 0.7,
) {
  return function BarEnd({ x = 0, y = 0, width = 0, height = 0, value }: LabelProps) {
    const [left, w] = [Number(x), Number(width)]
    const inside = Number(value) / top > insideFrom
    const end = ar ? Math.min(left, left + w) : Math.max(left, left + w)
    const gap = (inside ? -8 : 8) * (ar ? -1 : 1)
    return (
      <text
        x={end + gap}
        y={Number(y) + Number(height) / 2}
        dy="0.35em"
        direction={ar ? 'rtl' : 'ltr'}
        textAnchor={inside ? 'end' : 'start'}
        fill={inside ? 'var(--color-paper-lift)' : 'var(--color-heading)'}
        fontSize={13}
        fontWeight={600}
      >
        {format(Number(value))}
      </text>
    )
  }
}

/* ── Chargeable weight ──────────────────────────────────────────────────── */

export function ChargeableChart({
  lang,
  rows,
  grossKg,
}: {
  lang: Lang
  rows: { key: string; name: string; note: string; kg: number }[]
  grossKg: number
}) {
  const ar = lang === 'ar'
  const kg = ar ? 'كجم' : 'kg'
  const config = {
    kg: { label: ar ? 'الوزن الخاضع للتسعير' : 'Chargeable weight', color: 'var(--color-chart-1)' },
    scale: {
      label: ar ? `على الميزان: ${grossKg} كجم` : `On the scale: ${grossKg} kg`,
      color: 'var(--color-chart-2)',
    },
  } satisfies ChartConfig
  const lines = Object.fromEntries(
    rows.map((row) => [row.key, [row.name, row.note] as [string, string]]),
  )
  const max = Math.max(...rows.map((row) => row.kg))
  // Room past the longest bar for its label, on a round 400 kg grid.
  const top = Math.ceil((max * 1.25) / 400) * 400

  return (
    <div className="flex flex-col gap-4">
      <ChartContainer config={config} className="aspect-auto h-[300px] w-full sm:h-[320px]">
        <BarChart
          data={rows}
          layout="vertical"
          margin={{ top: 4, right: 8, bottom: 28, left: 8 }}
          barCategoryGap="28%"
        >
          <CartesianGrid horizontal={false} />
          <XAxis
            type="number"
            domain={[0, top]}
            ticks={Array.from({ length: top / 400 + 1 }, (_, i) => i * 400)}
            tickFormatter={n}
            reversed={ar}
            tickLine={false}
            axisLine={{ stroke: 'var(--color-line-strong)' }}
            tick={AXIS_TICK}
            label={{
              value: ar ? 'الوزن الخاضع للتسعير (كجم)' : 'Chargeable weight (kg)',
              position: 'insideBottom',
              offset: -18,
              fill: 'var(--color-ink-dim)',
              fontSize: 13,
            }}
          />
          <YAxis
            type="category"
            dataKey="key"
            orientation={ar ? 'right' : 'left'}
            width={96}
            tickLine={false}
            axisLine={false}
            tick={twoLineTick(lines, ar)}
          />
          <Bar dataKey="kg" fill="var(--color-kg)" radius={3} isAnimationActive={false}>
            <LabelList
              dataKey="kg"
              content={barEndLabel((value) => `${n(value)} ${kg}`, ar, top)}
            />
          </Bar>
          {/* What the scale says. Every bar past it is the difference between
              weighing a shipment and billing one; it is named in the key, since
              a label here would sit on the axis labels at phone width. */}
          <ReferenceLine
            x={grossKg}
            stroke="var(--color-scale)"
            strokeWidth={2}
            strokeDasharray="5 4"
          />
        </BarChart>
      </ChartContainer>
      <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
        <li className="flex items-center gap-2 text-label text-ink-dim">
          <span aria-hidden="true" className="size-3 rounded-[2px] bg-blue" />
          {config.kg.label}
        </li>
        <li className="flex items-center gap-2 text-label text-ink-dim">
          <span aria-hidden="true" className="h-0 w-5 border-t-2 border-dashed border-heading" />
          {config.scale.label}
        </li>
      </ul>
    </div>
  )
}

/* ── Milestone templates ────────────────────────────────────────────────── */

export function MilestoneChart({
  lang,
  rows,
}: {
  lang: Lang
  rows: { key: string; mode: string; direction: string; steps: number }[]
}) {
  const ar = lang === 'ar'
  const config = {
    steps: { label: ar ? 'المراحل' : 'Steps', color: 'var(--color-chart-1)' },
  } satisfies ChartConfig
  const lines = Object.fromEntries(
    rows.map((row) => [row.key, [row.mode, row.direction] as [string, string]]),
  )
  const top = Math.max(...rows.map((row) => row.steps)) + 1

  return (
    <ChartContainer config={config} className="aspect-auto h-[340px] w-full sm:h-[360px]">
      <BarChart
        data={rows}
        layout="vertical"
        margin={{ top: 4, right: 8, bottom: 28, left: 8 }}
        barCategoryGap="30%"
      >
        <CartesianGrid horizontal={false} />
        <XAxis
          type="number"
          domain={[0, top]}
          ticks={Array.from({ length: Math.floor(top / 3) + 1 }, (_, i) => i * 3)}
          allowDecimals={false}
          reversed={ar}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-line-strong)' }}
          tick={AXIS_TICK}
          label={{
            value: ar ? 'عدد المراحل' : 'Milestones in the template',
            position: 'insideBottom',
            offset: -18,
            fill: 'var(--color-ink-dim)',
            fontSize: 13,
          }}
        />
        <YAxis
          type="category"
          dataKey="key"
          orientation={ar ? 'right' : 'left'}
          width={88}
          tickLine={false}
          axisLine={false}
          tick={twoLineTick(lines, ar)}
        />
        <Bar dataKey="steps" fill="var(--color-steps)" radius={3} isAnimationActive={false}>
          <LabelList dataKey="steps" content={barEndLabel(n, ar, top, 1)} />
        </Bar>
      </BarChart>
    </ChartContainer>
  )
}

/* ── Allocation: one master cost, split ─────────────────────────────────── */

const SPLIT_COLOURS = ['var(--color-chart-1)', 'var(--color-chart-2)', 'var(--color-chart-5)']

/**
 * One stacked bar at the real proportions, each segment labelled with the
 * amount it posts. The segments are the drivers themselves (CBM), so the
 * picture cannot disagree with the table under it.
 */
export function AllocationBar({
  lang,
  rows,
}: {
  lang: Lang
  rows: { ref: string; cbm: number; posted: string }[]
}) {
  const ar = lang === 'ar'
  const datum = Object.fromEntries(rows.map((row) => [row.ref, row.cbm]))
  const total = rows.reduce((sum, row) => sum + row.cbm, 0)
  const config = Object.fromEntries(
    rows.map((row, index) => [
      row.ref,
      { label: `${row.ref} · ${row.cbm} cbm`, color: SPLIT_COLOURS[index % SPLIT_COLOURS.length] },
    ]),
  ) satisfies ChartConfig

  return (
    <div className="flex flex-col gap-4">
      <ChartContainer config={config} className="aspect-auto h-14 w-full">
        <BarChart
          data={[datum]}
          layout="vertical"
          margin={{ top: 0, right: 0, bottom: 0, left: 0 }}
          barCategoryGap={0}
        >
          <XAxis type="number" domain={[0, total]} hide reversed={ar} />
          <YAxis type="category" hide />
          {rows.map((row, index) => (
            <Bar
              key={row.ref}
              dataKey={row.ref}
              stackId="split"
              fill={`var(--color-${row.ref})`}
              stroke="var(--color-paper-lift)"
              strokeWidth={2}
              isAnimationActive={false}
            >
              <LabelList
                dataKey={row.ref}
                position="center"
                formatter={() => row.posted}
                // The light-blue third segment needs dark type; the others white.
                fill={index === 2 ? 'var(--color-heading)' : 'var(--color-paper-lift)'}
                fontSize={13}
                fontWeight={600}
                fontFamily="var(--pg-font-mono)"
              />
            </Bar>
          ))}
        </BarChart>
      </ChartContainer>
      <ul className="flex flex-wrap justify-center gap-x-6 gap-y-2">
        {rows.map((row) => (
          <li key={row.ref} className="flex items-center gap-2 text-label text-ink-dim">
            <span
              aria-hidden="true"
              className="size-3 rounded-[2px]"
              style={{ background: config[row.ref]?.color }}
            />
            {/* The reference isolated as its own left-to-right run: otherwise
                the Arabic bidi pass glues the volume onto it and the unit ends
                up on the far side of the reference. */}
            <span>
              <span dir="ltr">{row.ref}</span> · {row.cbm} {ar ? 'م³' : 'cbm'}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}
