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
import { alias } from 'drizzle-orm/pg-core'
import {
  chargeTypes,
  enquiries,
  customers,
  locations,
  partners,
  principals,
  quoteLines,
  quotes,
  rateCards,
  withActor,
  type Actor,
} from '@qabandi/db'
import type { Mode, QuoteComparison, QuoteOptionView } from '@/lib/pilot/types'
import { usePilotFixtures } from '@/lib/pilot/source'
import { pilotQuote } from '@/lib/pilot/fixtures'

const origin = alias(locations, 'origin')
const destination = alias(locations, 'destination')

/**
 * A snapshot field as a string, or nothing.
 *
 * `String(undefined)` is `"undefined"`, and a blank string is not a value — a
 * carrier of `""` renders as an empty line where a name should be, which is
 * the same class of lie as a dash.
 */
function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null
}

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
        firstRespondedAt: enquiries.firstRespondedAt,
        status: enquiries.status,
        customerName: customers.legalNameEn,
        preparedBy: principals.nameEn,
        originName: origin.nameEn,
        destinationName: destination.nameEn,
      })
      .from(enquiries)
      .leftJoin(customers, eq(customers.id, enquiries.customerId))
      .leftJoin(principals, eq(principals.id, enquiries.ownerId))
      // The lane the enquiry actually names. It used to be a hard-coded dash
      // here while the register two clicks away resolved it from the same two
      // columns — the same shipment, described on one screen and blank on the
      // next.
      .leftJoin(origin, eq(origin.id, enquiries.originId))
      .leftJoin(destination, eq(destination.id, enquiries.destinationId))
      .where(eq(enquiries.id, enquiryId))
      .limit(1)

    if (!header) return undefined

    const optionRows = await tx
      .select({
        id: quotes.id,
        currency: quotes.currency,
        totalSell: quotes.totalSell,
        totalCost: quotes.totalCost,
        validUntil: quotes.validUntil,
        pricedSnapshot: quotes.pricedSnapshot,
        /*
          Who the price came from, where anybody knows.

          A quotation priced off a rate card carries no carrier in its
          snapshot — the card prices a lane, not a sailing — but the card
          itself belongs to a partner, and on a buy card that partner is the
          carrier or the agent whose rate this is. It is lineage, which is
          exactly what `rate_card_version_id` is kept for.
        */
        cardPartner: partners.legalNameEn,
      })
      .from(quotes)
      .leftJoin(rateCards, eq(rateCards.id, quotes.rateCardVersionId))
      .leftJoin(partners, eq(partners.id, rateCards.partnerId))
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
        carrier: text(snapshot.carrier) ?? row.cardPartner,
        service: text(snapshot.service),
        transitDays: typeof snapshot.transitDays === 'number' ? snapshot.transitDays : null,
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
      lane:
        header.originName && header.destinationName
          ? `${header.originName} → ${header.destinationName}`
          : null,
      mode: (header.mode ?? 'sea_fcl') as Mode,
      containerType: null,
      incoterm: header.incoterm,
      preparedBy: header.preparedBy ?? '—',
      pricedAt: new Date(),
      /*
        Neither number is measured on the live path yet.

        `manualTurnaroundHours` is the client's own figure for how long this
        used to take by hand (Pilot §5 item 7) and has no column to come from;
        `pricingMs` is the engine's own clock, which `priceEnquiry` does not
        yet record on the quote. Null rather than zero, so the strip says
        nothing instead of claiming the enquiry was priced instantaneously and
        that doing it by hand took no time at all.
      */
      manualTurnaroundHours: null,
      pricingMs: null,
      hasResponded: header.firstRespondedAt !== null,
      isClosed: ['won', 'lost', 'cancelled', 'expired'].includes(header.status),
      // The raw status too: "start rating" is only a move from `assigned`,
      // and `isClosed` cannot answer which of the open states it is in.
      status: header.status,
      options,
    }
  })
}
