/**
 * Matching a supplier's invoice against what the job accrued — FR-FN-09.
 *
 * The most common argument in a forwarder's week is the line or the agent
 * billing something other than what they quoted. Until this exists the
 * argument is had in a spreadsheet, after the customer has already been
 * invoiced at the accrued figure — which means the loss is found on the day it
 * became unrecoverable.
 *
 * Three figures meet here and the order matters:
 *
 *   quoted    the partner rate card or the RFQ response — what was agreed
 *   accrued   the cost charge line on the job — what we told our own P&L
 *   billed    the supplier invoice line — what they have now asked for
 *
 * The pair that decides whether an invoice is paid is *accrued against
 * billed*. Quoted is the evidence you reach for when the answer is "no", and
 * it lives in `rate_card_lines` — so this module takes it as an optional third
 * figure rather than requiring it. Plenty of legitimate costs — a customs
 * inspection, a demurrage day — were never quoted by anybody.
 *
 * ## Why there is only one ceiling
 *
 * `settlement.ts` refuses in both directions: you cannot allocate more of a
 * receipt than you received, and you cannot settle an invoice by more than it
 * is owed. Matching looks like the same shape and is not, and taking the
 * symmetry on trust would make this module useless.
 *
 * A supplier line cannot be matched for more than it is billed. That ceiling
 * is real, and breaking it invents a liability.
 *
 * But a charge line **must** be matchable for more than it accrued. That is
 * the whole event this exists to detect: we accrued 100, the agent billed 120,
 * and the 20 is the finding. A symmetric ceiling would refuse to record the
 * one fact worth recording, and the operator would go back to the spreadsheet
 * — which is where they started.
 *
 * So: one hard ceiling, and the other direction is reported as a variance and
 * escalated by tolerance, never refused.
 */

import { D, abs, compare, dec, isZero, money, round, subtract, sum } from './money'
import type { CurrencyCode, CurrencySpec, Money, Numeric } from './money'
import { DomainError } from './errors'
import type { Decimal } from 'decimal.js'

export class MatchingError extends DomainError {
  constructor(code: string, message: string) {
    super(code, message)
  }
}

// --- tolerance -------------------------------------------------------------

/**
 * How far a bill may drift from the accrual before somebody has to look.
 *
 * Both limits, and either one satisfied is enough. A percentage alone flags
 * every rounding difference on a 2 KWD documentation fee; an absolute alone
 * waves through a 400 KWD drift on an ocean freight because it happens to fall
 * under the same cash figure. A forwarder means "half a per cent, or five
 * dinars, whichever is the more generous", and that is what this is.
 */
export interface Tolerance {
  readonly percent: Decimal
  readonly absolute: Decimal
}

export const EXACT: Tolerance = { percent: new D(0), absolute: new D(0) }

export function tolerance(
  percent: Numeric | null | undefined,
  absolute: Numeric | null | undefined,
): Tolerance {
  return {
    percent: percent === null || percent === undefined ? new D(0) : dec(percent),
    absolute: absolute === null || absolute === undefined ? new D(0) : dec(absolute),
  }
}

/**
 * Which tolerance applies — the partner's, or the charge type's.
 *
 * Both are rows an administrator edits (FR-AD-03), and the order is
 * specific-beats-general with no blending: a partner allowed 2% is allowed 2%
 * on every charge type, because the reason they have that latitude is
 * commercial and has nothing to do with which line it lands on. Averaging the
 * two would produce a limit neither party agreed to.
 *
 * A partner row that sets neither figure is not an override. That is the
 * difference between "this agent is held to the standard" and "nobody has
 * configured this agent yet", and reading a blank row as a zero tolerance
 * would flag every bill from every partner the moment the row was created.
 */
export function resolveTolerance(
  chargeType: Tolerance | null | undefined,
  partner: Tolerance | null | undefined,
): Tolerance {
  if (partner && !(partner.percent.isZero() && partner.absolute.isZero())) return partner
  return chargeType ?? EXACT
}

// --- the comparison --------------------------------------------------------

/**
 * `over` and `under` are separate verdicts because the next action differs.
 *
 * Over means query it before paying — money is leaving the building that
 * nobody agreed to. Under means pay it and then ask why we over-accrued,
 * because an accrual that was too high has been quietly depressing the margin
 * on every similar job since.
 *
 * `unbilled` is the fourth state and the easiest to overlook: a cost the job
 * accrued that no supplier invoice has ever claimed. Left unexamined it is
 * either a bill still to come — fine — or an accrual for something that never
 * happened, which has been understating margin for months.
 */
export type MatchVerdict = 'exact' | 'within_tolerance' | 'over' | 'under' | 'unbilled'

