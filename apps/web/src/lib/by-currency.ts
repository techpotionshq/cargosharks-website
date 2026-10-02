/**
 * Money that is in more than one currency — kept apart, never added.
 *
 * The finance summaries each added a column up across every row and labelled
 * the result with whichever currency came first (F45, and the same bug in
 * ageing, top debtors, receipts and unbilled revenue). A KWD branch and an AED
 * branch then printed dinars plus dirhams as dinars. Amounts in different
 * currencies do not add without a rate, and a summary is not the place to
 * invent one, so every total here is a list: one figure per currency.
 *
 * Amounts stay `numeric` strings on the way through. The SQL paths sum in the
 * database; this module is for the paths that already hold rows — the fixtures
 * and the unbilled register — and sums them with `Decimal`, never `Number`.
 */

import { D } from '@qabandi/core'
import { formatMoney } from '@/lib/format'

/** One currency's share of a total. `amount` is `numeric` as text. */
export interface CurrencyAmount {
  readonly currency: string
  readonly amount: string
}

/**
 * Adds amounts up per currency, exactly.
 *
 * Largest first, then by code, which is the order the SQL summaries use
 * (`order by sum(…) desc, currency`) — so the currency most of the book is in
 * leads, and the fixture and database sides print in the same order.
 */
export function sumByCurrency(
  entries: Iterable<{ readonly currency: string; readonly amount: string | null | undefined }>,
): CurrencyAmount[] {
  const totals = new Map<string, InstanceType<typeof D>>()
  for (const { currency, amount } of entries) {
    totals.set(currency, (totals.get(currency) ?? new D(0)).plus(new D(amount ?? 0)))
  }
  return [...totals]
    .sort(([ac, a], [bc, b]) => b.comparedTo(a) || ac.localeCompare(bc))
    .map(([currency, total]) => ({ currency, amount: total.toFixed(6) }))
}

/**
 * A per-currency total as one line of text — `KWD 1,200.000 · AED 350.00`.
 *
 * The separator is the invoice register's, so every summary that shows more
 * than one currency reads the same way. `—` when there is nothing.
 */
export function formatByCurrency(
  totals: readonly CurrencyAmount[],
  locale: 'en' | 'ar',
  options: { compact?: boolean } = {},
): string {
  if (totals.length === 0) return '—'
  return totals
    .map(({ currency, amount }) =>
      formatMoney({ amount: Number(amount), currency }, locale, options),
    )
    .join(' · ')
}
