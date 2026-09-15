/**
 * A customer's credit standing, read once and shared.
 *
 * This lives in `db` rather than in a feature slice because three different
 * slices need the same answer and slices do not import each other (§4): the
 * booking screen asks before it creates a job, the invoice screen asks before
 * it issues, and the customer screen shows it standing still. Three copies of
 * this query would be three definitions of "what the customer owes us", and
 * the one on the booking screen would be the one that quietly drifted.
 *
 * The *decision* is not here. `core/credit.ts` takes the position and answers;
 * this only assembles it. That split is what lets every rule about limits,
 * holds and equality be tested against no database at all.
 *
 * ## Currency, and why an unconvertible invoice is reported rather than dropped
 *
 * A credit limit carries its own currency and a customer's invoices carry
 * theirs — a Kuwaiti customer with a 40,000 KWD limit routinely holds an
 * invoice in USD. Summing those needs a rate, and the honest failure mode
 * matters more than the happy path: an invoice this cannot convert is *not*
 * silently excluded, because excluding it makes the exposure look smaller than
 * it is and the check would pass a customer it should stop. It is counted in
 * `unconvertible` and the caller shows it.
 */

import { and, desc, eq, isNotNull, lte, or, sql } from 'drizzle-orm'
import {
  add,
  assessCredit,
  convert,
  findCoveringOverride,
  fromDb,
  fxRate,
  isZero,
  money,
  outstandingFrom,
  subtract,
  zero,
  type CreditAssessment,
  type CreditPosition,
  type Money,
} from '@qabandi/core'
import { withActor, type Actor } from './actor'
import { customerBranchTerms } from './schema/commercial'
import { creditOverrides } from './schema/commercial'
import { branches } from './schema/identity'
import { fxRates } from './schema/reference'
import { invoices } from './schema/finance'

export interface CreditStanding extends CreditPosition {
  readonly customerId: string
  readonly branchId: string
  /** The currency every figure above is stated in. */
  readonly currency: string
  /**
   * Invoices left out of `outstanding` because no rate was available.
   *
   * Empty in the ordinary case. Non-empty means the exposure shown is a
   * floor, not a total, and the screen must say so — a credit check that
   * quietly under-counts is worse than none, because it is believed.
   */
  readonly unconvertible: readonly { readonly currency: string; readonly amount: string }[]
}

/**
 * What a customer owes this branch, and what they are allowed to owe.
 *
 * The limit's own currency governs where one is set, because that is the
 * number a manager agreed and the one they will be asked about. Where no limit
 * is set there is nothing to compare against, so the branch's base currency is
 * used and the figure is informational.
 */
export async function creditStanding(
  actor: Actor,
  customerId: string,
  branchId: string,
): Promise<CreditStanding> {
  return withActor(actor, async (tx) => {
    const [terms] = await tx
      .select({
        creditLimit: customerBranchTerms.creditLimit,
        creditCurrency: customerBranchTerms.creditCurrency,
        isOnHold: customerBranchTerms.isOnHold,
      })
      .from(customerBranchTerms)
      .where(
        and(
          eq(customerBranchTerms.customerId, customerId),
          eq(customerBranchTerms.branchId, branchId),
        ),
      )
      .limit(1)

    const [branch] = await tx
      .select({ baseCurrency: branches.baseCurrency })
      .from(branches)
      .where(eq(branches.id, branchId))
      .limit(1)

    const currency = terms?.creditLimit
      ? (terms.creditCurrency ?? branch?.baseCurrency ?? 'KWD')
      : (branch?.baseCurrency ?? 'KWD')

    /*
      Issued and unpaid. Drafts are excluded deliberately.

      A draft invoice is not a debt — nobody has asked the customer for it —
      and blocking a shipment on one would block it on our own unfinished
      paperwork. `core/credit.ts` says the same thing on its `outstanding`
      field; it is stated in both places because this is the query somebody
      would otherwise "fix" by widening.
    */
    const open = await tx
      .select({
        currency: invoices.currency,
        total: invoices.total,
        amountPaid: invoices.amountPaid,
      })
      .from(invoices)
      .where(
        and(
          eq(invoices.customerId, customerId),
          eq(invoices.branchId, branchId),
          isNotNull(invoices.issuedAt),
          // Paid and void invoices are not owed. `status` carries both.
          or(eq(invoices.status, 'issued'), eq(invoices.status, 'part_paid')),
        ),
      )

    const sameCurrency = open.filter((i) => i.currency === currency)
    const foreign = open.filter((i) => i.currency !== currency)

    let outstanding = outstandingFrom(
      sameCurrency.map((i) => ({
        total: fromDb(i.total, currency),
        amountPaid: fromDb(i.amountPaid, currency),
      })),
      currency,
    )

    const unconvertible: { currency: string; amount: string }[] = []

    const asOf = new Date()

    for (const invoice of foreign) {
      const owed = subtract(
        fromDb(invoice.total, invoice.currency),
        fromDb(invoice.amountPaid, invoice.currency),
      )
      if (isZero(owed)) continue

      const rate = await latestRate(tx, invoice.currency, currency)
      if (!rate) {
        unconvertible.push({ currency: invoice.currency, amount: owed.amount.toFixed() })
        continue
      }

      // Through `convert` rather than multiplying by hand: it is the one place
      // that checks the rate's `from` matches the money's currency, which is
      // exactly the mistake an inverted rate would otherwise hide.
      outstanding = add(outstanding, convert(owed, fxRate(invoice.currency, currency, rate, asOf)))
    }

    return {
      customerId,
      branchId,
      currency,
      outstanding,
      limit: terms?.creditLimit ? money(terms.creditLimit, currency) : null,
      onHold: terms?.isOnHold ?? false,
      unconvertible,
    }
  })
}

