'use client'

import { createContext, useContext, useId, useMemo } from 'react'
import type { ComponentProps, ComponentType, CSSProperties, ReactNode } from 'react'
import * as RechartsPrimitive from 'recharts'
import { cn } from '@/lib/utils'

/**
 * shadcn/ui's Chart, on Recharts 2.
 *
 * Recharts 3 was not installable: its dependency `reselect@5.1.1` was refused
 * by pnpm's trust check (an earlier version carried provenance and this one
 * does not), so the site pins Recharts 2.15, which shadcn's chart also
 * supports. The component is shadcn's, with logical properties for Arabic.
 *
 * A chart is configured with a `ChartConfig`: each series gets a label and a
 * colour, and the colour is exposed as `--color-<key>` so marks write
 * `fill="var(--color-accrued)"` and the legend and tooltip pick up the same
 * value. Colours come from the `--chart-*` tokens in `globals.css`.
 */
export type ChartConfig = Record<
  string,
  { label?: ReactNode; icon?: ComponentType; color?: string }
>

const ChartContext = createContext<{ config: ChartConfig } | null>(null)

function useChart() {
  const context = useContext(ChartContext)
  if (!context) throw new Error('useChart must be used within a <ChartContainer />')
  return context
}

export function ChartContainer({
  id,
  className,
  children,
  config,
  ...props
}: ComponentProps<'div'> & {
  config: ChartConfig
  children: ComponentProps<typeof RechartsPrimitive.ResponsiveContainer>['children']
}) {
  const uniqueId = useId()
  const chartId = `chart-${id || uniqueId.replace(/:/g, '')}`
  const style = useMemo(
    () =>
      Object.fromEntries(
        Object.entries(config)
          .filter(([, item]) => item.color)
          .map(([key, item]) => [`--color-${key}`, item.color]),
      ) as CSSProperties,
    [config],
  )

  return (
    <ChartContext.Provider value={{ config }}>
      {/* `dir="ltr"`: the drawing is mirrored by the chart itself (reversed
          axes, axis on the right) in Arabic. Inheriting `rtl` as well flipped
          SVG text anchors a second time, so labels ran off the plot edge. Text
          inside still renders as Arabic. */}
      <div
        dir="ltr"
        data-slot="chart"
        data-chart={chartId}
        style={style}
        className={cn(
          // Recharts draws its own text and lines; these hand them the site's
          // tokens so a chart reads like the page around it.
          "flex aspect-video justify-center text-label [&_.recharts-cartesian-axis-tick_text]:fill-ink-dim [&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-line [&_.recharts-curve.recharts-tooltip-cursor]:stroke-line-strong [&_.recharts-layer]:outline-hidden [&_.recharts-reference-line_[stroke='#ccc']]:stroke-line-strong [&_.recharts-rectangle.recharts-tooltip-cursor]:fill-paper-sunk [&_.recharts-sector]:outline-hidden [&_.recharts-surface]:outline-hidden",
          className,
        )}
        {...props}
      >
        <RechartsPrimitive.ResponsiveContainer>{children}</RechartsPrimitive.ResponsiveContainer>
      </div>
    </ChartContext.Provider>
  )
}

export const ChartTooltip = RechartsPrimitive.Tooltip

type TooltipItem = {
  name?: string | number
  value?: number | string
  dataKey?: string | number
  color?: string
  payload?: Record<string, unknown>
}

export function ChartTooltipContent({
  active,
  payload,
  label,
  className,
  formatter,
  labelFormatter,
  hideLabel = false,
}: {
  active?: boolean
  payload?: TooltipItem[]
  label?: ReactNode
  className?: string
  formatter?: (value: number | string, name: string) => ReactNode
  labelFormatter?: (label: ReactNode) => ReactNode
  hideLabel?: boolean
}) {
  const { config } = useChart()
  if (!active || !payload?.length) return null

  return (
    <div
      className={cn(
        'grid min-w-32 gap-1.5 rounded-lg border border-line bg-paper-lift px-3 py-2 text-label shadow-lg',
        className,
      )}
    >
      {hideLabel ? null : (
        <p className="font-semibold text-heading">
          {labelFormatter ? labelFormatter(label) : label}
        </p>
      )}
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.name ?? 'value')
        const series = config[key]
        return (
          <div key={key} className="flex items-center justify-between gap-4">
            <span className="flex items-center gap-2 text-ink-dim">
              <span
                aria-hidden="true"
                className="size-2.5 rounded-[2px]"
                style={{ background: item.color ?? `var(--color-${key})` }}
              />
              {series?.label ?? item.name}
            </span>
            <span className="figures font-mono font-medium text-ink">
              {formatter && item.value !== undefined
                ? formatter(item.value, String(item.name))
                : item.value}
            </span>
          </div>
        )
      })}
    </div>
  )
}

export const ChartLegend = RechartsPrimitive.Legend

export function ChartLegendContent({
  payload,
  className,
}: {
  payload?: { value?: string; dataKey?: string | number; color?: string }[]
  className?: string
}) {
  const { config } = useChart()
  if (!payload?.length) return null
  return (
    <div
      className={cn('flex flex-wrap items-center justify-center gap-x-5 gap-y-2 pt-3', className)}
    >
      {payload.map((item) => {
        const key = String(item.dataKey ?? item.value ?? 'value')
        return (
          <span key={key} className="flex items-center gap-2 text-label text-ink-dim">
            <span
              aria-hidden="true"
              className="size-2.5 rounded-[2px]"
              style={{ background: item.color }}
            />
            {config[key]?.label ?? item.value}
          </span>
        )
      })}
    </div>
  )
}
