import 'server-only'

/**
 * Credit reads — where a customer stands, and every exception ever made.
 *
 * Thin on purpose. The exposure is assembled in `@qabandi/db`'s `credit.ts`
 * because three slices need it and slices cannot import each other (§4), and
 * the rule is applied in `@qabandi/core`. What is left here is the part that is
 * genuinely this screen's: joining the approver's name onto the overrides, and
 * deciding which of them are still live.
 *
 * As everywhere, no query carries a branch filter: `withActor` sets the
 * principal and RLS applies the scope (§5.3).
 */

import { desc, eq } from 'drizzle-orm'
import { assessCredit, isNearLimit, toScale, type CreditAssessment } from '@qabandi/core'
import { creditOverrides, creditStanding, principals, withActor, type Actor } from '@qabandi/db'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotCreditOverrides, pilotCreditStanding } from '@/lib/pilot/fixtures'

interface CreditOverrideRow {
  readonly id: string
  readonly jobId: string | null
  readonly invoiceId: string | null
  readonly expiresOn: string | null
  readonly reason: string
  readonly approvedByEn: string
  readonly approvedByAr: string | null
  readonly approvedAt: Date
  readonly exposure: string
  readonly creditLimit: string
  readonly currency: string
  /** A standing override that has not lapsed. One-shots are never "live". */
  readonly isLive: boolean
}

export interface CreditView {
  readonly currency: string
  readonly outstanding: string
  readonly limit: string | null
  readonly headroom: string | null
  readonly excess: string
  readonly outcome: CreditAssessment['outcome']
  readonly blocked: boolean
  readonly nearLimit: boolean
  /** Non-empty means the exposure shown is a floor, not a total. */
  readonly unconvertible: readonly { readonly currency: string; readonly amount: string }[]
  readonly overrides: readonly CreditOverrideRow[]
}

/**
 * The credit card on a customer screen.
 *
 * The standing question — no proposed shipment — because this is the customer
 * as they are, not a decision about a particular commitment. Booking and
 * issuing ask their own version through `checkCredit`.
 */
export async function creditView(
  actor: Actor,
  customerId: string,
  branchId: string,
): Promise<CreditView> {
  /*
    Only the position comes from fixtures; the decision does not.

    `assessCredit` runs over both arms, so the outcome, the headroom and the
    near-limit warning are the same function's answer whether the exposure was
    summed by PostgreSQL or by `pilotCreditStanding`. A fixture that returned a
    finished `CreditView` would be a second credit engine, and the one thing a
    credit screen must not have is two.
  */
  const standing = usePilotFixtures()
    ? pilotCreditStanding(customerId)
    : await creditStanding(actor, customerId, branchId)
  const assessment = assessCredit(standing)

  const today = new Date().toISOString().slice(0, 10)

  const overrides = usePilotFixtures()
    ? pilotCreditOverrides(customerId)
    : await withActor(actor, (tx) =>
        tx
          .select({
            id: creditOverrides.id,
            jobId: creditOverrides.jobId,
            invoiceId: creditOverrides.invoiceId,
            expiresOn: creditOverrides.expiresOn,
            reason: creditOverrides.reason,
            approvedAt: creditOverrides.approvedAt,
            exposure: creditOverrides.exposure,
            creditLimit: creditOverrides.creditLimit,
            currency: creditOverrides.currency,
            approvedByEn: principals.nameEn,
            approvedByAr: principals.nameAr,
          })
          .from(creditOverrides)
          .innerJoin(principals, eq(principals.id, creditOverrides.approvedById))
          .where(eq(creditOverrides.customerId, customerId))
          .orderBy(desc(creditOverrides.approvedAt)),
      )

  return {
    currency: standing.currency,
    outstanding: toScale(standing.outstanding),
    limit: standing.limit ? toScale(standing.limit) : null,
    headroom: assessment.headroom ? toScale(assessment.headroom) : null,
    excess: toScale(assessment.excess),
    outcome: assessment.outcome,
    blocked: assessment.blocked,
    nearLimit: isNearLimit(assessment),
    unconvertible: standing.unconvertible,
    overrides: overrides.map((o) => ({
      ...o,
      /*
        Live means "still authorising something".

        A one-shot is never live: it did its job the moment the invoice it
        named was issued, and showing it as active would suggest the customer
        is currently released when they are not.
      */
      isLive: o.expiresOn !== null && o.expiresOn >= today,
    })),
  }
}
