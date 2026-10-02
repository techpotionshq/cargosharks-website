/**
 * A figure in a money column.
 *
 * `formatMoney` returns one string, which is right for a sentence and wrong
 * for a column: "AED 5,502.00" above "KWD 980.250" ends a digit short, and in
 * Arabic the symbol came last — at the cell's aligned edge — so "د.إ." and
 * "د.ك." of different widths pushed every figure off the line. Here the code
 * is its own muted span at the start of the cell, the figure sits at the
 * aligned edge in tabular digits, and a two-place currency carries a figure
 * space where a third digit would be, so every row ends on the same place.
 *
 * The code comes first in the logical order in both languages. In Arabic
 * that puts it on the right of the figure, which keeps the figure at the
 * column's end edge (the left); the figure is isolated `ltr` so a minus sign
 * stays in front of it.
 *
 * Put it in a `TD numeric` (which brings `tabular-nums` and `nowrap`); the
 * text a screen reader or a copy gets is still "KWD 1,500.000", plus at most
 * a trailing blank.
 */

import { formatMoneyParts } from '@/lib/format'

export function Money({
  value,
  locale,
  showCurrency = true,
  compact = false,
  className,
}: {
  readonly value: { amount: number | string; currency: string } | null | undefined
  readonly locale: 'en' | 'ar'
  readonly showCurrency?: boolean
  readonly compact?: boolean
  readonly className?: string
}) {
  const parts = formatMoneyParts(value, locale, { showCurrency, compact })
  if (!parts) return <span className={className}>—</span>

  return (
    <span className={['numeric whitespace-nowrap', className].filter(Boolean).join(' ')}>
      {parts.currency ? (
        <>
          {/* `dir="auto"`: an Arabic symbol is right-to-left, but "US$" in
              an Arabic cell rendered "$US" until it was isolated as Latin. */}
          <span dir="auto" className="font-normal text-ink-muted">
            {parts.currency}
          </span>
          &nbsp;
        </>
      ) : null}
      <span dir="ltr">
        {parts.amount}
        {parts.pad}
      </span>
    </span>
  )
}