export interface MatchOutcome {
  readonly verdict: MatchVerdict
  readonly accrued: Money
  readonly billed: Money
  /** Billed minus accrued. Positive is the direction that costs money. */
  readonly variance: Money
  /** The variance against the accrual, as a percentage. Null where nothing was accrued. */
  readonly variancePercent: Decimal | null
  /** What the tolerance permitted, so a message can name a number. */
  readonly allowed: Money
  readonly needsReview: boolean
}

/**
 * Compare one accrued figure with one billed figure.
 *
 * Both must be in the same currency, and a mismatch throws rather than
 * converts. A supplier billing in USD against a cost accrued in KWD is a real
 * situation, and the conversion belongs to the caller, who holds the rate the
 * accrual was taken at (FR-RT-06). Converting here at a rate of this module's
 * choosing is how a variance becomes an FX movement in disguise.
 */
export function compareToAccrual(
  accrued: Money,
  billed: Money,
  tol: Tolerance,
  spec: CurrencySpec,
): MatchOutcome {
  const variance = round(subtract(billed, accrued), spec)
  const magnitude = abs(variance)

  const proportional = round(
    money(dec(accrued.amount).abs().times(tol.percent).div(100), spec.code),
    spec,
  )
  const flat = round(money(tol.absolute, spec.code), spec)
  // Whichever limit is the more generous, as an operator means it.
  const allowed = compare(proportional, flat) >= 0 ? proportional : flat

  const percent = isZero(accrued)
    ? null
    : dec(variance.amount).div(dec(accrued.amount).abs()).times(100)

  const base = { accrued, billed, variance, variancePercent: percent, allowed }

  if (isZero(billed) && !isZero(accrued)) {
    return { ...base, verdict: 'unbilled', needsReview: false }
  }
  if (isZero(variance)) {
    return { ...base, verdict: 'exact', needsReview: false }
  }
  if (compare(magnitude, allowed) <= 0) {
    return { ...base, verdict: 'within_tolerance', needsReview: false }
  }

  return {
    ...base,
    verdict: dec(variance.amount).isPositive() ? 'over' : 'under',
    needsReview: true,
  }
}

// --- the ceiling -----------------------------------------------------------

/**
 * The position a match is judged against, as `numeric` hands it over.
 *
 * Strings, for the reason `settlement.ts` gives at length: `numeric(19,6)`
 * comes back as a string precisely so the precision survives, and KWD carries
 * three decimals where a float leaves 0.099999999999999645.
 */
export interface MatchPosition {
  /** The supplier line's own amount. */
  readonly billed: Numeric
  /** Already matched from that line, across every charge line. */
  readonly matched: Numeric
}

export type MatchRefusal = 'over_billed'

export type MatchAllocationVerdict =
  | { readonly ok: true }
  | { readonly ok: false; readonly reason: MatchRefusal; readonly available: Money }

/** What is left of the supplier's line to match. */
export function unmatched(position: MatchPosition, currency: CurrencyCode): Money {
  return subtract(money(position.billed, currency), money(position.matched, currency))
}

/**
 * May this amount be matched from that supplier line?
 *
 * One ceiling — see the header. Equality passes: matching a line off to the
 * fils is the ordinary case, and a check that rejects it is worse than none.
 *
 * As in `settlement.ts`, the *enforcement* stays in the caller's transaction.
 * This decides; reading the position and inserting the match together is what
 * makes the decision hold when two people work the same invoice at once.
 */
export function checkMatch(
  amount: Numeric,
  position: MatchPosition,
  currency: CurrencyCode,
): MatchAllocationVerdict {
  const value = dec(amount)

  if (value.isNegative() || value.isZero()) {
    throw new MatchingError('match_amount_not_positive', 'A match must be a positive amount.')
  }

  const left = unmatched(position, currency)
  if (value.greaterThan(left.amount)) {
    return { ok: false, reason: 'over_billed', available: left }
  }

  return { ok: true }
}

/** The position as the database reports it — `sum` over no rows is null, not zero. */
export function matchPositionFromDb(
  row: { readonly billed: string | null; readonly matched: string | null },
  currency: CurrencyCode,
): MatchPosition {
  return {
    billed: money(row.billed ?? 0, currency).amount,
    matched: money(row.matched ?? 0, currency).amount,
  }
}

// --- the invoice as a whole ------------------------------------------------

/**
 * One line of a supplier's invoice, with whatever it has been matched to.
 *
 * `accrued` is the sum of the charge lines it was matched against, already
 * converted to the invoice's currency by the caller. Zero with no matches
 * means a charge they have billed that no job ever accrued — the other half of
 * FR-FN-09 — and it reads as a full-value `over`.
 */
