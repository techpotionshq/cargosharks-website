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
  /** Credit notes against the job's invoices, already taken off `revenue`. */
  readonly creditedRevenue: Money
  /** The part of `cost` still standing on an accrual rather than a bill. */
  readonly accruedCost: Money
  /** The part of `cost` a supplier has actually invoiced for. */
  readonly billedCost: Money
}

/**
 * `creditedRevenue` is what credit notes have handed back on the job's
 * invoices, in the base currency. A credit note writes invoice lines and no
 * charge line, so a P&L over the charge ledger alone kept the whole sell
 * figure after a KWD 50 credit: revenue 604.022 and 20.0% margin where the
 * job had really earned 554.022 and 12.8% (N6). It is taken off revenue here,
 * once, so the gross and its percentage follow it.
 */
export function jobMargin(
  lines: readonly LedgerLine[],
  baseCurrency: CurrencyCode,
  creditedRevenue: Numeric = 0,
): LedgerMargin {
  const credited = money(creditedRevenue, baseCurrency)
  const summary = summariseMargin(
    [
      ...lines.map((l) => ({
        direction: l.direction,
        amountInBase: money(l.amountBase, baseCurrency),
      })),
      ...(isZero(credited)
        ? []
        : [
            {
              direction: 'revenue' as const,
              amountInBase: money(credited.amount.negated(), baseCurrency),
            },
          ]),
    ],
    baseCurrency,
  )

  const costsWhere = (accrual: boolean): Money =>
    sum(
      lines
        .filter((l) => l.direction === 'cost' && (l.isAccrual === true) === accrual)
        .map((l) => money(l.amountBase, baseCurrency)),
      baseCurrency,
    )

  return {
    ...summary,
    creditedRevenue: credited,
    accruedCost: costsWhere(true),
    billedCost: costsWhere(false),
  }
}

/** An empty P&L, for a job whose ledger has not been written yet. */
export function emptyLedgerMargin(baseCurrency: CurrencyCode): LedgerMargin {
  return {
    cost: zero(baseCurrency),
    revenue: zero(baseCurrency),
    gross: zero(baseCurrency),
    grossPercent: null,
    creditedRevenue: zero(baseCurrency),
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

/* -------------------------------------------------------------------------
 * Whether a priced draft needs a person before it goes anywhere — ai-13
 * ---------------------------------------------------------------------- */

/** One priced line, reduced to what the review reads: its charge and base amount. */
export interface ReviewLine {
  readonly chargeTypeKey: string
  readonly amountInBase: Money
}

/** Why a draft quotation should be looked at before it is sent. */
export type DraftConcern =
  /** This charge sells for less than it costs. */
  | {
      readonly kind: 'negative_margin'
      readonly chargeTypeKey: string
      readonly sell: string
      readonly cost: string
      /** Gross margin on this charge, one decimal, negative. */
      readonly marginPercent: string
    }
  /**
   * This charge is sold with nothing bought for it: the rate the draft was
   * costed on did not quote it, so nobody has priced the service being sold.
   */
  | { readonly kind: 'unbacked_charge'; readonly chargeTypeKey: string }

/**
 * The rule auto-draft applies before leaving a quotation for a person (ai-13).
 *
 * A live auto-draft priced a port-to-port award against a sell card that also
 * sold destination THC and haulage — services nobody had bought — and its
 * delivery order sold at −48.1% against the agent's figure, under a headline
 * margin that looked healthy. Both are visible only line by line. The rule:
 *
 *   1. **Negative margin.** Summed per charge type, a sell below its cost is a
 *      concern. Per charge rather than per line, because a sell card and a buy
 *      card split the same charge differently and only the sums compare.
 *   2. **Sold outside the requested scope.** The scope is what the buy side —
 *      the awarded agent rate, or the buy card the lane fell back to — quoted:
 *      its charge types. A charge sold with no cost behind it is a service the
 *      agent was not asked for or did not price (the haulage on a port-to-port
 *      award), and selling it means selling something nobody has bought.
 *
 * Charge-type granular rather than by `charge_types.category`, deliberately:
 * the live case had a delivery order bought, so "destination" was covered by
 * category, and the unbought destination THC and haulage would have passed.
 * The cost of the finer rule is that a house fee with no agent cost (our own
 * documentation charge) also asks for review — which is a person glancing at
 * a line, not a refusal, and the right side to err on before a price leaves.
 *
 * With no buy lines at all there is nothing to compare against and nothing is
 * flagged: that is a sell-card-only price, which a person chose to make.
 *
 * Returns the concerns, in the sell lines' order; empty means none.
 */
export function draftConcerns(input: {
  readonly revenue: readonly ReviewLine[]
  readonly cost: readonly ReviewLine[]
}): DraftConcern[] {
  if (input.cost.length === 0) return []

  const totals = (lines: readonly ReviewLine[]) => {
    const out = new Map<string, Decimal>()
    for (const line of lines) {
      out.set(
        line.chargeTypeKey,
        (out.get(line.chargeTypeKey) ?? dec(0)).plus(line.amountInBase.amount),
      )
    }
    return out
  }
  const sold = totals(input.revenue)
  const bought = totals(input.cost)

  const concerns: DraftConcern[] = []
  for (const [key, sell] of sold) {
    const cost = bought.get(key)
    if (cost === undefined || cost.isZero()) {
      concerns.push({ kind: 'unbacked_charge', chargeTypeKey: key })
      continue
    }
    if (sell.lessThan(cost)) {
      const marginPercent = sell.isZero()
        ? '-100.0'
        : sell.minus(cost).dividedBy(sell).times(100).toFixed(1)
      concerns.push({
        kind: 'negative_margin',
        chargeTypeKey: key,
        sell: sell.toFixed(),
        cost: cost.toFixed(),
        marginPercent,
      })
    }
  }
  return concerns
}
