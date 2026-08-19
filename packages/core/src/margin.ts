/**
 * Job profit and loss, from the charge ledger — FR-FN-01, FR-FN-04, FR-FN-05.
 *
 * The ledger has held both sides since 0000: a `cost` line is what the job
 * cost, a `revenue` line is what it earned, and both carry the FX rate taken
 * at pricing time. What was missing is anything that reads them. Costs were
 * written by the accrual workers and by the consolidation allocator, and the
 * only thing that ever read them back was the accounting export — so the
 * margin existed in the database and nowhere a person could see it.
 *
 * ## Why this is not a second definition of margin
 *
 * `rating.ts` already knows what gross margin is; it computes one at quoting
 * time, before there is a job. Writing a second one here would mean the number
 * on the quote and the number on the job could disagree, which is precisely
 * the argument this module is meant to settle. So `summariseMargin` does the
 * arithmetic in both places and this file adds only what a *ledger* has and a
 * quote does not: accruals, a floor, and estimate against actual.
 *
 * ## Why every figure is in base currency
 *
 * A job routinely holds an ocean freight in USD, a haulage in KWD and an agent
 * fee in INR. Summing those is meaningless, and converting at today's rate
 * makes last month's margin move every time somebody opens the screen. Each
 * line already carries `amount_base` at the rate it was taken at (FR-RT-06),
 * so the sum is over figures fixed when the commitment was made.
 */

import { dec, isZero, money, subtract, sum, zero } from './money'
import type { CurrencyCode, Money, Numeric } from './money'
import { summariseMargin } from './rating'
import type { MarginSummary } from './rating'
import type { Decimal } from 'decimal.js'

/**
 * One charge-ledger row, reduced to what a P&L needs.
 *
 * `isAccrual` separates what we *expect* from what we have been *told*, which
 * is FR-FN-02's requirement that estimate and actual both survive. It is not a
 * filter on the totals: an accrued cost is a real cost until a supplier
 * invoice replaces it, and excluding it would flatter the margin on every job
 * still in flight.
 */
export interface LedgerLine {
  readonly direction: 'cost' | 'revenue'
  readonly amountBase: Numeric
  readonly isAccrual?: boolean
}

export interface LedgerMargin extends MarginSummary {
  /** The part of `cost` still standing on an accrual rather than a bill. */
  readonly accruedCost: Money
  /** The part of `cost` a supplier has actually invoiced for. */
  readonly billedCost: Money
}

export function jobMargin(
  lines: readonly LedgerLine[],
  baseCurrency: CurrencyCode,
): LedgerMargin {
  const summary = summariseMargin(
    lines.map((l) => ({ direction: l.direction, amountInBase: money(l.amountBase, baseCurrency) })),
    baseCurrency,
  )

  const costsWhere = (accrual: boolean): Money =>
    sum(
      lines
        .filter((l) => l.direction === 'cost' && (l.isAccrual === true) === accrual)
        .map((l) => money(l.amountBase, baseCurrency)),
      baseCurrency,
    )

  return { ...summary, accruedCost: costsWhere(true), billedCost: costsWhere(false) }
}

/** An empty P&L, for a job whose ledger has not been written yet. */
export function emptyLedgerMargin(baseCurrency: CurrencyCode): LedgerMargin {
  return {
    cost: zero(baseCurrency),
    revenue: zero(baseCurrency),
    gross: zero(baseCurrency),
    grossPercent: null,
    accruedCost: zero(baseCurrency),
    billedCost: zero(baseCurrency),
  }
}

/**
 * FR-FN-05 — the floor that puts an invoice behind a manager's approval.
 *
 * A job with no revenue is *not* below the floor. It has not been priced yet,
 * and blocking it would put every freshly booked shipment into an approval
 * queue that means nothing. The gate belongs at the moment there is a sell
 * figure to judge, which is exactly when `grossPercent` stops being null.
 */
export function belowFloor(
  margin: MarginSummary,
  floorPercent: Numeric | null | undefined,
): boolean {
  if (floorPercent === null || floorPercent === undefined) return false
  if (margin.grossPercent === null) return false
  return margin.grossPercent.lessThan(dec(floorPercent))
}

/**
 * Estimate against actual — FR-FN-02.
 *
 * Positive means the actual came in *above* the estimate, which on the cost
 * side is the direction that costs money. The revenue side reads the sign the
 * other way round, and this stays neutral about which: inverting it here would
 * mean two functions differing by a minus sign, and eventually one caller
 * using the wrong one.
 */
export function varianceOf(estimate: Money, actual: Money): Money {
  return subtract(actual, estimate)
}

/** The variance as a proportion of the estimate. Null where nothing was estimated. */
export function variancePercent(estimate: Money, actual: Money): Decimal | null {
  if (isZero(estimate)) return null
  return subtract(actual, estimate).amount.div(estimate.amount).times(100)
}