/**
 * The most recent rate on or before today, in either direction.
 *
 * Feeds publish one direction and the reverse is arithmetic, so a deployment
 * holding USD→KWD can answer KWD→USD without a second row. Taking the latest
 * rather than the exact day's is deliberate: a credit check on a Friday must
 * not fail because the feed does not publish at the weekend.
 */
async function latestRate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  tx: any,
  from: string,
  to: string,
): Promise<string | null> {
  const today = new Date().toISOString().slice(0, 10)

  const [direct] = await tx
    .select({ rate: fxRates.rate })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.fromCurrency, from),
        eq(fxRates.toCurrency, to),
        lte(fxRates.effectiveOn, today),
      ),
    )
    .orderBy(desc(fxRates.effectiveOn))
    .limit(1)

  if (direct) return direct.rate

  const [inverse] = await tx
    .select({ rate: fxRates.rate })
    .from(fxRates)
    .where(
      and(
        eq(fxRates.fromCurrency, to),
        eq(fxRates.toCurrency, from),
        lte(fxRates.effectiveOn, today),
        // A zero rate would divide by zero below. Feeds do not publish them;
        // a hand-entered override can.
        sql`${fxRates.rate} <> 0`,
      ),
    )
    .orderBy(desc(fxRates.effectiveOn))
    .limit(1)

  if (!inverse) return null
  return money('1', to).amount.dividedBy(money(inverse.rate, to).amount).toFixed()
}

/**
 * Standing and one-shot overrides for this customer at this branch.
 *
 * Returned newest first so `findCoveringOverride` names the most recent
 * decision where more than one applies — "released by whom, most recently" is
 * the question an operator is actually asking.
 */
export async function creditOverridesFor(
  actor: Actor,
  customerId: string,
  branchId: string,
): Promise<
  {
    id: string
    jobId: string | null
    invoiceId: string | null
    expiresOn: string | null
    reason: string
    approvedById: string
    approvedAt: Date
    exposure: string
    creditLimit: string
    currency: string
  }[]
> {
  return withActor(actor, (tx) =>
    tx
      .select({
        id: creditOverrides.id,
        jobId: creditOverrides.jobId,
        invoiceId: creditOverrides.invoiceId,
        expiresOn: creditOverrides.expiresOn,
        reason: creditOverrides.reason,
        approvedById: creditOverrides.approvedById,
        approvedAt: creditOverrides.approvedAt,
        exposure: creditOverrides.exposure,
        creditLimit: creditOverrides.creditLimit,
        currency: creditOverrides.currency,
      })
      .from(creditOverrides)
      .where(
        and(eq(creditOverrides.customerId, customerId), eq(creditOverrides.branchId, branchId)),
      )
      .orderBy(desc(creditOverrides.approvedAt)),
  )
}

/** Zero in a branch's own currency — for a customer with no invoices at all. */
export function noExposure(currency: string): Money {
  return zero(currency)
}

/**
 * The whole check in one call: read the standing, apply the rule, and see
 * whether anybody has already authorised an exception.
 *
 * Here rather than in a feature slice for the reason the header gives — the
 * booking screen and the invoice screen both need it, and they cannot import
 * each other. What is deliberately *not* here is what to say about the result:
 * "this booking is blocked" and "this invoice cannot be issued" are different
 * sentences in two languages, and they belong in the slice that owns the
 * screen.
 */
export async function checkCredit(
  actor: Actor,
  input: {
    readonly customerId: string
    readonly branchId: string
    /** The shipment or invoice about to be committed, in any currency. */
    readonly proposed?: Money | null
    readonly jobId?: string | null
    readonly invoiceId?: string | null
    /** `YYYY-MM-DD`. Passed in so the caller owns the clock (§4). */
    readonly today?: string
  },
): Promise<{
  standing: CreditStanding
  assessment: CreditAssessment
  /** The decision that authorises this, where one does. */
  override: Awaited<ReturnType<typeof creditOverridesFor>>[number] | null
  /** False only where the rule blocks *and* nothing authorises it. */
  allowed: boolean
}> {
  const standing = await creditStanding(actor, input.customerId, input.branchId)

  /*
    A proposal in another currency is converted, not refused.

    `core/credit.ts` refuses a mismatch because a decision function must not
    pick a rate. This is the layer that may: it is already reading rates for
    the exposure, and it converts with the same one — so a USD invoice raises
    the exposure and is measured against the limit on identical terms.
  */
  let proposed = input.proposed ?? null
  if (proposed && proposed.currency !== standing.currency) {
    const rate = await withActor(actor, (tx) =>
      latestRate(tx, proposed!.currency, standing.currency),
    )
    proposed = rate
      ? convert(proposed, fxRate(proposed.currency, standing.currency, rate, new Date()))
      : null
  }

  const assessment = assessCredit(standing, proposed)
  if (!assessment.blocked) {
    return { standing, assessment, override: null, allowed: true }
  }

  /*
    A hold is not overridable here, and that is deliberate.

    An over-limit customer is an arithmetic judgement a branch manager can take
    responsibility for. A hold was placed by a person who decided this customer
    should not trade — releasing it is editing the hold, in front of whoever
    set it, not slipping one shipment past it.
  */
  if (assessment.outcome === 'on_hold') {
    return { standing, assessment, override: null, allowed: false }
  }

  const today = input.today ?? new Date().toISOString().slice(0, 10)
  const overrides = await creditOverridesFor(actor, input.customerId, input.branchId)
  const override = findCoveringOverride(
    overrides,
    { jobId: input.jobId ?? null, invoiceId: input.invoiceId ?? null },
    today,
  )

  return { standing, assessment, override, allowed: override !== null }
}
