/**
 * Credit control — the decision, with no opinion about where the figures came
 * from.
 *
 * `customer_branch_terms.credit_limit` has been in the schema since the first
 * migration and, until this module, nothing read it. An administrator could
 * type 40,000 KWD into the customer form and the system would let the customer
 * book their next container regardless, with the first sign of trouble
 * appearing on the ageing report a month later. The column was documentation.
 *
 * Four decisions are encoded here, and each of them is the kind that gets
 * argued about once and then forgotten:
 *
 * **A limit that is not set is not a limit of zero.** `null` means nobody has
 * decided yet, and treating it as zero blocks every customer in the database
 * on the morning the feature ships — which is how a credit check gets switched
 * off permanently in week one. No limit, no block.
 *
 * **A hold is not arithmetic.** `is_on_hold` blocks a customer with a nil
 * balance and a million-dinar limit, because somebody put them on hold for a
 * reason the ledger does not know: a bounced cheque, a dispute, a company
 * being wound up. It is checked first and it does not consult the numbers.
 *
 * **The question is "will this put them over", not "are they over".** A
 * customer 500 under their limit booking a 3,000 shipment is the case worth
 * catching, and checking the balance alone misses it entirely. So the proposed
 * amount is part of the exposure, not compared against the headroom
 * afterwards.
 *
 * **Two currencies are refused, not converted.** The limit carries its own
 * currency and the exposure is summed in the branch's base. Converting here
 * would mean picking a rate, and a rate picked inside a decision function
 * makes yesterday's decision move when today's rate does. The caller converts
 * explicitly, with a rate it can store — the same rule every charge line
 * already follows (FR-RT-06).
 */

import { CurrencyMismatchError } from './errors'
// The same `YYYY-MM-DD` a free-time clock uses. Imported rather than restated
// so an override's expiry and an accrual's day cannot mean different things.
import type { CalendarDate } from './clocks'
import {
  add,
  compare,
  isZero,
  subtract,
  zero,
  type CurrencyCode,
  type Money,
} from './money'

/**
 * What a customer owes this branch, and what they are allowed to owe.
 *
 * `outstanding` is issued invoices less what has been paid against them. It
 * deliberately excludes draft invoices and unbilled charge lines: a draft is
 * not a debt, and work in progress that has not been invoiced is not something
 * a customer can be asked to pay. Including either would block shipments on
 * money nobody has demanded yet, and the operator would stop believing the
 * warning.
 */
export interface CreditPosition {
  readonly outstanding: Money
  /** Null where no limit has been agreed. See the header — not zero. */
  readonly limit: Money | null
  /** `customer_branch_terms.is_on_hold`. Absolute, and checked first. */
  readonly onHold: boolean
}

export type CreditOutcome =
  /** No limit agreed, or the exposure fits inside it. */
  | 'within_limit'
  /** No limit is set on this customer at this branch. */
  | 'unlimited'
  /** The exposure, including anything proposed, exceeds the limit. */
  | 'over_limit'
  /** Held by a person, for a reason the ledger does not hold. */
  | 'on_hold'

export interface CreditAssessment {
  readonly outcome: CreditOutcome
  /** True where the caller must refuse unless somebody overrides. */
  readonly blocked: boolean
  /** Outstanding plus whatever was proposed. What the decision was about. */
  readonly exposure: Money
  readonly limit: Money | null
  /** How far past the limit. Zero unless `over_limit`. */
  readonly excess: Money
  /** What remains before the limit bites. Null where there is no limit. */
  readonly headroom: Money | null
}

/**
 * Assesses a customer against their limit, optionally including a proposed
 * new commitment.
 *
 * `proposed` is the shipment about to be booked or the invoice about to be
 * issued. Omit it to ask the standing question — "where does this customer
 * stand" — which is what a customer screen shows.
 *
 * @throws CurrencyMismatchError where the limit and the exposure are not in
 * the same currency. Converting silently is the one thing this must not do.
 */
