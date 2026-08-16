/**
 * Quote reads — Moment 2 and Moment 2b.
 *
 * The comparison view is the only screen in the product that shows buy, sell
 * and margin on the same row (`FR-EQ-07`). It is internal by construction: the
 * customer portal and the tracking page never call into this slice, and the
 * quotation PDF renders from the sell side alone.
 *
 * Prices are read from `priced_snapshot` — the resolved lines, divisors,
 * accessorials and FX rate exactly as they stood at pricing time (§6.3). The
 * rate card is never re-read to reprice: a rate change tomorrow must not
 * rewrite what was quoted yesterday, and that is why a June invoice reconciles
 * to a March booking.
 */

import 'server-only'
import { and, asc, desc, eq, isNull } from 'drizzle-orm'
import {
  chargeTypes,
  enquiries,
  customers,
  principals,
  quoteLines,
  quotes,
  withActor,
  type Actor,
} from '@qabandi/db'
import type { Mode, QuoteComparison, QuoteOptionView } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotQuote } from '@/lib/pilot/fixtures'

/**
 * The priced options for an enquiry, ranked.
 *
 * `enquiryId` is optional so the demo can open the comparison directly; in the
 * product it is always reached from the enquiry.
 */
export async function getQuoteComparison(
  actor: Actor,
  enquiryId?: string,
): Promise<QuoteComparison | undefined> {
  if (usePilotFixtures()) return pilotQuote()
  if (!enquiryId) return undefined

  return withActor(actor, async (tx) => {
    const [header] = await tx
      .select({
        enquiryReference: enquiries.reference,
        mode: enquiries.mode,
        incoterm: enquiries.incoterm,
        customerName: customers.legalNameEn,
        preparedBy: principals.nameEn,
      })
      .from(enquiries)
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .leftJoin(principals, eq(principals.id, enquiries.ownerId))
      .where(eq(enquiries.id, enquiryId))
      .limit(1)

    if (!header) return undefined

    const optionRows = await tx
      .select()
      .from(quotes)
      // Superseded revisions are history, not options (§7 rule one).
      .where(and(eq(quotes.enquiryId, enquiryId), isNull(quotes.supersededById)))
      .orderBy(desc(quotes.createdAt))
      .limit(5)

    if (optionRows.length === 0) return undefined

    const lineRows = await tx
      .select({
        quoteId: quoteLines.quoteId,
        description: quoteLines.description,
        basis: quoteLines.basis,
        quantity: quoteLines.quantity,
        rate: quoteLines.rate,
        amount: quoteLines.amount,
        currency: quoteLines.currency,
        code: chargeTypes.key,
        nameEn: chargeTypes.nameEn,
        nameAr: chargeTypes.nameAr,
      })
      .from(quoteLines)
      .innerJoin(chargeTypes, eq(chargeTypes.id, quoteLines.chargeTypeId))
      .orderBy(asc(quoteLines.sortOrder))

    /** The cheapest sell is recommended unless a snapshot says otherwise. */
    const cheapest = optionRows.reduce((best, row) =>
      Number(row.totalSell ?? 0) < Number(best.totalSell ?? 0) ? row : best,
    )

    const options = optionRows.map((row): QuoteOptionView => {
      const sell = Number(row.totalSell ?? 0)
      const cost = Number(row.totalCost ?? 0)
      const snapshot = (row.pricedSnapshot ?? {}) as Record<string, unknown>
      return {
        id: row.id,
        carrier: String(snapshot.carrier ?? '—'),
        service: String(snapshot.service ?? '—'),
        transitDays: Number(snapshot.transitDays ?? 0),
        buy: { amount: cost, currency: row.currency },
        sell: { amount: sell, currency: row.currency },
        marginPct: sell === 0 ? 0 : Math.round(((sell - cost) / sell) * 1000) / 10,
        validUntil: row.validUntil ? new Date(row.validUntil) : new Date(),
        isRecommended: row.id === cheapest.id,
        lines: lineRows
          .filter((line) => line.quoteId === row.id)
          .map((line) => ({
            chargeCode: line.code,
            nameEn: line.nameEn,
            nameAr: line.nameAr,
            basis: line.basis,
            quantity: Number(line.quantity),
            buyRate: 0,
            sellRate: Number(line.rate),
            amount: { amount: Number(line.amount), currency: line.currency },
          })),
      }
    })

    return {
      enquiryReference: header.enquiryReference,
      customerName: header.customerName ?? '—',
      lane: '—',
      mode: (header.mode ?? 'sea_fcl') as Mode,
      containerType: null,
      incoterm: header.incoterm ?? '—',
      preparedBy: header.preparedBy ?? '—',
      pricedAt: new Date(),
      manualTurnaroundHours: 0,
      pricingMs: 0,
      options,
    }
  })
}