export interface SupplierLineInput {
  readonly id: string
  readonly description: string
  readonly billed: Numeric
  readonly accrued: Numeric
  readonly matchCount: number
  readonly tolerance: Tolerance
}

export interface LineOutcome extends MatchOutcome {
  readonly id: string
  readonly description: string
}

export interface InvoiceMatchSummary {
  readonly currency: CurrencyCode
  readonly billedTotal: Money
  readonly accruedTotal: Money
  readonly variance: Money
  readonly lines: readonly LineOutcome[]
  /** Lines outside tolerance, in the order they were given. */
  readonly review: readonly string[]
  /** Lines nobody has matched to anything at all. */
  readonly unmatchedLines: readonly string[]
  readonly clean: boolean
}

/**
 * Judge the whole invoice — what the review screen renders and what the
 * approval gate reads.
 *
 * Per line rather than on the totals, and the difference is not academic: an
 * agent who bills 200 over on freight and 200 under on haulage nets to zero on
 * the totals and has two things wrong with their invoice. Netting them hides
 * both.
 */
export function summariseInvoice(
  lines: readonly SupplierLineInput[],
  currency: CurrencyCode,
  spec: CurrencySpec,
): InvoiceMatchSummary {
  const outcomes: LineOutcome[] = lines.map((line) => ({
    id: line.id,
    description: line.description,
    ...compareToAccrual(
      money(line.accrued, currency),
      money(line.billed, currency),
      line.tolerance,
      spec,
    ),
  }))

  const billedTotal = sum(
    lines.map((l) => money(l.billed, currency)),
    currency,
  )
  const accruedTotal = sum(
    lines.map((l) => money(l.accrued, currency)),
    currency,
  )

  return {
    currency,
    billedTotal,
    accruedTotal,
    variance: subtract(billedTotal, accruedTotal),
    lines: outcomes,
    review: outcomes.filter((o) => o.needsReview).map((o) => o.id),
    unmatchedLines: lines.filter((l) => l.matchCount === 0).map((l) => l.id),
    clean: outcomes.every((o) => !o.needsReview) && lines.every((l) => l.matchCount > 0),
  }
}

/**
 * The quoted figure, where there is one — the evidence behind a refusal.
 *
 * Kept separate from the accrual comparison because it answers a different
 * question. "You billed more than we accrued" is an internal discrepancy and
 * might be our own error. "You billed more than you quoted" is a claim against
 * the partner, and it is the one that ends the argument.
 */
export function againstQuote(
  quoted: Money | null,
  billed: Money,
  tol: Tolerance,
  spec: CurrencySpec,
): MatchOutcome | null {
  if (quoted === null) return null
  return compareToAccrual(quoted, billed, tol, spec)
}

// --- the alert -------------------------------------------------------------

/**
 * What a variance alert to finance carries — the over-billed lines and the one
 * fact a subject line needs.
 *
 * Over only, and the asymmetry is the whole point. `over` is money about to
 * leave the building that nobody agreed to, and querying it *before* the bill
 * is approved is the saving. `under` is a P&L-accuracy problem — real, but it
 * is not a payment about to go out the door, so it stays on the review screen
 * (`summary.review` carries it) rather than in an inbox that would learn to
 * ignore an alert that fires on every rounding difference.
 */
export interface VarianceAlert {
  /** True when at least one line is billed over the accrual beyond tolerance. */
  readonly flagged: boolean
  /** The over-tolerance lines, in the order they were given. */
  readonly overLines: readonly LineOutcome[]
  /** The single worst line by variance — what a subject line names. */
  readonly worst: LineOutcome | null
  readonly overCount: number
  /** The summed over-variance across the flagged lines. */
  readonly totalOverVariance: Money
}

/**
 * Decide whether finance should be told about an already-summarised invoice.
 *
 * Pure and over an `InvoiceMatchSummary` the caller already built, so the "who
 * gets pushed a warning" rule is unit-tested without a database — every verdict
 * has already been reached by `compareToAccrual`, and this only reads them.
 */
export function varianceAlert(summary: InvoiceMatchSummary): VarianceAlert {
  const overLines = summary.lines.filter((line) => line.verdict === 'over')

  const worst = overLines.reduce<LineOutcome | null>(
    (worst, line) =>
      worst === null || compare(abs(line.variance), abs(worst.variance)) > 0 ? line : worst,
    null,
  )

  return {
    flagged: overLines.length > 0,
    overLines,
    worst,
    overCount: overLines.length,
    totalOverVariance: sum(
      overLines.map((line) => line.variance),
      summary.currency,
    ),
  }
}