export function assessCredit(
  position: CreditPosition,
  proposed?: Money | null,
): CreditAssessment {
  const currency = position.outstanding.currency

  if (proposed && proposed.currency !== currency) {
    throw new CurrencyMismatchError(currency, proposed.currency)
  }
  if (position.limit && position.limit.currency !== currency) {
    throw new CurrencyMismatchError(currency, position.limit.currency)
  }

  const exposure = proposed ? add(position.outstanding, proposed) : position.outstanding

  /*
    The hold is answered before the arithmetic, and it still reports the
    exposure.

    An operator looking at a blocked booking needs both facts: that it is held,
    and what the balance is. Returning a zeroed assessment because the hold
    short-circuits would make the screen say "on hold, 0.000 KWD outstanding",
    which reads as a system fault rather than a credit decision.
  */
  if (position.onHold) {
    return {
      outcome: 'on_hold',
      blocked: true,
      exposure,
      limit: position.limit,
      excess: zero(currency),
      headroom: position.limit ? subtract(position.limit, exposure) : null,
    }
  }

  if (!position.limit) {
    return {
      outcome: 'unlimited',
      blocked: false,
      exposure,
      limit: null,
      excess: zero(currency),
      headroom: null,
    }
  }

  const headroom = subtract(position.limit, exposure)
  /*
    Exactly on the limit is inside it.

    A 40,000 limit means the customer may owe 40,000. Blocking at equality
    turns every round-number limit into a limit one fils lower, which nobody
    intends and everybody has to discover.
  */
  const over = compare(exposure, position.limit) > 0

  return {
    outcome: over ? 'over_limit' : 'within_limit',
    blocked: over,
    exposure,
    limit: position.limit,
    excess: over ? subtract(exposure, position.limit) : zero(currency),
    headroom,
  }
}

/**
 * A standing override, as the database holds it.
 *
 * `expiresOn` null is a one-shot tied to the job or invoice it was raised
 * for; a date is "this customer may trade over the limit until then", which is
 * the arrangement a manager actually makes and the alternative to quietly
 * raising the limit and never lowering it again.
 */
export interface StandingOverride {
  readonly jobId: string | null
  readonly invoiceId: string | null
  readonly expiresOn: string | null
}

/**
 * Whether an existing override authorises this particular commitment.
 *
 * Deliberately narrow. A one-shot override authorises the exact job or invoice
 * it names and nothing else — otherwise the first override a customer ever
 * receives becomes a permanent exemption, which is the failure this whole
 * mechanism exists to prevent.
 */
export function overrideCovers(
  override: StandingOverride,
  target: { readonly jobId?: string | null; readonly invoiceId?: string | null },
  today: CalendarDate,
): boolean {
  if (override.expiresOn !== null) {
    // A standing override covers everything for this customer until it lapses.
    // Compared as strings: `YYYY-MM-DD` sorts lexicographically by date, which
    // is the whole reason the format is used rather than a timestamp.
    return override.expiresOn >= today
  }

  if (override.jobId && target.jobId && override.jobId === target.jobId) return true
  if (override.invoiceId && target.invoiceId && override.invoiceId === target.invoiceId) {
    return true
  }
  return false
}

/**
 * The first override that authorises this commitment, or null.
 *
 * Returns the override rather than a boolean so the caller can say *which*
 * decision let the shipment through — "released by F. Al-Sayegh on 14 August,
 * customer confirmed payment in transit" is the sentence an operator needs,
 * and "credit check bypassed" is not.
 */
export function findCoveringOverride<T extends StandingOverride>(
  overrides: readonly T[],
  target: { readonly jobId?: string | null; readonly invoiceId?: string | null },
  today: CalendarDate,
): T | null {
  return overrides.find((o) => overrideCovers(o, target, today)) ?? null
}

/**
 * How close to the limit before a screen should say something.
 *
 * Not a block and not a configuration row — a display threshold. Eighty per
 * cent is the convention in credit control and the number is here rather than
 * in the web layer so the ops board, the customer screen and the booking
 * dialog cannot each pick their own.
 */
export const CREDIT_WARNING_RATIO = 0.8

/** True where the exposure is close enough to the limit to be worth showing. */
export function isNearLimit(assessment: CreditAssessment): boolean {
  if (!assessment.limit || assessment.blocked) return false
  if (isZero(assessment.limit)) return false

  return (
    assessment.exposure.amount
      .dividedBy(assessment.limit.amount)
      .greaterThanOrEqualTo(CREDIT_WARNING_RATIO)
  )
}

/**
 * Outstanding from issued invoices — total less what has been paid.
 *
 * Here rather than in a query so the definition of "owes us" exists once. A
 * credit note is an invoice with a negative total in this system, so it nets
 * off by ordinary addition and needs no special case.
 */
export function outstandingFrom(
  invoices: readonly { readonly total: Money; readonly amountPaid: Money }[],
  currency: CurrencyCode,
): Money {
  return invoices.reduce(
    (acc, inv) => add(acc, subtract(inv.total, inv.amountPaid)),
    zero(currency),
  )
}
